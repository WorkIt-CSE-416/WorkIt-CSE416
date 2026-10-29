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

/** The waiting box's head (KAN-424): Write with Claude and the Written Answers link, once for its rows. */
function waitingNote(form: Page) {
  return form.locator('.box[data-box="waiting"] .box-note');
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

  // The tab sends its written question, and its one-off questions nothing else fills (KAN-369):
  // a choice with its options, and a short one. It waits for the student's Claude.
  await expect.poll(() => api.written.get("job-0"), { timeout: 60_000 }).toEqual([
    { name: expect.any(String), label: WHY, required: true, max_length: null, answer: null },
    {
      name: expect.any(String), label: "What type of work are you most interested in? Select 2.", required: true, max_length: null,
      kind: "choices", options: expect.arrayContaining(["Backend (SF, TOR)", "Open to Anything"]), answer: null,
    },
    { name: expect.any(String), label: "What are some AI specific technologies you are comfortable with?", required: true, max_length: null, answer: null },
  ]);
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;
  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting");
  // A student without Claude is pointed at Written Answers, on the webapp they signed in on.
  await expect(waitingNote(form).getByRole("link", { name: "Written Answers" })).toHaveAttribute(
    "href",
    "http://localhost:3000/auto-apply/answers",
  );
  // Harvey's form asks other things WorkIt has no answer for: the tab needs the student either way.
  expect(api.stages.get("job-0")).toBe("needs_you");

  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);

  // Within one poll (10 seconds), the answer is in the form, read back by the engine.
  await expect(box(form, name)).toHaveValue(ANSWER, { timeout: 20_000 });
  await expect(row(form, WHY)).not.toHaveAttribute("data-mark", "waiting");
  // Labelled as Claude's (KAN-375's source labels).
  await expect(row(form, WHY).locator(".source")).toHaveText("Claude");
  expect(forms.submissions).toEqual([]);
});

test("a fact the student's Claude asks for shows on its row until the student answers it", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(3);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;
  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting");

  // Their Claude found nothing of the student's to back a required slot, so it asked (save_fact_question).
  api.askFact("job-0", name, "Essay fact: What drew you to legal tools?", "Software Intern, Acme");

  // Within one poll, the row says what it needs and where to answer it.
  await expect(row(form, WHY)).toContainText("Your Claude needs a fact from you first: What drew you to legal tools?", {
    timeout: 20_000,
  });
  await expect(waitingNote(form).getByRole("link", { name: "Written Answers" })).toBeVisible();

  // The student answered on Written Answers: the question is their Claude's again, and its answer fills.
  api.askFact("job-0", name, null);
  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting", { timeout: 20_000 });
  api.saveAnswer("job-0", name, ANSWER);
  await expect(box(form, name)).toHaveValue(ANSWER, { timeout: 20_000 });
  expect(forms.submissions).toEqual([]);
});

test("the student's own answer is kept when their Claude's arrives later", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(3);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;

  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting");
  await box(form, name).fill("My own words.");
  // The engine read the student's answer back: the row no longer waits.
  await expect(row(form, WHY)).not.toHaveAttribute("data-mark", "waiting");
  api.saveAnswer("job-0", name, ANSWER);
  // Past the next poll: the tab saw the saved answer and left the student's.
  await form.waitForTimeout(12_000);

  await expect(box(form, name)).toHaveValue("My own words.");
});

test("a follow-up its parent's answer from Claude doesn't call for stops waiting", async () => {
  test.setTimeout(120_000);
  // Amplify's "Are you currently working with Amplify?" goes to the student's Claude, so at plan time
  // its optional "If a contingent worker, which agency..." can't be ruled out: it waits too (decision 223).
  const AMPLIFY = "ashby-amplify";
  const PARENT = "Are you currently working with Amplify Education, Inc.?";
  const FOLLOW_UP = "If a contingent worker, which agency are you employed with?";
  const forms = new SavedForms([AMPLIFY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(AMPLIFY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.map((q) => q.label), { timeout: 60_000 }).toEqual(expect.arrayContaining([PARENT, FOLLOW_UP]));
  // The extension opens the saved link without its "?embed=true".
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(AMPLIFY).split("?")[0]))!;
  await expect(row(form, FOLLOW_UP)).toHaveAttribute("data-mark", "waiting");

  const parent = api.written.get("job-0")!.find((q) => q.label === PARENT)!;
  api.saveAnswer("job-0", parent.name, "No");

  // Within one poll the parent is filled, and the follow-up it rules out no longer waits, left blank.
  await expect(row(form, PARENT).locator(".source")).toHaveText("Claude", { timeout: 20_000 });
  await expect(row(form, FOLLOW_UP)).not.toHaveAttribute("data-mark", "waiting");
  await expect(row(form, FOLLOW_UP)).toContainText("Not needed");
  expect(forms.submissions).toEqual([]);
});

test("the student's words typed into a form are saved with a notice: Review opens Written Answers, Undo takes them back", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(3);
  const name = api.written.get("job-0")![0].name;
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;
  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting");

  // Saved as they type, with no question first, and the panel says so once.
  await box(form, name).fill("My own words.");
  await expect.poll(() => api.own, { timeout: 15_000 }).toEqual([{ jobId: "job-0", name, label: WHY, answer: "My own words.", own: true }]);
  const notice = form.locator(".captured");
  await expect(notice).toContainText("Saved 1 new answer for later forms.");
  // More typing in the same answer is the same answer, not a second one.
  await box(form, name).fill("My own words, and more of them.");
  await expect.poll(() => api.own.length, { timeout: 15_000 }).toBe(2);
  await expect(notice).toContainText("Saved 1 new answer for later forms.");

  // Review opens Written Answers, where it is marked New.
  const opened = loaded.context.waitForEvent("page");
  await notice.getByRole("button", { name: "Review" }).click();
  expect((await opened).url()).toBe("http://localhost:3000/auto-apply/answers");

  // Undo takes it back; the field keeps the student's words, and later typing isn't saved again on this page.
  await notice.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => api.undone).toEqual([{ jobId: "job-0", name }]);
  await expect(notice).toContainText("Not saved. Later forms won't fill it.");
  await box(form, name).fill("Still my own words.");
  await form.waitForTimeout(4_000);
  expect(api.own.length).toBe(2);
  await expect(box(form, name)).toHaveValue("Still my own words.");
  expect(forms.submissions).toEqual([]);
});

test("an answer the student's Claude saves in the first minute fills within seconds, not a full poll later", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  await start(api, forms);
  await expect.poll(() => api.written.get("job-0")?.length, { timeout: 60_000 }).toBe(3);
  const form = loaded.context.pages().find((p) => p.url().startsWith(forms.url(HARVEY)))!;
  await expect(row(form, WHY)).toHaveAttribute("data-mark", "waiting");

  // Saved just after the tab sent its questions: the tab asks again within ANSWER_POLL_SOON (2 s), not ANSWER_POLL (10 s).
  const name = api.written.get("job-0")![0].name;
  api.saveAnswer("job-0", name, ANSWER);
  await expect(box(form, name)).toHaveValue(ANSWER, { timeout: 5_000 });
  expect(forms.submissions).toEqual([]);
});
