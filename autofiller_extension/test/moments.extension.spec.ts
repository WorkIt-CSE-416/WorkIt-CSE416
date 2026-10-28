// Onboarding's later moments (KAN-387), end to end through the loaded
// extension: what onboarding no longer asks up front is asked on the form
// that first needs it. The WorkIt API is faked (fake-api.ts), the forms are
// the Fill engine's saved ones (fake-job-systems.ts).
import { expect, test, type Page } from "@playwright/test";
import { STUDENT } from "./extension";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ARC = "greenhouse-arc";
const PURE = "greenhouse-purestorage";
// Harvey's Ashby form asks one question the Plan sends to the student's Claude (connector.extension.spec.ts).
const HARVEY = "ashby-harvey";
const WHY = "Why are you interested in working at Harvey?";
// A student who signed up after KAN-387: onboarding never asked the self-identification.
const NO_SELF_ID = { ...STUDENT.answers, gender: null, hispanic_latino: null, race: null, veteran_status: null, disability_status: null };

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

/** The open tab showing `url`, once the batch opened it. */
async function tabOf(url: string): Promise<Page> {
  await expect.poll(() => loaded.context.pages().some((p) => p.url().startsWith(url)), { timeout: 60_000 }).toBe(true);
  return loaded.context.pages().find((p) => p.url().startsWith(url))!;
}

/** The overlay's row for one field, by its label. */
function row(form: Page, label: string) {
  return form.locator(".row", { has: form.locator(".label", { hasText: new RegExp(`^${label}`) }) });
}

test("the first form that asks the self-identification asks the student once, and every form fills from the answers", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([ARC, PURE]);
  const api = new FakeApi({ answers: NO_SELF_ID }).queue(
    { id: "job-0", apply_url: forms.url(ARC) },
    { id: "job-1", apply_url: forms.url(PURE) },
  );
  const webappPage = await start(api, forms);
  const arc = await tabOf(forms.url(ARC));
  const pure = await tabOf(forms.url(PURE));
  await expect(arc.locator(".panel")).toBeVisible({ timeout: 60_000 });
  await expect(pure.locator(".panel")).toBeVisible({ timeout: 60_000 });

  // Both forms ask it; only one tab asks the student.
  const asks = async () => (await arc.locator(".self-id").count()) + (await pure.locator(".self-id").count());
  await expect.poll(asks, { timeout: 20_000 }).toBe(1);
  await arc.waitForTimeout(2_000); // and still one, a moment later
  const [arcAsks, pureAsks] = [await arc.locator(".self-id").count(), await pure.locator(".self-id").count()];
  expect(arcAsks + pureAsks).toBe(1);
  const card = (arcAsks ? arc : pure).locator(".self-id");
  // Nothing was guessed meanwhile: Arc's optional Gender stays blank.
  await expect(row(arc, "Gender")).toHaveCount(0);

  await card.locator("select[name=gender]").selectOption("female");
  await card.locator("select[name=hispanic_latino]").selectOption("no");
  await card.locator("select[name=race]").selectOption("asian");
  await card.locator("select[name=veteran_status]").selectOption("not_protected_veteran");
  await card.locator("select[name=disability_status]").selectOption("declined");
  await card.locator("button[data-save]").click();

  // Saved to the student's answers, as My Profile saves them.
  await expect.poll(() => api.answersSaved).toEqual([
    { gender: "female", hispanic_latino: "no", race: "asian", veteran_status: "not_protected_veteran", disability_status: "declined" },
  ]);
  await expect(card).toHaveCount(0);
  // Both open forms fill from them.
  await expect(row(arc, "Gender").locator(".source")).toHaveText("Profile", { timeout: 30_000 });
  await expect(row(arc, "Race").locator(".source")).toHaveText("Profile", { timeout: 30_000 });
  await expect(row(pure, "Gender").locator(".source")).toHaveText("Profile", { timeout: 30_000 });

  // A later form fills them too, and asks nothing.
  api.queue({ id: "job-2", apply_url: forms.url(ARC) });
  await sendFromWebapp(webappPage, { type: "run/open" });
  const arcs = () => loaded.context.pages().filter((p) => p.url().startsWith(forms.url(ARC)));
  await expect.poll(() => arcs().length, { timeout: 60_000 }).toBe(2);
  const later = arcs().find((p) => p !== arc)!;
  await expect(row(later, "Gender").locator(".source")).toHaveText("Profile", { timeout: 60_000 });
  await expect(later.locator(".self-id")).toHaveCount(0);
  expect(api.answersSaved).toHaveLength(1);
  expect(forms.submissions).toEqual([]);
});

test("a batch's first question for Claude shows the add-Claude step, once, with the install link", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) }, { id: "job-1", apply_url: forms.url(HARVEY) });
  await start(api, forms);

  await expect.poll(() => api.written.size, { timeout: 60_000 }).toBe(2);
  const tabs = loaded.context.pages().filter((p) => p.url().startsWith(forms.url(HARVEY)));
  expect(tabs).toHaveLength(2);
  const steps = async () => (await tabs[0].locator(".add-claude").count()) + (await tabs[1].locator(".add-claude").count());
  await expect.poll(steps, { timeout: 20_000 }).toBe(1);
  await tabs[0].waitForTimeout(2_000);
  expect(await steps()).toBe(1);

  const step = ((await tabs[0].locator(".add-claude").count()) ? tabs[0] : tabs[1]).locator(".add-claude");
  // The webapp's link, which sends the browser on to Claude's Add Custom Connector dialog.
  const add = step.locator("a[data-add]");
  await expect(add).toHaveAttribute("href", "http://localhost:3000/connect/claude/add");
  await expect(add).toHaveAttribute("target", "_blank");
  // Claude asks before each write tool call until the student allows it for good.
  await expect(step).toContainText('choose "Always allow"');
  // The question still waits for Claude, and the step says what to do once it is added.
  await expect(row(tabs[0], WHY)).toContainText("Waiting for your Claude");
  await step.locator("button[data-dismiss]").click();
  await expect(step).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});

test("a student who already added the connector never sees the add-Claude step", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  api.connectorAdded = true;
  await start(api, forms);

  await expect.poll(() => api.written.size, { timeout: 60_000 }).toBe(1);
  const tab = await tabOf(forms.url(HARVEY));
  await expect.poll(() => api.calls.some((c) => c.endsWith("/connector")), { timeout: 20_000 }).toBe(true);
  await tab.waitForTimeout(2_000);
  await expect(tab.locator(".add-claude")).toHaveCount(0);
  await expect(row(tab, WHY)).toContainText("Waiting for your Claude");
});

const ANSWER = "I want to build legal tools that lawyers trust, and my internship taught me how to ship them.";

/** The student's Claude answers every question a job's form sent (its why-us, and its one-off choices with an option). */
function answerAll(api: FakeApi, job: string) {
  for (const q of api.written.get(job)! as Array<{ name: string; options?: string[] }>)
    api.saveAnswer(job, q.name, q.options?.length ? q.options[0] : ANSWER);
}

test("once the first batch's written answers land, the student is asked for writing samples, with Skip", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) }, { id: "job-1", apply_url: forms.url(HARVEY) });
  api.connectorAdded = true;
  await start(api, forms);
  await expect.poll(() => api.written.size, { timeout: 60_000 }).toBe(2);
  const tabs = loaded.context.pages().filter((p) => p.url().startsWith(forms.url(HARVEY)));
  const asks = async () => (await tabs[0].locator(".samples").count()) + (await tabs[1].locator(".samples").count());

  // One tab's answer lands: the batch is still being written, so nothing is asked yet.
  answerAll(api, "job-0");
  await expect.poll(async () => (await Promise.all(tabs.map((t) => row(t, WHY).locator(".source").count()))).reduce((a, b) => a + b), { timeout: 20_000 }).toBe(1);
  await tabs[0].waitForTimeout(2_000);
  expect(await asks()).toBe(0);

  // The last one lands: one tab asks.
  answerAll(api, "job-1");
  await expect.poll(asks, { timeout: 20_000 }).toBe(1);
  await tabs[0].waitForTimeout(2_000);
  expect(await asks()).toBe(1);
  const ask = ((await tabs[0].locator(".samples").count()) ? tabs[0] : tabs[1]).locator(".samples");
  await expect(ask.locator("a[data-add]")).toHaveAttribute("href", "http://localhost:3000/profile#writing-samples");
  await ask.locator("button[data-dismiss]").click();
  await expect(ask).toHaveCount(0);
  expect(forms.submissions).toEqual([]);
});

test("a student who has writing samples is never asked for them", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([HARVEY]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(HARVEY) });
  api.connectorAdded = true;
  api.samples = [{ id: "sample-1", text: "Something I wrote." }];
  await start(api, forms);
  await expect.poll(() => api.written.size, { timeout: 60_000 }).toBe(1);
  const tab = await tabOf(forms.url(HARVEY));

  answerAll(api, "job-0");
  await expect(row(tab, WHY).locator(".source")).toHaveText("Claude", { timeout: 20_000 });
  await expect.poll(() => api.calls.some((c) => c.endsWith("/writing-samples")), { timeout: 10_000 }).toBe(true);
  await tab.waitForTimeout(2_000);
  await expect(tab.locator(".samples")).toHaveCount(0);
});
