// The field checklist (KAN-369 Q1-Q3). When a fill starts, every field the
// Plan will touch is listed at once with a spinner, under "Autofilling · N%"
// and Cancel; each turns into its mark as it fills (green check, amber ?, red
// !, gray). The same list stays after the fill, in two sections, Required
// then Optional, red and then amber rows first in each. A repeated section
// (Work Experience, Education) is one row with a block under it for each
// entry, titled by its company or school, listing the entry's fields.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { STUDENT } from "./extension";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const COINBASE = "greenhouse-coinbase";
const ASKED = "question_13130330007"; // Anduril: in person for 12 weeks, no answer (red)
const GUESS = "question_13130335007"; // Anduril: how they heard of Anduril, guessed (amber)
// Where screenshots for Lisul go (none when unset).
const SHOTS = process.env.CHECKLIST_SHOTS;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const mainButton = (page: Page) => hostOf(page).locator('[data-slot="primary"] .primary-button').first();
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Opens a saved form as the student would and presses Autofill This Page; returns what the list showed when the fill began. */
async function autofill(forms: SavedForms, name: string, handlers: Handler[] = []): Promise<{ page: Page; atStart: () => Promise<{ rows: number; spinning: number } | null> }> {
  loaded = await loadExtension([...handlers, new FakeApi().handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(forms.url(name));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  // The list as it stands the moment the progress first says "Autofilling · 0%", before any field is filled.
  await page.evaluate(() => {
    const root = document.querySelector("#workit-autofiller-overlay-host")!.shadowRoot!;
    const observer = new MutationObserver(() => {
      if (root.querySelector("[data-progress-said]")?.textContent !== "Autofilling · 0%") return;
      const rows = root.querySelectorAll('[data-tab="autofill"] .row[data-key]');
      (window as any).atStart = { rows: rows.length, spinning: [...rows].filter((r) => (r as HTMLElement).dataset.mark === "filling").length };
      observer.disconnect();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  });
  await mainButton(page).click();
  return { page, atStart: () => page.evaluate(() => (window as any).atStart ?? null) };
}

test("every field is listed with a spinner from the start, and after the fill red then amber lead the Required section", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const { page, atStart } = await autofill(forms, ANDURIL);
  const host = hostOf(page);
  await expect(host.locator("[data-progress-said]")).toHaveText(/^Autofilling · \d+%$/, { timeout: 60_000 });
  await expect(host.locator("[data-progress]").getByRole("button", { name: "Cancel" })).toBeVisible();
  await shot(page, "anduril-filling");
  await expect(mainButton(page)).toContainText(/Next:|Review and submit/, { timeout: 60_000 });
  await shot(page, "anduril-after");

  const start = await atStart();
  const after = await host.locator('[data-tab="autofill"] .row[data-key]').count();
  expect(start).not.toBeNull();
  // Every planned field was there before the first one filled, each spinning (the ones WorkIt has no answer for are red at once).
  expect(start!.spinning).toBeGreaterThan(10);
  expect(start!.rows).toBeGreaterThanOrEqual(after - 2);

  const sections = host.locator('[data-tab="autofill"] .section');
  await expect(sections.locator(".section-head")).toHaveText(["Required", "Optional"]);
  const required = sections.nth(0).locator(":scope > .row[data-key], :scope > .entries > .row[data-key]");
  await expect(required.nth(0)).toHaveAttribute("data-key", ASKED);
  await expect(required.nth(0)).toHaveAttribute("data-mark", "needs-you");
  await expect(host.locator(`.row[data-key="${GUESS}"]`)).toHaveAttribute("data-mark", "check");
  // In the guess's section, only red rows stand above it.
  const marks = await host.locator('[data-tab="autofill"] .section').evaluateAll((els, guess) => {
    const section = els.find((el) => el.querySelector(`[data-key="${guess}"]`))!;
    const rows = [...section.querySelectorAll<HTMLElement>(":scope > .row[data-key]")];
    return rows.slice(0, rows.findIndex((r) => r.dataset.key === guess)).map((r) => r.dataset.mark);
  }, GUESS);
  expect(marks.every((m) => m === "needs-you")).toBe(true);
  await expect(host.locator('.row[data-mark="filled"]').first()).toBeVisible();
  // No source badge until a row is opened; pressing one opens it.
  const filled = host.locator('.row[data-mark="filled"]').first();
  await expect(filled.locator(".source")).toBeHidden();
  await filled.locator(".label").click();
  await expect(filled.locator(".source")).toBeVisible();
  expect(forms.submissions).toEqual([]);
});

// Two made-up jobs for the student's bank, newest first on the form.
const job = (id: string, organization: string, title: string, start: string, end: string | null) => ({
  ...STUDENT.bank.entries[0], id, section: "experience", title, organization, degree: null, field_of_study: null, gpa: null, gpa_scale: null,
  start_month: start, end_month: end, end_kind: end ? "month" : "present",
});
const withJobs: Handler = ({ url }) =>
  url.host === "localhost:8000" && url.pathname.endsWith("/bank")
    ? { json: { ...STUDENT.bank, entries: [...STUDENT.bank.entries, job("j1", "Initech", "Software Intern", "2025-06", "2025-08"), job("j2", "Globex", "Data Intern", "2026-01", null)] } }
    : undefined;

test("Work Experience and Education show as one row each, with a block per entry titled by its company or school", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([COINBASE]);
  const { page } = await autofill(forms, COINBASE, [withJobs]);
  const host = hostOf(page);
  await expect(host.locator("[data-progress-said]")).toHaveText(/^Autofilling · \d+%$/, { timeout: 60_000 });
  await shot(page, "coinbase-filling");
  await expect(mainButton(page)).toContainText(/Next:|Review and submit/, { timeout: 60_000 });

  const work = host.locator('.entries[data-entries="Work Experience"]');
  await expect(work).toHaveCount(1);
  await expect(work.locator(".entries-head .label")).toHaveText("Work Experience");
  await expect(work.locator(".entry-title")).toHaveText(["Globex", "Initech"]);
  await expect(work.locator(".entry").first().locator(".row .label").first()).toHaveText("Company name");
  await expect(work.locator(".entry").first().locator('.row[data-mark="filled"]').first()).toBeVisible();
  const school = host.locator('.entries[data-entries="Education"]');
  await expect(school.locator(".entry-title")).toHaveText([/^Example State University/]);
  // No entry's field is listed again outside its block.
  await expect(host.locator('[data-tab="autofill"] .row[data-key="company-name-0"]')).toHaveCount(1);
  await work.scrollIntoViewIfNeeded();
  await shot(page, "coinbase-after");
  expect(forms.submissions).toEqual([]);
});
