// The connector's answers in batch tabs (KAN-377), end to end through the
// loaded extension: a batch tab sends the questions its form needs written to
// the API, and fills each answer the student's own Claude saves through the
// connector (backend/app/connector/, tested over MCP in
// backend/tests/test_connector.py) into the open form. The API is faked
// (fake-api.ts): `api.saveAnswer` is the connector's save.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const HARVEY = "ashby-harvey";
const WHY = "Why are you interested in working at Harvey?";
const ANSWER = "I want to build legal tools that lawyers trust, and my internship taught me how to ship them.";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

async function start(api: FakeApi, forms: SavedForms): Promise<Page> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(page, { type: "run/open" });
  return page;
}

/** An Ashby question's text box, by the question's name. */
function box(form: Page, name: string) {
  return form.locator(`[data-field-path="${name}"] textarea`);
}

/** The overlay's text for one row, by its label. */
function row(form: Page, label: string) {
  return form.locator(".row", { hasText: label });
}

test("an answer the student's Claude saves fills into its open tab", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);

  // The tab sends its one written question, and waits for the student's Claude.
  await expect.poll(() => api.written.get("job-0"), { timeout: 60_000 }).toEqual([
    { name: expect.any(String), label: WHY, required: true, max_length: null, answer: null },
  ]);
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;
  await expect(row(form, WHY)).toContainText("Waiting for your Claude");
  // Harvey's form asks other things WorkIt has no answer for: the tab needs the student either way.
  expect(api.stages.get("job-0")).toBe("needs_you");

  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);

  // Within one poll (10 seconds), the answer is in the form, read back by the engine.
  await expect(box(form, name)).toHaveValue(ANSWER, { timeout: 20_000 });
  await expect(row(form, WHY)).not.toContainText("Waiting for your Claude");
  expect(forms.submissions).toEqual([]);
});

test("the student's own answer is kept when their Claude's arrives later", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(1);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;

  await expect(row(form, WHY)).toContainText("Waiting for your Claude");
  await box(form, name).fill("My own words.");
  // The engine read the student's answer back: the row no longer waits.
  await expect(row(form, WHY)).not.toContainText("Waiting for your Claude");
  api.saveAnswer("job-0", name, ANSWER);
  // Past the next poll: the tab saw the saved answer and left the student's.
  await form.waitForTimeout(12_000);

  await expect(box(form, name)).toHaveValue("My own words.");
});
