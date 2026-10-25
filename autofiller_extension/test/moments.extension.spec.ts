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
