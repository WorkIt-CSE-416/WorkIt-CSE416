// Batch apply on Ashby (KAN-370's batch, KAN-377's essay route needs it): an
// Ashby application has no <form> element, so the batch's wait for the form
// must find its fields some other way, or the tab fills nothing.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("a batch tab fills an Ashby form, which has no form element", async () => {
  const forms = new SavedForms(["ashby-patreon"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("ashby-patreon") });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");

  await sendFromWebapp(page, { type: "run/open" });
  // Patreon asks two things WorkIt has no answer for, so the tab needs the student.
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");

  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url("ashby-patreon")))!;
  await expect(form.locator("input[type=email]").first()).not.toHaveValue("");
  expect(forms.submissions).toEqual([]);
});
