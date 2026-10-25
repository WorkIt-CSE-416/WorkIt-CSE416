// Batch apply (KAN-374), end to end: the student presses the employer's own
// Submit in a batch tab, and the extension, which never submits, reads the
// job system's answer to it (the Fill engine's success signal). Only a
// success marks the application applied, with the resume it went out with
// kept as its sent resume; a refused submit leaves it unapplied and the tab
// says why. The unpacked extension runs in Chromium (loaded-extension.ts),
// against the fake WorkIt API (fake-api.ts) and the Fill engine's saved forms
// (fake-job-systems.ts), whose submit endpoint answers as the test says.
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";
const RESUME_ID = "00000000-0000-0000-0000-0000000000r1"; // fake-api.ts's default upload

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The group of the tab showing `url` ("" outside any group), as the student's tab strip shows it. */
function groupOf(worker: Worker, url: string): Promise<string | undefined> {
  return worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
    if (!tab) return undefined;
    return tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? "" : (await chrome.tabGroups.get(tab.groupId)).title;
  }, url);
}

/** Starts a batch of Arc's saved form, waits for its tab to be filled and Ready, and switches to it, as the student does to review it. */
async function readyArc(forms: SavedForms, api: FakeApi, pageScript?: () => void): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  if (pageScript) await loaded.context.addInitScript(pageScript);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => groupOf(loaded.worker, forms.url(ARC)), { timeout: 60_000 }).toBe("Ready");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ARC))!;
  // A hidden tab runs no animation frames, which Playwright's clicks wait for.
  await form.bringToFront();
  return form;
}

/**
 * The student finishes the form and presses its own Submit, from the keyboard
 * (at this window size WorkIt's panel sits over the button). The fill leaves
 * the Country picker beside Phone empty, which Greenhouse requires before it
 * sends anything, so the student picks it first.
 */
async function submit(form: Page): Promise<void> {
  await form.locator("#country").pressSequentially("United States");
  await form.getByRole("option", { name: /United States/ }).first().waitFor();
  await form.locator("#country").press("Enter");
  await form.getByRole("button", { name: "Submit application" }).press("Enter");
}

test("the student's submit, answered OK, marks the application applied with the resume it sent", async () => {
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api);
  // The extension filled the form and sent nothing.
  expect(forms.submissions).toEqual([]);

  await submit(form);

  await expect.poll(() => api.stages.get("job-0"), { timeout: 15_000 }).toBe("applied");
  expect(api.sentResumes.get("job-0")).toEqual({ uploaded_resume_id: RESUME_ID });
  expect(forms.submissions).toHaveLength(1); // the student's own
  // Sent: the tab leaves the Ready group, which holds only what still waits for a submit.
  await expect.poll(() => groupOf(loaded.worker, "https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008")).toBe("");
});

test("a refused submit leaves the application unapplied, and the tab says why", async () => {
  const refusal = { status: 422, json: { code: "invalid-security-code", message: "The security code is incorrect." } };
  const forms = new SavedForms([ARC], { submitReply: refusal });
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api);

  await submit(form);

  await expect(form.getByText("Greenhouse refused it: The security code is incorrect.")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => groupOf(loaded.worker, forms.url(ARC))).toBe("Needs you");
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");
  expect(api.sentResumes.has("job-0")).toBe(false);
  expect(api.calls.filter((c) => c.endsWith("/finish"))).toEqual([]);
});

test("the job system's page for a sent application alone doesn't mark it applied", async () => {
  // A page script can move the tab to the confirmation page itself: with no submit request the job
  // system took (submit-proof.js), it is only a hint.
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api);

  await form.goto("https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008/confirmation");
  await form.waitForTimeout(2_000);

  expect(api.stages.get("job-0")).not.toBe("applied");
  expect(api.calls.filter((c) => c.endsWith("/finish"))).toEqual([]);
});

test("a page script that hooked the Fill engine can't mark the application applied; the job system's answer does", async () => {
  // A script on the employer's page, run before the engine, wraps the engine as it loads and keeps the
  // key watchSubmit is given, then sends the engine's submit event itself, as if the job system had
  // answered OK. Only the job system's own answer to the student's submit, which the extension's
  // service worker sees, marks the application applied.
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api, () => {
    let engine: any;
    Object.defineProperty(globalThis, "FillEngine", {
      configurable: true,
      get: () => engine,
      set(value) {
        const call = value.call.bind(value);
        engine = { ...value, call: (name: string, args: unknown[]) => ((name === "watchSubmit" && ((globalThis as any).stolenKey = args[1])), call(name, args)) };
      },
    });
  });
  const key = await form.waitForFunction(() => (globalThis as any).stolenKey).then((k) => k.jsonValue());

  await form.evaluate((key) => document.dispatchEvent(new CustomEvent(`fillengine:submit:${key}`, { detail: JSON.stringify({ submitted: true }) })), key);
  await form.waitForTimeout(2_000);

  expect(api.stages.get("job-0")).not.toBe("applied");
  expect(api.calls.filter((c) => c.endsWith("/finish"))).toEqual([]);
  expect(await groupOf(loaded.worker, forms.url(ARC))).toBe("Ready");

  await submit(form);

  await expect.poll(() => api.stages.get("job-0"), { timeout: 15_000 }).toBe("applied");
  expect(forms.submissions).toHaveLength(1); // the student's own
});

test("on a job system with no known submit request, its page's notice of a sent application marks it applied", async () => {
  // Eightfold's submit request isn't known (submit-proof.js), so its thanks notice in the page is what marks it.
  const form = "https://lockheedmartin.eightfold.ai/careers/apply?pid=1";
  const eightfold: Handler = ({ url }) =>
    url.host === "lockheedmartin.eightfold.ai"
      ? { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Careers</title><form><label>First name <input name=first></label></form>" }
      : undefined;
  const api = new FakeApi().queue({ id: "job-0", apply_url: "https://lockheedmartin.eightfold.ai/careers/job/1" });
  loaded = await loadExtension([api.handler, webapp, eightfold]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === form), { timeout: 30_000 }).toBe(true);
  const page = loaded.context.pages().find((p) => p.url() === form)!;
  // The engine watches the page for the student's submit.
  await page.waitForFunction(() => (window as any).__fillEngineSubmitWatch, undefined, { timeout: 30_000 });
  expect(api.stages.get("job-0")).not.toBe("applied");

  // The student submits; Eightfold shows its thanks.
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", "<p>Thank you for applying!</p>"));

  await expect.poll(() => api.stages.get("job-0"), { timeout: 15_000 }).toBe("applied");
});

test("reading the student's edits back leaves their focus where they put it", async () => {
  // The tab reads the form back after each edit. Greenhouse's phone country was read by opening its
  // picker, which took the focus: an Enter meant for Submit went to the picker, and nothing was sent.
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api);

  await form.locator("#first_name").fill("Tess");
  await form.getByRole("button", { name: "Submit application" }).focus();
  await form.waitForTimeout(2_000); // past the pause after typing, and the read back

  expect(await form.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Submit application");
  expect(await form.locator("#react-select-country-listbox").count()).toBe(0);
  expect(forms.submissions).toEqual([]);
});
