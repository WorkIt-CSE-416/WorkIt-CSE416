// TikTok's careers site (KAN-369): its form is behind the site's own sign-in,
// which the student goes through. On the sign-in the panel says so and fills
// nothing (no email, no password); in a batch the tab needs the student, and
// the form fills once the tab reaches it. The form is the Fill engine's rebuilt
// fixture (fill-engine/test/fixtures/forms/tiktok-lifeattiktok) with its fake
// widgets; the sign-in page is made up here. Nothing is ever submitted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { CONTENT_SCRIPT_FILES, ENGINE_FILES } from "../src/shared/content-scripts.js";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ENGINE_TEST = join(__dirname, "..", "fill-engine", "test");
const FIXTURE = join(ENGINE_TEST, "fixtures", "forms", "tiktok-lifeattiktok");
const JOB = "7693732178706974981";
const POSTING = `https://lifeattiktok.com/search/${JOB}`;
const FORM = `https://lifeattiktok.com/resume/${JOB}/apply`;
const SIGN_IN = `https://lifeattiktok.com/login?redirect_path=/resume/${JOB}/apply`;
const SIGN_IN_PAGE = `<!doctype html><html><head><title>Sign in</title></head><body><h1>Sign in</h1>
  <form><div class="atsx-form-item"><input id="login-email" class="atsx-input" placeholder="Email">
  <input id="login-password" type="password" class="atsx-input" placeholder="Password"></div><button type="button">Sign in</button></form></body></html>`;

/** A fake lifeattiktok.com: the form shows once `signedIn`, else the site sends the tab to its sign-in. Every POST is kept and refused. */
class FakeTikTok {
  signedIn = false;
  /** The job closed: its pages are the site's "404 Page not found". */
  closed = false;
  readonly submissions: string[] = [];
  readonly handler: Handler = ({ url, method }) => {
    if (url.host !== "lifeattiktok.com") return undefined;
    if (method !== "GET") {
      this.submissions.push(url.href);
      return { status: 403, body: "" };
    }
    const html = (body: string) => ({ headers: { "content-type": "text/html" }, body });
    if (url.pathname === "/fake-tiktok-widgets.js") {
      return { headers: { "content-type": "text/javascript" }, body: readFileSync(join(ENGINE_TEST, "fake-tiktok-widgets.js"), "utf8") };
    }
    if (url.pathname === "/login") return html(SIGN_IN_PAGE);
    if (this.closed) return html("<!doctype html><p>404 Page not found</p><p>Oops! We can't find your page.</p>");
    if (url.pathname === `/resume/${JOB}/apply`) {
      return html(this.signedIn ? readFileSync(join(FIXTURE, "form.html"), "utf8") : `<script>location.replace(${JSON.stringify(SIGN_IN)})</script>`);
    }
    if (url.pathname === `/search/${JOB}`) return html(readFileSync(join(FIXTURE, "posting.html"), "utf8"));
    return { status: 404, body: "" };
  };
}

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The panel's words (its shadow root is open in the tests' copy). */
const panelText = (page: Page) => page.evaluate(() => document.querySelector("#workit-autofiller-overlay-host")?.shadowRoot?.textContent ?? "").catch(() => "");
const typed = (page: Page) => page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).filter(Boolean));

test("a batch tab on TikTok's sign-in needs the student, types nothing, and fills the form once they sign in", async () => {
  test.setTimeout(120_000);
  const tiktok = new FakeTikTok();
  const api = new FakeApi().queue({ id: "job-0", apply_url: POSTING });
  loaded = await loadExtension([api.handler, webapp, tiktok.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });

  // The batch opens the posting's form, and the site sends the tab to its sign-in.
  const tab = async () => loaded.context.pages().find((p) => p.url().startsWith("https://lifeattiktok.com/"));
  await expect.poll(async () => (await tab())?.url(), { timeout: 30_000 }).toBe(SIGN_IN);
  const page = (await tab())!;
  await expect.poll(() => panelText(page), { timeout: 30_000 }).toContain("Sign in to TikTok, then press Fill");
  const state = async () => (await sendFromWebapp(webappPage, { type: "run/status" })).jobs[0]?.state;
  await expect.poll(state, { timeout: 15_000 }).toBe("needs_you");
  expect(await typed(page)).toEqual([]);

  // The student signs in themselves; the site takes the tab to the form, which fills.
  tiktok.signedIn = true;
  await page.goto(FORM);
  await expect.poll(() => page.evaluate(() => (document.querySelector("#name") as HTMLInputElement | null)?.value).catch(() => null), { timeout: 60_000 })
    .toBe("Test Person");
  await expect.poll(() => page.evaluate(() => (document.querySelector("#email") as HTMLInputElement).value)).toBe("test.person@example.com");
  expect(tiktok.submissions).toEqual([]);
});

test("Autofill on TikTok's sign-in, outside a batch, says to sign in and fills nothing", async () => {
  test.setTimeout(90_000);
  const tiktok = new FakeTikTok();
  loaded = await loadExtension([new FakeApi().handler, webapp, tiktok.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(SIGN_IN);
  // Autofill This Page (popup.js's injectFill), outside any batch.
  await loaded.worker.evaluate(async ([engine, scripts, url]) => {
    const [{ id }] = await chrome.tabs.query({ url: `${url}*` });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES, "https://lifeattiktok.com/login"] as const);

  await expect.poll(() => panelText(page), { timeout: 30_000 }).toContain("Sign in to TikTok, then press Fill");
  expect(await panelText(page)).toContain("WorkIt never signs in for you.");
  expect(await typed(page)).toEqual([]);
  expect(tiktok.submissions).toEqual([]);
});

test("a closed TikTok job says it is closed, not that the fill failed", async () => {
  test.setTimeout(90_000);
  const tiktok = new FakeTikTok();
  tiktok.signedIn = true;
  tiktok.closed = true;
  loaded = await loadExtension([new FakeApi().handler, webapp, tiktok.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(FORM);
  await loaded.worker.evaluate(async ([engine, scripts, url]) => {
    const [{ id }] = await chrome.tabs.query({ url: `${url}*` });
    await chrome.scripting.executeScript({ target: { tabId: id! }, world: "MAIN", files: engine });
    void chrome.scripting.executeScript({ target: { tabId: id! }, files: scripts });
  }, [ENGINE_FILES, CONTENT_SCRIPT_FILES, FORM] as const);

  await expect.poll(() => panelText(page), { timeout: 30_000 }).toContain("This job is closed");
  expect(tiktok.submissions).toEqual([]);
});
