// Batch apply over a session (KAN-373), end to end in the loaded extension
// (loaded-extension.ts): a batch picks up where it stopped after Chrome
// closes, Skip drops a job, and Workday applications take one slot at a time.
// The WorkIt API is faked (fake-api.ts); the forms are saved ones
// (fake-job-systems.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

type Tab = { id: number; url?: string; group: string | null; autoDiscardable: boolean };

/** Every tab, with its group's title, as the student's tab strip shows them. */
function tabs(worker: Worker): Promise<Tab[]> {
  return worker.evaluate(async () => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title!]));
    return (await chrome.tabs.query({})).map((t) => ({
      id: t.id!, url: t.url || t.pendingUrl, group: groups.get(t.groupId) ?? null, autoDiscardable: t.autoDiscardable,
    }));
  });
}

/**
 * Greenhouse links whose page waits until `release()`: a tab on one stays
 * filling meanwhile. Once released it shows a form the Fill engine can't plan
 * (its job isn't on the Job Board API), so the tab goes to Needs you.
 */
class SlowForms {
  private go!: () => void;
  private gate = new Promise<void>((done) => (this.go = done));
  url = (n: number) => `https://job-boards.greenhouse.io/slowco/jobs/${n}`;
  release = () => this.go();
  readonly handler: Handler = async ({ url }) => {
    if (!url.pathname.startsWith("/slowco/")) return undefined;
    await this.gate;
    return { headers: { "content-type": "text/html" }, body: "<!doctype html><title>Apply</title><form><label>First name <input id=first_name></label></form>" };
  };
}

let loaded: Loaded | undefined;
const profiles: string[] = [];
test.afterEach(async () => {
  await loaded?.close();
  loaded = undefined;
  profiles.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

async function openWebapp(): Promise<Page> {
  const page = loaded!.context.pages()[0] ?? (await loaded!.context.newPage());
  await page.goto("http://localhost:3000/auto-apply");
  return page;
}

test("a batch Chrome closed mid-way picks up where it stopped, without filling its finished tabs again", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms(["greenhouse-arc"]);
  const slow = new SlowForms();
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `job-${n}`, apply_url: slow.url(n) })),
  );
  const handlers = [api.handler, webapp, slow.handler, forms.handler];
  const profile = mkdtempSync(join(tmpdir(), "workit-extension-"));
  profiles.push(profile);
  // As the student's Chrome set to "Continue where you left off".
  const start = () => loadExtension(handlers, { profile, args: ["--restore-last-session"] });

  loaded = await start();
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  // Arc's form fills and is Ready; five slow ones fill; job-6 waits in the queue.
  await expect.poll(async () => (await tabs(loaded!.worker)).filter((t) => t.url?.includes("greenhouse")).length, { timeout: 60_000 }).toBe(6);
  await expect.poll(async () => (await tabs(loaded!.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group, { timeout: 60_000 }).toBe("Ready");

  // Chrome closes, and opens again with the same profile.
  await loaded.context.close();
  loaded = await start();
  slow.release();

  const batch = async () => (await tabs(loaded!.worker)).filter((t) => t.url?.includes("greenhouse"));
  await expect.poll(async () => (await batch()).filter((t) => t.group).length, { timeout: 90_000 }).toBe(7);
  const after = await batch();
  // Each job in one tab: Chrome's restored ones were taken back, not opened again.
  expect(after.map((t) => t.url).sort()).toEqual([forms.url("greenhouse-arc"), ...[1, 2, 3, 4, 5, 6].map(slow.url)].sort());
  expect(after.find((t) => t.url === forms.url("greenhouse-arc"))!.group).toBe("Ready");
  // Memory Saver may not unload any of them.
  expect(after.map((t) => t.autoDiscardable)).toEqual(after.map(() => false));
  // Arc's finished tab was not filled again: the Fill engine was never loaded into its restored page.
  const arc = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  expect(await arc.evaluate(() => typeof (window as any).FillEngine)).toBe("undefined");
  expect(Object.fromEntries(api.stages)).toEqual({
    "job-0": "queued", "job-1": "needs_you", "job-2": "needs_you", "job-3": "needs_you", "job-4": "needs_you", "job-5": "needs_you", "job-6": "needs_you",
  });
  expect(forms.submissions).toEqual([]);
});

/** Presses the Skip button on the WorkIt panel in a batch tab's page, as the student does. */
async function skip(page: Page): Promise<void> {
  const button = page.locator("#workit-autofiller-overlay-host [data-skip]");
  await button.waitFor({ timeout: 30_000 });
  await button.click();
}

test("Skip marks the job skipped, closes its tab, and the batch goes on", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-purestorage"]);
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    { id: "job-1", apply_url: forms.url("greenhouse-purestorage") },
  );
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  await sendFromWebapp(await openWebapp(), { type: "run/open" });
  const groupOf = async (url: string) => (await tabs(loaded!.worker)).find((t) => t.url === url)?.group;
  await expect.poll(() => groupOf(forms.url("greenhouse-arc")), { timeout: 60_000 }).toBe("Ready");
  await expect.poll(() => groupOf(forms.url("greenhouse-purestorage")), { timeout: 60_000 }).toBe("Needs you");

  await skip(loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-purestorage"))!);

  await expect.poll(async () => (await tabs(loaded!.worker)).map((t) => t.url)).not.toContain(forms.url("greenhouse-purestorage"));
  await expect.poll(() => api.stages.get("job-1")).toBe("skipped");
  // The other tab is left as it was, and the batch carries on without the skipped job.
  expect(await groupOf(forms.url("greenhouse-arc"))).toBe("Ready");
  expect(api.stages.get("job-0")).toBe("queued");
  expect(await loaded.worker.evaluate(async () => Object.values((await chrome.storage.local.get("workit_batch")).workit_batch.tabs).map((t: any) => t.jobId))).toEqual(["job-0"]);
  expect(forms.submissions).toEqual([]);
});
