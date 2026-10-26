// The panel's top (KAN-395): the header (WorkIt's logo, Report a problem,
// settings, collapse), the batch line in a batch tab ("Batch · 0 of 2 ready ·
// Next tab →", Workday's step instead), and the job card naming the tab's job
// with its Match score ring and "You applied on <date>". Anduril's and Arc's
// saved Greenhouse forms and a fake Workday tenant.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";
const ARC = "greenhouse-arc";
const LOGO = "https://logos.example.com/anduril.png";
// A 1x1 PNG, the company logo the API names.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const logos: Handler = ({ url }) => (url.host === "logos.example.com" ? { headers: { "content-type": "image/png" }, body: PIXEL } : undefined);

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const slotOf = (page: Page, name: string) => hostOf(page).locator(`[data-slot="${name}"]`);

/** Starts a batch on the webapp. */
async function runBatch(): Promise<void> {
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
}

const tabOf = (url: string) => loaded.context.pages().find((p) => p.url() === url && !p.isClosed())!;
const activeUrl = () => loaded.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url);

test("a batch tab shows the batch line, its job card with the Match score, and Next tab goes to the tab that needs the student", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([ANDURIL, ARC]);
  const api = new FakeApi().queue(
    {
      id: "job-0", apply_url: forms.url(ANDURIL), title: "Software Engineer Intern", company: "Anduril", location_label: "Costa Mesa, CA",
      logo_url: LOGO, salary_min: 45, salary_max: 55, salary_period: "hour", match: 86,
    },
    { id: "job-1", apply_url: forms.url(ARC), title: "Platform Intern", company: "Arc", match: null },
  );
  loaded = await loadExtension([api.handler, webapp, forms.handler, logos]);
  await signIn(loaded.context);
  await runBatch();
  // Anduril's form needs the student (a guess); Arc's fills whole.
  await expect.poll(() => api.stages.get("job-0"), { timeout: 90_000 }).toBe("needs_you");
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === forms.url(ARC)), { timeout: 30_000 }).toBe(true);
  const arc = tabOf(forms.url(ARC));
  const line = slotOf(arc, "batch-line");
  await expect(line).toHaveText("Batch · 1 of 2 ready · Next tab →", { timeout: 90_000 });

  const anduril = tabOf(forms.url(ANDURIL));
  // Anduril's own tab: no other tab needs the student.
  await expect(slotOf(anduril, "batch-line")).toHaveText("Batch · 1 of 2 ready");

  const card = slotOf(anduril, "job-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".job-title")).toHaveText("Software Engineer Intern");
  await expect(card.locator(".job-company")).toHaveText("Anduril");
  await expect(card).toContainText("Costa Mesa, CA");
  await expect(card).toContainText("$45–$55 an hour");
  await expect(card.locator("img.job-logo")).toHaveAttribute("src", LOGO);
  await expect(card.locator(".match")).toContainText("86");
  await expect(card.locator(".match")).toContainText("Strong Match");

  // A job with no score shows no ring.
  await expect(slotOf(arc, "job-card").locator(".job-title")).toHaveText("Platform Intern");
  await expect(slotOf(arc, "job-card").locator(".match")).toHaveCount(0);

  await line.getByRole("button", { name: "Next tab →" }).click();
  await expect.poll(activeUrl).toBe(forms.url(ANDURIL));
  expect(forms.submissions).toEqual([]);
});

test("a job form the student opened shows the header and, for a posting WorkIt has as applied, its job card and the day they applied", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().applied({ id: "job-0", apply_url: forms.url(ANDURIL), title: "Software Engineer Intern", company: "Anduril" }, "2026-10-25T15:00:00Z");
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });

  const header = hostOf(page).locator(".header");
  await expect(header.getByRole("img", { name: "WorkIt" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Collapse" })).toBeVisible();
  await header.getByRole("button", { name: "Report a problem" }).click();
  await expect(hostOf(page).locator('[data-slot="report"]')).toContainText("Report a problem");

  const card = slotOf(page, "job-card");
  await expect(card.locator(".job-title")).toHaveText("Software Engineer Intern");
  await expect(card).toContainText("You applied on Oct 25");
  await expect(slotOf(page, "batch-line")).toBeHidden();
  expect(forms.submissions).toEqual([]);
});

test("a Workday tab's line shows its step number, count and name", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"], [
    ["My Information", [{ key: "legalName--firstName", label: "First Name", kind: "text", required: true }]],
    ["My Experience", [{ key: "school", label: "School", kind: "text", required: false }]],
  ]);
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.url(0), title: "Analyst Intern", company: "CACI" });
  loaded = await loadExtension([api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const app = await loaded.context.newPage();
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });
  await expect.poll(() => loaded.context.pages().some((p) => p.url() === workdays.url(0)), { timeout: 30_000 }).toBe(true);
  const tab = tabOf(workdays.url(0));
  await expect(slotOf(tab, "job-card").locator(".job-title")).toHaveText("Analyst Intern", { timeout: 60_000 });
  // A batch's Workday tab walks to Review (Fill to Review), the fake tenant's step 4 of 4.
  await expect(slotOf(tab, "batch-line").locator(".step")).toHaveText("Step 4 of 4 · Review", { timeout: 60_000 });
  await expect(slotOf(tab, "batch-line")).toContainText("Batch · ");
  await expect(slotOf(tab, "job-card").locator(".job-title")).toHaveText("Analyst Intern");
  expect(workdays.submissions).toEqual([]);
});
