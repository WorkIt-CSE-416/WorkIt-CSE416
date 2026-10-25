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
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

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
async function readyArc(forms: SavedForms, api: FakeApi): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
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

test("the job system's page for a sent application marks it applied too", async () => {
  // Lever's form is a plain HTML post, with no answer for a page to read: its thanks page is the signal.
  // Greenhouse's confirmation page stands in for it here (only Greenhouse and Ashby forms are saved).
  const forms = new SavedForms([ARC]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) });
  const form = await readyArc(forms, api);

  await form.goto("https://job-boards.greenhouse.io/arcboatcompany/jobs/5442881008/confirmation");

  await expect.poll(() => api.stages.get("job-0"), { timeout: 15_000 }).toBe("applied");
  expect(forms.submissions).toEqual([]);
});
