// Batch apply (KAN-370), end to end: the unpacked extension in Chromium
// (loaded-extension.ts) fills the queued job postings' saved forms, at most
// five at a time, each in its own background tab, and sorts the tabs into the
// "Ready" and "Needs you" tab groups. The WorkIt API is faked (fake-api.ts);
// the forms are the Fill engine's saved ones (fake-job-systems.ts).
import { expect, test, type Page, type Worker } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { SavedForms, uncoveredForm } from "./fake-job-systems";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded } from "./loaded-extension";

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

/** `forms`' handler, with `script` added to the saved form `name`'s page: the form misbehaving as a live one may. */
function withScript(forms: SavedForms, name: string, script: string): Handler {
  return async (request) => {
    const reply = await forms.handler(request);
    if (!reply || request.method !== "GET" || request.url.href !== forms.url(name)) return reply;
    return { ...reply, body: String(reply.body).replace("<head>", `<head><script>${script}</script>`) };
  };
}

// The name box silently rejects what is typed in it: the form's own code never hears of it, and the box stays empty.
const DROPS_FIRST_NAME = `window.addEventListener("input", (e) => {
  if (e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "";
}, true);`;

test("a field that silently rejects its answer is flagged, and its tab needs you", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  loaded = await loadExtension([api.handler, webapp, withScript(forms, "greenhouse-arc", DROPS_FIRST_NAME)]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");

  await sendFromWebapp(webappPage, { type: "run/open" });
  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  // Arc's form is Ready when every field takes its answer (the first test).
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Needs you");
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");

  const form = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  const row = form.locator('#workit-autofiller-overlay-host [data-key="first_name"]');
  await expect(row.locator(".reason")).toHaveText("meant 'Test', page shows ''");
  expect(forms.submissions).toEqual([]);
});

test("Next Thing That Needs You walks every flagged field across the tabs in batch order, then says none are left", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-anduril"]);
  const api = new FakeApi().queue(
    { id: "job-0", apply_url: forms.url("greenhouse-arc") },
    { id: "job-1", apply_url: forms.url("greenhouse-anduril") },
  );
  loaded = await loadExtension([api.handler, webapp, withScript(forms, "greenhouse-arc", DROPS_FIRST_NAME)]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  const batchGroups = async () => (await tabs(loaded.worker)).filter((t) => t.url?.startsWith("https://")).map((t) => t.group?.title);
  await expect.poll(batchGroups, { timeout: 90_000 }).toEqual(["Needs you", "Needs you"]);

  const page = (url: string) => loaded.context.pages().find((p) => p.url() === url)!;
  const panel = (url: string) => page(url).locator("#workit-autofiller-overlay-host");
  const shownTab = async () => (await tabs(loaded.worker)).find((t) => t.active)!.url!;
  // The student starts in the first tab and presses Next until nothing is left.
  const currentIn = async (url: string) => {
    const row = panel(url).locator("[data-current]");
    return (await row.count()) ? row.getAttribute("data-key") : null;
  };
  let at = forms.url("greenhouse-arc");
  const walked: [string, string][] = [];
  let left = "";
  for (let n = 0; n < 10 && !left; n++) {
    await panel(at).getByRole("button", { name: "Next Thing That Needs You" }).click();
    // Either it says nothing is left, or a tab shows a field it hasn't shown yet.
    const after = async () => {
      const said = panel(at).locator("[data-said]");
      if (await said.isVisible()) return `said: ${await said.innerText()}`;
      const url = await shownTab();
      const key = await currentIn(url);
      return key && JSON.stringify([url, key]) !== JSON.stringify(walked.at(-1)) ? JSON.stringify([url, key]) : "waiting";
    };
    await expect.poll(after).not.toBe("waiting");
    const step = await after();
    if (step.startsWith("said: ")) {
      left = step.slice("said: ".length);
      break;
    }
    const [url, key] = JSON.parse(step);
    walked.push([url, key]);
    at = url;
    // The field itself is brought into view and focused.
    expect(await page(at).evaluate(() => document.activeElement?.id)).toBe(key);
  }

  // Arc's one flagged field (its name box rejected the answer), then Anduril's, in batch order.
  expect(walked).toEqual([
    [forms.url("greenhouse-arc"), "first_name"],
    [forms.url("greenhouse-anduril"), "question_13130330007"],
    [forms.url("greenhouse-anduril"), "question_13130331007"],
  ]);
  expect(left).toBe("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

/** The text the phone's country picker beside Phone shows on Greenhouse's form (its dial code), "" when none is picked. */
const phoneCountryShown = (form: Page) =>
  form.locator("#country").locator("xpath=ancestor::div[contains(@class, 'select__control')]").locator(".select__single-value").allInnerTexts();

test("a US phone's country is picked beside Phone, so Arc's form is ready to send", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const { webappPage } = await start(api, forms);
  await sendFromWebapp(webappPage, { type: "run/open" });
  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Ready");

  // Greenhouse refuses a submit with a number in Phone and no country beside it ("Select a country").
  const form = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  expect(await phoneCountryShown(form)).toEqual(["+1"]);
  expect(forms.submissions).toEqual([]);
});
