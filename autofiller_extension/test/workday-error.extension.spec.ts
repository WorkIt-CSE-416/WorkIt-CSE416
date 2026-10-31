// Workday's "Something went wrong" page, end to end in the loaded extension:
// live, the step shows on the next load (Salesforce's), so the extension
// reloads once by itself and tells the student only when the error is back.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

let loaded: Loaded | undefined;
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
});

test("Workday's error page is reloaded once by itself, and the student is told only when it is back", async () => {
  test.setTimeout(120_000);
  const workdays = new FakeWorkdays(["workday-caci"], undefined, [{ wentWrong: 2 }]);
  const loads: string[] = [];
  const counted: Handler = (request) => {
    if (request.headers["sec-fetch-dest"] === "document") loads.push(request.url.href);
    return undefined;
  };
  const api = new FakeApi().queue({ id: "wd-0", apply_url: workdays.url(0) });
  loaded = await loadExtension([counted, api.handler, webapp, workdays.handler]);
  await signIn(loaded.context);
  const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await app.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(app, { type: "run/open" });

  await expect.poll(() => loaded!.context.pages().some((p) => p.url() === workdays.url(0)), { timeout: 30_000 }).toBe(true);
  const tab = loaded.context.pages().find((p) => p.url() === workdays.url(0))!;
  const note = tab.locator("#workit-autofiller-overlay-host .row").filter({ hasText: "Workday showed an error page" });
  await expect(note).toBeVisible({ timeout: 60_000 });
  // The first error page was reloaded once; the second, back after that reload, is the student's.
  expect(loads.filter((u) => u === workdays.url(0))).toHaveLength(2);
  await tab.waitForTimeout(3_000);
  expect(loads.filter((u) => u === workdays.url(0))).toHaveLength(2);
  expect(workdays.submissions).toEqual([]);
});
