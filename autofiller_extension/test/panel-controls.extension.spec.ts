// The panel's controls after the clean-up (KAN-369 Q4-Q6): the header is
// WorkIt, the job and Close; "I submitted this", Skip, Report a problem, Fill
// Again and Settings sit in one ⋯ menu; the red box counts; the Autofill / Resume
// / Answers tabs stay at the top; and one button sits at the bottom: "Answer 1
// of N" while anything needs the student. Anduril's saved Greenhouse form.
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, menuItem, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const ANDURIL = "greenhouse-anduril";

let loaded: Loaded;
test.afterEach(() => loaded?.close());

const hostOf = (page: Page) => page.locator("#workit-autofiller-overlay-host");
const mainButton = (page: Page) => hostOf(page).locator('[data-slot="primary"] .primary-button').first();

test("after a fill on the student's own tab: Close and ⋯ in the header, the red box, no tab strip, Answer 1 of N at the bottom", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  loaded = await loadExtension([new FakeApi().handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const page = await loaded.context.newPage();
  await page.goto(forms.url(ANDURIL));
  const host = hostOf(page);
  await host.getByRole("button", { name: "Show WorkIt panel" }).click({ timeout: 15_000 });
  await mainButton(page).click();
  await expect(mainButton(page)).toContainText(/^Answer \d+ of \d+$/, { timeout: 60_000 });

  // The header: WorkIt, ⋯ and Close; nothing else to press there.
  const header = host.locator(".header");
  await expect(header.getByRole("img", { name: "WorkIt" })).toBeVisible();
  await expect(header.getByRole("button")).toHaveCount(2);
  await expect(header.getByRole("button").first()).toHaveAccessibleName("More");
  await expect(header.getByRole("button").last()).toHaveAccessibleName("Close");
  await expect(header.getByRole("button", { name: "Close" })).toBeVisible();

  // The red box's count, and the button's N is the same rule's (lib-status.js).
  const red = Number((await host.locator('.box[data-box="needs-you"] .box-head').innerText()).match(/^(\d+) Needs? Your Answer$/)?.[1]);
  expect(red).toBeGreaterThan(0);
  await expect(mainButton(page)).toHaveText(`Answer 1 of ${red}`);
  await expect(host.locator('[data-slot="primary"] [data-required]')).toHaveCount(0);

  // The ⋯ menu: Fill Again, Report a problem and Settings; no batch's Skip or I submitted this here.
  await host.getByRole("button", { name: "More" }).click();
  await expect(host.getByRole("menuitem")).toHaveText(["Fill Again", "Report a problem", "Settings"]);
  await page.keyboard.press("Escape");
  await expect(host.getByRole("menuitem")).toHaveCount(0);

  // The header on top and the button at the bottom stay where they are while the list scrolls. No tab strip (KAN-424).
  await expect(host.locator(".tabs")).toBeHidden();
  const card = host.locator(".header");
  const before = { card: (await card.boundingBox())!.y, button: (await mainButton(page).boundingBox())!.y };
  await host.locator(".scroll").evaluate((el) => el.scrollBy(0, 400));
  expect((await card.boundingBox())!.y).toBe(before.card);
  expect((await mainButton(page).boundingBox())!.y).toBe(before.button);
  expect(before.button + 60).toBeGreaterThan(page.viewportSize()!.height - 60);

  // Settings from the menu, then Back to the list.
  await (await menuItem(host, "Settings")).click();
  await expect(host.locator('[data-slot="settings"]')).toBeVisible();
  await host.locator('[data-slot="settings"]').getByRole("button", { name: "Back" }).click();
  await expect(host.locator('[data-slot="settings"]')).toBeHidden();
  await expect(host.locator('.box[data-box="needs-you"]')).toBeVisible();
  expect(forms.submissions).toEqual([]);
});

test("a batch tab's ⋯ menu holds I submitted this and Skip; the header has neither", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms([ANDURIL]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = await loaded.context.newPage();
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => api.stages.get("job-0"), { timeout: 60_000 }).toBe("needs_you");
  const form = loaded.context.pages().find((p) => p.url() === forms.url(ANDURIL) && p !== webappPage && !p.isClosed())!;
  const host = hostOf(form);
  await expect(mainButton(form)).toContainText(/^Answer \d+ of \d+$/, { timeout: 30_000 });

  await expect(host.locator(".header").getByRole("button")).toHaveCount(2);
  await expect(host.locator(".header").getByRole("button", { name: "More" })).toBeVisible();
  await expect(host.locator(".header").getByRole("button", { name: "Close" })).toBeVisible();
  await host.getByRole("button", { name: "More" }).click();
  await expect(host.getByRole("menuitem")).toHaveText(["I submitted this", "Skip", "Fill Again", "Report a problem", "Settings"]);
  // A click the page's own script makes on the menu does nothing (trusted()).
  await host.locator("[data-skip]").evaluate((item: HTMLElement) => item.click());
  await form.waitForTimeout(500);
  expect(form.isClosed()).toBe(false);
  expect(forms.submissions).toEqual([]);
});
