// The panel's primary button (KAN-396): one big button whose words follow the
// student's next action. Autofill This Page before a fill (Fill this step on a
// Workday step outside a batch); Next Thing ("2 things need you") while
// anything is open, which Alt+N presses too; Ready to submit once nothing is,
// which scrolls to the employer's Submit and rings it, never pressing it.
// Under it, "Required 12 of 14 filled · 3 need you". Fill Again asks once.
import { expect, test, type Frame, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms } from "./fake-job-systems";
import { loadExtension, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

type Where = Page | Frame;
const hostOf = (page: Where) => page.locator("#workit-autofiller-overlay-host");
const primaryOf = (page: Where) => hostOf(page).locator('[data-slot="primary"]');
const mainButton = (page: Where) => primaryOf(page).locator(".primary-button").first();
const requiredLine = (page: Where) => primaryOf(page).locator("[data-required]");

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
  await expect(mainButton(page)).toContainText("Next Thing", { timeout: 60_000 });
  return page;
}

/** What the form itself holds: its required questions (Greenhouse marks their labels with an asterisk) and how many show an answer. */
const formCounts = (page: Page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll("label")].filter((l) => /\*\s*$/.test(l.textContent ?? "")).map((l) => l.parentElement!);
    const answered = boxes.filter(
      (box) => box.querySelector(".select__single-value, .select__multi-value") || [...box.querySelectorAll("input:not(.select__input), textarea")].some((i) => (i as HTMLInputElement).value.trim()),
    );
    return { total: boxes.length, filled: answered.length };
  });

/** The background's press of an extension command (Chrome gives a test no way to press its keys). */
const pressCommand = (page: Page, command: string) =>
  loaded.worker.evaluate(
    async ([url, name]) => {
      const [tab] = await chrome.tabs.query({ url });
      await (globalThis as any).workitCommand(name, tab);
    },
    [page.url(), command],
  );

test("after a fill, Next Thing goes to what needs you, and the required line matches the form", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);

  const said = (await mainButton(page).innerText()).replace(/\s+/g, " ");
  const open = Number(said.match(/(\d+) things? needs? you/)?.[1]);
  expect(open).toBeGreaterThan(0);
  const { total, filled } = await formCounts(page);
  expect(total).toBeGreaterThan(0);
  // "N need you" is the Needs you group's count, never with Check these' guesses in it.
  const needsYou = Number(await hostOf(page).locator('[data-group="needs-you"] .count').innerText());
  await expect(requiredLine(page)).toHaveText(`Required ${filled} of ${total} filled · ${needsYou} need you`);

  // Next Thing focuses a field of the form.
  await mainButton(page).click();
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest("#workit-autofiller-overlay-host"))).toBe(true);
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

test("with nothing open, Ready to submit scrolls to the employer's Submit and rings it, and sends nothing", async () => {
  test.setTimeout(150_000);
  const forms = new SavedForms([ANDURIL]);
  await start([forms.handler]);
  const page = await filledOwnTab(forms);
  // The student answers whatever needs them: Next Thing shows each in turn, and they type or say it looks right.
  for (let n = 0; n < 15 && !/Ready to submit/.test(await mainButton(page).innerText()); n++) {
    await mainButton(page).click();
    const row = hostOf(page).locator("[data-current]");
    await expect(row).toHaveCount(1);
    const looks = row.getByRole("button", { name: "Looks right" });
    if (await looks.count()) await looks.click();
    else {
      // A dropdown WorkIt has no answer for, focused: the student picks its first option.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(300);
  }
  await expect(mainButton(page)).toHaveText("Ready to submit");
  await expect(requiredLine(page)).not.toContainText("need you");

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

  await primaryOf(page).getByRole("button", { name: "Fill Again" }).click();
  await expect(primaryOf(page).getByText("This replaces what you changed on this page.")).toBeVisible();
  await primaryOf(page).getByRole("button", { name: "Cancel" }).click();
  await expect(primaryOf(page).locator("[data-confirm]")).toBeHidden();
  await page.waitForTimeout(2000);
  await expect(page.locator("#first_name")).toHaveValue("Changed");

  await primaryOf(page).getByRole("button", { name: "Fill Again" }).click();
  await primaryOf(page).locator("[data-confirm]").getByRole("button", { name: "Fill Again" }).click();
  // Said yes: the form fills again, and the button comes back once it is done.
  await expect(mainButton(page)).toHaveText("Filling…");
  await expect(mainButton(page)).toContainText("Next Thing", { timeout: 90_000 });
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
