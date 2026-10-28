// One rule for "needs you" (KAN-369 Q7): the panel's Needs you rows, the
// required line, the list's summary line, Next Thing's count and the red
// dots on the page all count the same fields. A field needs the student
// only while the page shows it and it is required and empty, failed, or
// flagged (or a note asks something of them). A required question the form
// hides (a conditional one not asked yet) is not one. Guesses are "check"
// rows: not counted, but Next Thing still goes to them after the red ones.
// Anduril's saved Greenhouse form, opened by the student (no batch): two
// required questions WorkIt has no answer to, one of them hidden here as a
// conditional question would be, and one guess, moved above the other
// question so page order alone would visit it first.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const ASKED = "question_13130330007"; // in person for 12 weeks: no answer, shown
const HIDDEN = "question_13130331007"; // top location preference: no answer, hidden
const GUESS = "question_13130335007"; // how they heard of Anduril: guessed

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const mainButton = (page: Page) => hostOf(page).locator('[data-slot="primary"] .primary-button').first();
const dots = (page: Page) => page.locator("#workit-marks-host .dot");
// A question's box on the page (its nearest ancestor that holds its label too), as a function's source for page.evaluate.
const BOX = `(id) => { let el = document.getElementById(id); while (!el.querySelector("label")) el = el.parentElement; return el; }`;

test("the list, every count line, Next Thing and the page's dots agree on what needs you", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  loaded = await loadExtension([new FakeApi().handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  const host = hostOf(page);
  await host.getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  // Hidden, as a conditional question not asked yet.
  await page.evaluate(([box, id]) => ((0, eval)(box)(id).style.display = "none"), [BOX, HIDDEN]);
  await mainButton(page).click();
  await expect(mainButton(page)).toContainText("Next:", { timeout: 60_000 });
  // The asked question's box goes below the guess's, so page order alone would visit the guess first.
  await page.evaluate(([box, asked, guess]) => {
    const below = (0, eval)(box)(guess);
    below.after((0, eval)(box)(asked));
  }, [BOX, ASKED, GUESS]);

  // The list: one red row, the asked question; the hidden one is not red. The guess is marked to check.
  const red = host.locator('[data-tab="autofill"] .row[data-key][data-mark="needs-you"]');
  await expect(red).toHaveCount(1);
  await expect(red).toHaveAttribute("data-key", ASKED);
  await expect(host.locator(`[data-key="${GUESS}"]`)).toHaveAttribute("data-mark", "check");
  // The hidden question waits, out of sight, under "1 the form isn't asking now".
  await expect(host.locator('.group[data-group="not-asked"] .group-head')).toHaveText("1 the form isn't asking now");
  await expect(host.locator(`[data-key="${HIDDEN}"]`)).toBeHidden();

  // Every count line says 1.
  await expect(host.locator(".summary")).toContainText("· 1 need you");
  await expect(mainButton(page)).toHaveText("Next: 1 need you");

  // Next Thing: the red row first, though the guess stands above it; a dot on its field.
  await mainButton(page).click();
  await expect(host.locator("[data-current]")).toHaveAttribute("data-key", ASKED);
  await expect(dots(page)).toHaveCount(1);
  // Then the guess: visited, but no dot (it doesn't need the student).
  await mainButton(page).click();
  await expect(host.locator("[data-current]")).toHaveAttribute("data-key", GUESS);
  await expect(dots(page)).toHaveCount(1);
  // The hidden question is never visited.
  await mainButton(page).click();
  await expect(host.locator('[data-slot="primary"] [data-said]')).toHaveText("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

test("in a batch tab, the walk goes to every red row before the guess, and the counts agree", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const page = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL))!;
  const host = hostOf(page);
  await expect(mainButton(page)).toContainText("Next:");
  // Both questions with no answer go below the guess.
  await page.evaluate(([box, guess, ...red]) => {
    const below = (0, eval)(box)(guess);
    for (const id of red.reverse()) below.after((0, eval)(box)(id));
  }, [BOX, GUESS, ASKED, HIDDEN]);

  await expect(host.locator('[data-tab="autofill"] .row[data-key][data-mark="needs-you"]')).toHaveCount(2);
  await expect(host.locator(".summary")).toContainText("· 2 need you");
  await expect(mainButton(page)).toHaveText("Next: 2 need you");

  const visited: (string | undefined)[] = [];
  for (let n = 0; n < 3; n++) {
    const before = visited.at(-1);
    await mainButton(page).click();
    await expect.poll(() => host.locator("[data-current]").getAttribute("data-key")).not.toBe(before ?? null);
    visited.push((await host.locator("[data-current]").getAttribute("data-key")) ?? undefined);
  }
  expect(visited).toEqual([ASKED, HIDDEN, GUESS]);
  await expect(dots(page)).toHaveCount(2);
  expect(forms.submissions).toEqual([]);
});
