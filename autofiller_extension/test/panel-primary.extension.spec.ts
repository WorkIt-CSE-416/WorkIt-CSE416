// The panel's one button, at its bottom (KAN-396, KAN-369 Q5): its words
// follow the student's next action. Autofill This Page before a fill (Fill
// this step on a Workday step outside a batch); "Answer 1 of 3" while
// anything on the page is red, which goes to the page's first red field and
// stays there until it is answered (KAN-424); Alt+N runs Next Thing, the
// walk. Review and submit once nothing is red, which scrolls to the
// employer's Submit and rings it, never pressing it. The red box's title
// counts what the button does. Fill Again, in the ⋯ menu, asks once.
import { expect, test, type Frame, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, menuItem, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

type Where = Page | Frame;
const hostOf = (page: Where) => page.locator("#workit-autofiller-overlay-host");
const primaryOf = (page: Where) => hostOf(page).locator('[data-slot="primary"]');
const mainButton = (page: Where) => primaryOf(page).locator(".primary-button").first();
const needsBox = (page: Where) => hostOf(page).locator('.box[data-box="needs-you"]');

async function start(handlers: Handler[]): Promise<void> {
  loaded = await loadExtension([new FakeApi().handler, webapp, ...handlers]);
  await signIn(loaded.context);
}

/** Anduril's form opened by the student (no batch), filled with the panel's Autofill This Page. */
async function filledOwnTab(forms: SavedForms): Promise<Page> {
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await expect(mainButton(page)).toHaveText("Autofill This Page");
  await mainButton(page).click();
  await expect(mainButton(page)).toContainText(/^Answer \d+ of \d+$/, { timeout: 60_000 });
  return page;
}

/** The background's press of an extension command (Chrome gives a test no way to press its keys). */
const pressCommand = (page: Page, command: string) =>
  loaded.worker.evaluate(
    async ([url, name]) => {
      const [tab] = await chrome.tabs.query({ url });
      await (globalThis as any).workitCommand(name, tab);
    },
    [page.url(), command],
  );

test("after a fill, Answer 1 of N goes to the page's first red field and stays there until it is answered", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);

  const said = (await mainButton(page).innerText()).replace(/\s+/g, " ");
  const open = Number(said.match(/^Answer 1 of (\d+)$/)?.[1]);
  expect(open).toBeGreaterThan(0);
  // "of N" counts the red rows, never the guesses to check, and the red box says the same.
  const red = hostOf(page).locator('[data-tab="autofill"] .row[data-key][data-mark="needs-you"]');
  await expect(red).toHaveCount(open);
  await expect(needsBox(page).locator(".box-head")).toHaveText(`${open} ${open === 1 ? "Needs" : "Need"} Your Answer`);

  // The button focuses the first red field of the form, and pressed again, the same one: nothing moved on.
  const first = await red.first().getAttribute("data-key");
  await mainButton(page).click();
  await expect(hostOf(page).locator("[data-current]")).toHaveAttribute("data-key", first!);
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("#workit-autofiller-overlay-host"))).toBe(true);
  await mainButton(page).click();
  await expect(hostOf(page).locator("[data-current]")).toHaveAttribute("data-key", first!);
  expect(forms.submissions).toEqual([]);
});

test("Alt+N runs Next Thing, and Chrome binds it", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);
  const bound = await loaded.worker.evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === "next-thing")?.shortcut);
  expect(bound).toMatch(/Alt\+N|⌥N/);

  await pressCommand(page, "next-thing");
  await expect(hostOf(page).locator("[data-current]")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(forms.submissions).toEqual([]);
});

test("with nothing red, Review and submit scrolls to the employer's Submit and rings it, and sends nothing", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);
  // The student answers whatever needs them: the button shows each red field in turn, staying on one until it is
  // answered, so each answer is read back before the next press.
  for (let n = 0; n < 15 && !/Review and submit/.test(await mainButton(page).innerText()); n++) {
    await mainButton(page).click();
    const row = hostOf(page).locator("[data-current]");
    await expect(row).toHaveCount(1);
    const key = (await row.getAttribute("data-key"))!;
    // A dropdown WorkIt has no answer for, focused: the student picks its first option.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(hostOf(page).locator(`.row[data-key="${key}"]`)).not.toHaveAttribute("data-mark", "needs-you", { timeout: 10_000 });
  }
  await expect(mainButton(page)).toHaveText("Review and submit");
  await expect(needsBox(page)).toHaveCount(0);

  // From where the last answer left the page.
  await mainButton(page).click();
  const submit = page.getByRole("button", { name: /^Submit/ });
  await expect(submit).toBeInViewport();
  // The ring (marks.js) sits over the Submit button, and the page stays there.
  await expect(page.locator("#workit-marks-host").locator(".ring")).toBeAttached();
  await page.waitForTimeout(1500);
  await expect(submit).toBeInViewport();
  // Nothing of WorkIt's covers it (Anduril's sits at the right, under the open panel): a press there reaches it.
  expect(await submit.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button") === el;
  })).toBe(true);
  expect(forms.submissions).toEqual([]);
});

test("Fill Again asks once; Cancel leaves the page as it is", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);
  await page.locator("#first_name").fill("Changed");

  await (await menuItem(hostOf(page), "Fill Again")).click();
  await expect(primaryOf(page).getByText("This replaces what you changed on this page.")).toBeVisible();
  await primaryOf(page).getByRole("button", { name: "Cancel" }).click();
  await expect(primaryOf(page).locator("[data-confirm]")).toBeHidden();
  await page.waitForTimeout(2000);
  await expect(page.locator("#first_name")).toHaveValue("Changed");

  await (await menuItem(hostOf(page), "Fill Again")).click();
  await primaryOf(page).locator("[data-confirm]").getByRole("button", { name: "Fill Again" }).click();
  // Said yes: the form fills again, and the button comes back once it is done.
  await expect(mainButton(page)).toHaveText("Filling…");
  await expect(mainButton(page)).toContainText(/^Answer \d+ of \d+$/, { timeout: 90_000 });
  expect(forms.submissions).toEqual([]);
});

test("on a Workday step outside a batch, the button reads Fill this step", async () => {
  test.setTimeout(90_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  await start([workdays.handler]);
  const page = await loaded.context.newPage();
  await page.goto(workdays.url(0));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 20_000 });
  await expect(mainButton(page)).toHaveText("Fill this step");
  await mainButton(page).click();
  await expect(page.locator("[data-automation-id=formField-legalName--firstName] input")).not.toHaveValue("", { timeout: 60_000 });
  expect(page.url()).toBe(workdays.url(0)); // the step only: nothing pressed
  expect(workdays.submissions).toEqual([]);
});

test("a filled Workday step with nothing red asks for Save and Continue, not 1 need you", async () => {
  test.setTimeout(90_000);
  const workdays = new FakeWorkdays(["workday-caci"]);
  await start([workdays.handler]);
  const page = await loaded.context.newPage();
  await page.goto(workdays.url(0));
  await hostOf(page).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 20_000 });
  await mainButton(page).click();
  // The step's line tells the student what's next; the button carries it, so it isn't a thing that needs them.
  await expect(mainButton(page)).toHaveText("Go to Save and Continue", { timeout: 60_000 });
  await expect(needsBox(page)).toHaveCount(0);
  expect(workdays.submissions).toEqual([]);
});

test("a company careers page that embeds Greenhouse's form: Autofill This Page works in its iframe", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms(["greenhouse-coinbase"]);
  const careers = "https://www.acme-robotics.example/careers/job?gh_jid=8175510";
  const companyPage: Handler = ({ url }) =>
    url.host === "www.acme-robotics.example"
      ? { headers: { "content-type": "text/html" }, body: `<!doctype html><title>Careers</title><h1>Software Engineer</h1><iframe id="grnhse_iframe" width="100%" height="2000" src="${forms.url("greenhouse-coinbase")}"></iframe>` }
      : undefined;
  await start([companyPage, forms.handler]);
  const page = await loaded.context.newPage();
  await page.goto(careers);
  const frame = () => page.frames().find((f) => f.url().includes("/embed/job_app"))!;
  await expect.poll(() => Boolean(frame())).toBe(true);
  await hostOf(frame()).getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 20_000 });
  await mainButton(frame()).click();
  await expect(frame().locator("#first_name")).toHaveValue("Test", { timeout: 60_000 });
  await expect(mainButton(frame())).not.toHaveText("Autofill This Page", { timeout: 30_000 });
  expect(forms.submissions).toEqual([]);
});
