// The session past its access token's expiry (KAN-465), in the loaded
// extension (loaded-extension.ts). The extension never rotates the token
// itself: the webapp's GET /api/session/refresh does, and sets the new
// cookie, which the extension reads again. Faked here as the webapp route
// answers: a new session cookie, or (no valid refresh token) a cleared one
// and a 401. The WorkIt API is faked (fake-api.ts); nothing is submitted.
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, SESSION_COOKIE, sendFromWebapp, sessionCookie, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");

/** The webapp's refresh route: each request's cookie header, and how it answers (a new token, or signed out). */
class RefreshRoute {
  readonly cookies: string[] = [];
  constructor(private answer: () => { token: string } | "signed-out") {}
  readonly handler: Handler = ({ url, headers }) => {
    if (url.host !== "localhost:3000" || url.pathname !== "/api/session/refresh") return undefined;
    this.cookies.push(String(headers.cookie ?? ""));
    const answer = this.answer();
    if (answer === "signed-out") {
      return { status: 401, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` }, json: { signed_in: false } };
    }
    return { headers: { "set-cookie": `${SESSION_COOKIE}=${sessionCookie(answer.token)}; Path=/; HttpOnly; SameSite=Lax` }, json: { signed_in: true } };
  };
}

/** Every tab's link with its group's title. */
function tabs(worker: Worker): Promise<{ url?: string; group: string | null }[]> {
  return worker.evaluate(async () => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    return (await chrome.tabs.query({})).map((t) => ({ url: t.url || t.pendingUrl, group: groups.get(t.groupId) ?? null }));
  });
}

test("an access token that expires mid-batch is refreshed through the webapp, and the next tab fills", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-anduril"]);
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    { id: "job-1", apply_url: forms.url("greenhouse-anduril") },
  );
  const route = new RefreshRoute(() => ({ token: "rotated-access-token" }));
  // Anduril's page loads only once the first token has expired.
  let release!: () => void;
  const expired = new Promise<void>((done) => (release = done));
  const later: Handler = async ({ url }) => (url.href === forms.url("greenhouse-anduril") ? (await expired, undefined) : undefined);
  loaded = await loadExtension([api.handler, route.handler, webapp, later, forms.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");

  expect(await sendFromWebapp(page, { type: "run/open" })).toMatchObject({ ok: true, opened: true });
  await expect.poll(async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group, { timeout: 60_000 }).toBe("Ready");
  expect(route.cookies).toEqual([]);

  // The hour is up: the API refuses the token the student signed in with, and the webapp would hand out a new one.
  api.token = "rotated-access-token";
  release();

  // Anduril's tab fills and is sorted, with no student action; its stage was saved with the new token.
  await expect.poll(async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-anduril"))?.group, { timeout: 60_000 }).toBe("Needs you");
  await expect.poll(() => api.stages.get("job-1")).toBe("needs_you");
  const anduril = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-anduril"))!;
  await expect(anduril.locator("#first_name")).toHaveValue("Test");
  // One refresh, through the webapp, with the student's session cookie; the extension rotated nothing itself.
  expect(route.cookies).toHaveLength(1);
  expect(route.cookies[0]).toContain(`${SESSION_COOKIE}=base64-`);
  const cookie = (await loaded.context.cookies("http://localhost:3000/")).find((c) => c.name === SESSION_COOKIE)!;
  expect(JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString()).access_token).toBe("rotated-access-token");
  expect(forms.submissions).toEqual([]);
});

test("signed out for real (no valid refresh token), the panel shows Sign in to WorkIt, not an error", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms(["greenhouse-anduril"]);
  const api = new FakeApi();
  api.token = "a-token-nobody-has";
  const route = new RefreshRoute(() => "signed-out");
  loaded = await loadExtension([api.handler, route.handler, webapp, forms.handler]);
  // A session cookie whose access token expired a minute ago.
  await signIn(loaded.context, "test-access-token", -60);
  const page = await loaded.context.newPage();
  await page.goto(forms.url("greenhouse-anduril"));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });

  const primary = hostOf(page).locator('[data-slot="primary"]');
  await expect(primary.getByRole("button", { name: "Sign in to WorkIt" })).toBeVisible();
  await expect(primary.getByRole("button", { name: "Autofill This Page" })).toHaveCount(0);
  expect(route.cookies.length).toBeGreaterThan(0);
  expect(await loaded.context.cookies("http://localhost:3000/")).toEqual([]);
});
