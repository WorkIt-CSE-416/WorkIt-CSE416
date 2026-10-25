// Batch apply (KAN-370), end to end: the unpacked extension in Chromium
// (loaded-extension.ts) fills the queued job postings' saved forms, at most
// five at a time, each in its own background tab, and sorts the tabs into the
// "Ready" and "Needs you" tab groups. The WorkIt API is faked (fake-api.ts);
// the forms are the Fill engine's saved ones (fake-job-systems.ts).
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms, uncoveredForm } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "./loaded-extension";

const GREENHOUSE = ["greenhouse-arc", "greenhouse-purestorage", "greenhouse-anduril", "greenhouse-coinbase", "greenhouse-datacor"];

type Tab = { id: number; url?: string; active: boolean; group: { title: string; color: string } | null };

/** Every tab, with its group's title and colour, as the student's tab strip shows them. */
function tabs(worker: Worker): Promise<Tab[]> {
  return worker.evaluate(async () => {
    const groups = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, { title: g.title!, color: g.color }]));
    return (await chrome.tabs.query({})).map((t) => ({ id: t.id!, url: t.url, active: t.active, group: groups.get(t.groupId) ?? null }));
  });
}

let loaded: Loaded;
test.afterEach(() => loaded?.close());

/** The extension, signed in, with `api`'s queue, and the webapp's Auto Apply page open: the tab the student is on. */
async function start(api: FakeApi, forms: SavedForms): Promise<{ webappPage: Page; before: Set<number> }> {
  loaded = await loadExtension([api.handler, webapp, forms.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  return { webappPage, before: new Set((await tabs(loaded.worker)).map((t) => t.id)) };
}

test("fills a batch five tabs at a time into the Ready and Needs you groups", async () => {
  test.setTimeout(180_000);
  const forms = new SavedForms(GREENHOUSE);
  const api = new FakeApi().queue(
    ...GREENHOUSE.map((name, n) => ({ id: `job-${n}`, apply_url: forms.url(name) })),
    { id: "job-5", apply_url: uncoveredForm(5) },
    { id: "job-6", apply_url: uncoveredForm(6) },
  );
  const { webappPage, before } = await start(api, forms);

  // Start Auto Apply's one click: the webapp asks the extension to start.
  const answer = await sendFromWebapp(webappPage, { type: "run/open" });
  expect(answer).toMatchObject({ ok: true, opened: true });

  // Watch the tab strip: a tab not yet in a group is still filling.
  let mostFilling = 0;
  let groupedWhenTheSixthOpened = -1;
  let batch: Tab[] = [];
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    batch = (await tabs(loaded.worker)).filter((t) => !before.has(t.id));
    const filling = batch.filter((t) => !t.group).length;
    mostFilling = Math.max(mostFilling, filling);
    if (batch.length > 5 && groupedWhenTheSixthOpened < 0) groupedWhenTheSixthOpened = batch.length - filling;
    if (batch.length === 7 && filling === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  expect(batch).toHaveLength(7);
  expect(mostFilling).toBe(5);
  // The sixth opened only once a tab had finished.
  expect(groupedWhenTheSixthOpened).toBeGreaterThan(0);
  const inGroup = (title: string) => batch.filter((t) => t.group?.title === title);
  // Arc's form takes every answer from the profile; each other one asks something WorkIt has no answer for,
  // and the two careers sites have no Filler: nothing filled there.
  expect(inGroup("Ready").map((t) => t.url)).toEqual([forms.url("greenhouse-arc")]);
  expect(inGroup("Ready")[0].group!.color).toBe("green");
  expect(inGroup("Needs you")).toHaveLength(6);
  expect(inGroup("Needs you")[0].group!.color).toBe("orange");
  await expect.poll(() => Object.fromEntries(api.stages)).toEqual({
    "job-0": "queued", "job-1": "needs_you", "job-2": "needs_you", "job-3": "needs_you", "job-4": "needs_you", "job-5": "needs_you", "job-6": "needs_you",
  });

  // The student stayed where they were, and nothing was submitted.
  expect((await tabs(loaded.worker)).find((t) => t.active)?.url).toBe("http://localhost:3000/auto-apply");
  expect(forms.submissions).toEqual([]);
});

test("a tab moves to Needs you when a field empties, and back to Ready when it is answered", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const { webappPage } = await start(api, forms);
  await sendFromWebapp(webappPage, { type: "run/open" });
  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Ready");

  const form = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  await form.locator("#first_name").fill("");
  await expect.poll(groupOfArc, { timeout: 15_000 }).toBe("Needs you");
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");

  await form.locator("#first_name").fill("Test");
  await expect.poll(groupOfArc, { timeout: 15_000 }).toBe("Ready");
  await expect.poll(() => api.stages.get("job-0")).toBe("queued");
  expect(forms.submissions).toEqual([]);
});

test("a job board's posting opens the employer's form it names, and never the job board", async () => {
  test.setTimeout(90_000);
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue(
    // The API names no form for this one: an older queued row, from before the queue refused job boards.
    { id: "job-0", apply_url: "https://www.indeed.com/viewjob?jk=1a2b3c", form_url: null },
    { id: "job-1", apply_url: "https://www.linkedin.com/jobs/view/4012345678", form_url: forms.url("greenhouse-arc") },
    // Whatever the API says, a job board's link is never opened.
    { id: "job-2", apply_url: "https://www.linkedin.com/jobs/view/4012345679", form_url: "https://www.linkedin.com/jobs/view/4012345679/apply" },
  );
  const { webappPage, before } = await start(api, forms);

  const answer = await sendFromWebapp(webappPage, { type: "run/open" });
  expect(answer).toMatchObject({ ok: true, opened: true, jobIds: ["job-1"] });

  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Ready");
  const batch = (await tabs(loaded.worker)).filter((t) => !before.has(t.id));
  expect(batch.map((t) => t.url)).toEqual([forms.url("greenhouse-arc")]);
  // The refused ones keep their stage: nothing was filled for them.
  expect(Object.fromEntries(api.stages)).toEqual({ "job-0": "queued", "job-1": "queued", "job-2": "queued" });
  expect(forms.submissions).toEqual([]);
});
