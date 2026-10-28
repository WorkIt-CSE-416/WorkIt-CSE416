// Request this job system (KAN-369): on a job page WorkIt can't fill, the
// toolbar popup says so and offers Request this job system, which sends the
// page's host and nothing else (POST /job-system-requests). Once requested,
// the popup says so for that host instead of asking again. Fake API only.
import { expect, test } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { EXTENSION_ID, loadExtension, signIn, webapp, type Loaded } from "./loaded-extension";

// Where screenshots for Lisul go (none when unset).
const SHOTS = process.env.CHECKLIST_SHOTS;

let loaded: Loaded;
test.afterEach(() => loaded?.close());

test("on a job page WorkIt can't fill, Request this job system sends only the host, once", async () => {
  const HOST = "jobs.example-ats.com";
  const page = `https://${HOST}/acme/jobs/42?ref=mail`;
  const site = ({ url }: { url: URL }) =>
    url.host === HOST ? { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Intern</title><h1>Software Intern</h1><input name=email>" } : undefined;
  const api = new FakeApi();
  loaded = await loadExtension([api.handler, webapp, site], { grantHosts: [`https://${HOST}/*`] });
  await signIn(loaded.context);
  const tab = await loaded.context.newPage();
  await tab.goto(page);
  const tabId = await loaded.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, tab.url());
  const openPopup = async () => {
    const popup = await loaded.context.newPage();
    await popup.goto(`chrome-extension://${EXTENSION_ID}/src/popup/popup.html?tab=${tabId}`);
    await expect(popup.getByText("WorkIt can't fill this site yet")).toBeVisible();
    return popup;
  };

  const popup = await openPopup();
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/popup-request-before.png` });
  // Nothing leaves on opening the popup.
  expect(api.systemRequests).toEqual([]);
  await popup.getByRole("button", { name: "Request this job system" }).click();
  await expect(popup.getByText("Requested. WorkIt adds the job systems students ask for most.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Request this job system" })).toBeHidden();
  expect(api.systemRequests).toEqual([{ host: HOST }]);
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/popup-request-after.png` });

  // Opened again on the same site: it says it was requested, and asks nothing.
  const again = await openPopup();
  await expect(again.getByText("You requested this job system.")).toBeVisible();
  await expect(again.getByRole("button", { name: "Request this job system" })).toBeHidden();
  expect(api.systemRequests).toEqual([{ host: HOST }]);
});
