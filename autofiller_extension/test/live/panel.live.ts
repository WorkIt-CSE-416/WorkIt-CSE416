// KAN-460's live check of a posting batch apply can't open (SuccessFactors'
// jobs2web career sites, which the API won't queue): the student opens the
// posting, presses the toolbar icon (activeTab, here granted as grantHosts)
// and the panel's primary button. Run by hand only, like rehearse.live.ts:
//
//   URLS='["https://..."]' OUT=out/panel HOSTS='["https://*.jobs2web.com/*"]' \
//     npx playwright test -c live/live.config.ts panel.live.ts
//
// It never submits and presses nothing on the employer's page.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { loadExtension, signIn, webapp } from "../loaded-extension";
import { localApi, readPanel, sendReport } from "./helpers";

const OUT = process.env.OUT ?? "out/panel";

test("fill live postings from the panel", async () => {
  test.setTimeout(20 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const loaded = await loadExtension([localApi, webapp], { live: true, grantHosts: JSON.parse(process.env.HOSTS ?? "[]") });
  try {
    await signIn(loaded.context, process.env.TOKEN ?? "kan324-local-token");
    for (const [n, url] of (JSON.parse(process.env.URLS!) as string[]).entries()) {
      const page = await loaded.context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5_000);
      await loaded.worker.evaluate(async (u) => {
        const [tab] = await chrome.tabs.query({ url: u.split("#")[0] });
        await (globalThis as any).workitToolbar(tab);
      }, page.url());
      const host = page.locator("#workit-autofiller-overlay-host");
      const primary = host.locator('[data-slot="primary"] .primary-button').first();
      const before = await primary.innerText({ timeout: 20_000 }).catch(() => "no panel");
      if (before !== "no panel") await primary.click().catch(() => {});
      await page.waitForTimeout(60_000);
      const panel = await readPanel(page);
      await page.screenshot({ path: join(OUT, `${n + 1}.png`) }).catch(() => {});
      const report = await sendReport(page);
      appendFileSync(join(OUT, "results.jsonl"), JSON.stringify({ url, final_url: page.url(), pressed: before, report, panel }) + "\n");
      await page.close();
    }
  } finally {
    await loaded.close();
  }
});
