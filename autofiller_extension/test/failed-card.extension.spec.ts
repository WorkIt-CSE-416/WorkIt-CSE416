// The failed-field card (KAN-369): a field whose page doesn't show the answer
// WorkIt put says what it put and what the page shows, quotes the site's own
// error, and offers Put mine back (fill it again) and Keep the page's. Arc's
// saved Greenhouse form, with a script that makes its name box misbehave the
// way a live form's code can.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** `forms`' handler, with `script` run first in Arc's page. */
function withScript(forms: SavedForms, script: string): Handler {
  return async (request) => {
    const reply = await forms.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== forms.url(ARC)) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${script}</script>`) };
  };
}

// The name box drops what is typed in it, until the page hears "workit-test-stop-dropping".
const DROPS_FIRST_NAME = `let dropping = true;
window.addEventListener("workit-test-stop-dropping", () => (dropping = false));
window.addEventListener("input", (e) => {
  if (!dropping || e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "";
}, true);`;

// The name box turns what is typed into "Pat", and the site marks it invalid with its own words.
const REWRITES_FIRST_NAME = `window.addEventListener("input", (e) => {
  if (e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "Pat";
  e.target.setAttribute("aria-invalid", "true");
  e.target.setAttribute("aria-describedby", "first_name-error");
  let error = document.getElementById("first_name-error");
  if (!error) {
    error = document.createElement("p");
    error.id = "first_name-error";
    e.target.after(error);
  }
  error.textContent = "Use the name on your passport.";
}, true);`;

/** Runs a batch of Arc's form with `script` in its page; resolves with Arc's tab once it needs the student. */
async function arcWith(script: string): Promise<{ form: Page; api: FakeApi; forms: SavedForms }> {
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  loaded = await loadExtension([api.handler, webapp, withScript(forms, script)]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ARC))!;
  return { form, api, forms };
}

const rowOf = (form: Page, key: string) => form.locator(`#workit-autofiller-overlay-host [data-key="${key}"]`);

test("Put mine back fills a field the page emptied again, and reads it back", async () => {
  const { form, api, forms } = await arcWith(DROPS_FIRST_NAME);
  const card = rowOf(form, "first_name").locator(".row-card");
  await expect(card).toContainText("We put Test; the page shows (empty).");
  await expect(card).toContainText("This field ended up empty on the page.");

  await form.evaluate(() => window.dispatchEvent(new Event("workit-test-stop-dropping")));
  await card.getByRole("button", { name: "Put mine back" }).click();

  await expect(form.locator("#first_name")).toHaveValue("Test");
  await expect(rowOf(form, "first_name").locator(".row-card")).toHaveCount(0);
  await expect(rowOf(form, "first_name").locator(".dot")).toHaveCSS("background-color", "rgb(23, 176, 118)");
  await expect.poll(() => api.stages.get("job-0")).toBe("queued"); // the tab is Ready again
  expect(forms.submissions).toEqual([]);
});

test("Keep the page's takes what the page shows as the student's, quoting the site's error, and never retries it", async () => {
  const { form, api, forms } = await arcWith(REWRITES_FIRST_NAME);
  const card = rowOf(form, "first_name").locator(".row-card");
  await expect(card).toContainText("We put Test; the page shows Pat.");
  await expect(card).toContainText("The site rejected this value.");
  await expect(card.locator("q")).toHaveText("Use the name on your passport.");
  // The site already turned the answer down: WorkIt doesn't fight it.
  await expect(card.getByRole("button", { name: "Put mine back" })).toHaveCount(0);

  await card.getByRole("button", { name: "Keep the page's" }).click();

  await expect(rowOf(form, "first_name").locator(".row-card")).toHaveCount(0);
  await expect(rowOf(form, "first_name").locator(".source")).toHaveText("You");
  await expect(form.locator("#first_name")).toHaveValue("Pat");
  await expect.poll(() => api.stages.get("job-0")).toBe("queued"); // the tab is Ready again
  expect(forms.submissions).toEqual([]);
});
