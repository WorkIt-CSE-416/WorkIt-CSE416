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

test("a fill that errors leaves its tab failed, not just needing the student, in the Needs you group", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  api.profileDown = true;
  const { webappPage } = await start(api, forms);
  await sendFromWebapp(webappPage, { type: "run/open" });
  const arc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"));
  await expect.poll(async () => (await arc())?.group?.title, { timeout: 60_000 }).toBe("Needs you");

  // The webapp's status says the fill failed; the application's stage is the one a failed fill maps to.
  const status = await sendFromWebapp(webappPage, { type: "run/status" });
  expect(status.jobs).toEqual([{ jobId: "job-0", state: "failed" }]);
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");
  expect(forms.submissions).toEqual([]);
});

test("a form the job system sends to its job search opens again, once", async () => {
  // Lockheed's Eightfold (seen live): two of its forms opened at once in a new session, one went to the job search.
  const form = "https://lockheedmartin.eightfold.ai/careers/apply?pid=1";
  let asked = 0;
  const eightfold: Handler = ({ url }) => {
    if (url.host !== "lockheedmartin.eightfold.ai") return undefined;
    const html = (body: string) => ({ headers: { "content-type": "text/html" }, body: `<!doctype html><title>Careers</title>${body}` });
    if (url.pathname === "/careers/apply") {
      asked += 1;
      return html(asked === 1 ? "<script>location.replace('/careers?start=0&pid=1')</script>" : "<form><input name=first></form>");
    }
    return html("<form><input name=search placeholder='Search for job title'></form>");
  };
  const api = new FakeApi().queue({ id: "job-0", apply_url: "https://lockheedmartin.eightfold.ai/careers/job/1" });
  loaded = await loadExtension([api.handler, webapp, eightfold]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  // The tab is back on the form (its fill then runs, as on any form).
  await expect.poll(async () => (await tabs(loaded.worker)).some((t) => t.url === form), { timeout: 30_000 }).toBe(true);
  expect(asked).toBe(2);
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

test("a hosted Greenhouse job its company shows on its own site opens in its embedded form", async () => {
  // Coinbase's board sends its hosted page to coinbase.com, where the form is in an iframe; the Job Board API names that page.
  const forms = new SavedForms(["greenhouse-coinbase"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: "https://job-boards.greenhouse.io/coinbase/jobs/8175510" });
  const { webappPage, before } = await start(api, forms);

  expect(await sendFromWebapp(webappPage, { type: "run/open" })).toMatchObject({ ok: true, opened: true });
  const opened = async () => (await tabs(loaded.worker)).filter((t) => !before.has(t.id)).map((t) => t.url);
  await expect.poll(opened, { timeout: 30_000 }).toEqual([forms.url("greenhouse-coinbase")]);
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

// The name box silently rejects what is typed in it: the form's own code never hears of it, and the box stays empty
// (until the test sends "workit-test-stop-dropping", the student's own typing).
const DROPS_FIRST_NAME = `let dropping = true;
window.addEventListener("workit-test-stop-dropping", () => (dropping = false));
window.addEventListener("input", (e) => {
  if (!dropping || e.target.id !== "first_name") return;
  e.stopImmediatePropagation();
  e.target.value = "";
}, true);`;

/**
 * `forms`' handler, with a human check (Cloudflare's, seen live) where the saved form `name` should be: its page
 * says "Verify you are human" until `pass()`; the page then loads the form.
 */
function humanCheckFirst(forms: SavedForms, name: string): { handler: Handler; pass: () => void } {
  let passed = false;
  const handler: Handler = (request) => {
    if (passed || request.method !== "GET" || request.url.href !== forms.url(name)) return forms.handler(request);
    return {
      headers: { "content-type": "text/html" },
      body: "<!doctype html><title>Just a moment...</title><h1>Verify you are human</h1><p>Complete the action below to continue.</p>",
    };
  };
  return { handler, pass: () => { passed = true; } };
}

test("a human check before the form needs the student, and the form fills once they pass it", async () => {
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const check = humanCheckFirst(forms, "greenhouse-arc");
  loaded = await loadExtension([api.handler, webapp, check.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });

  // The check needs the student, and the fill has not failed.
  const state = async () => (await sendFromWebapp(webappPage, { type: "run/status" })).jobs[0]?.state;
  await expect.poll(state, { timeout: 30_000 }).toBe("needs_you");
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");

  // The student passes it, and the page loads the form: it fills, and Arc's form takes every answer.
  check.pass();
  const form = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  await form.reload();
  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Ready");
  await expect(form.locator("#first_name")).toHaveValue("Test");
  expect(forms.submissions).toEqual([]);
});

test("a human check's tab says what the student must do, and Next Thing takes them to it", async () => {
  test.setTimeout(120_000);
  const [ARC, ANDURIL] = ["greenhouse-arc", "greenhouse-anduril"];
  const forms = new SavedForms([ARC, ANDURIL]);
  const check = humanCheckFirst(forms, ARC);
  const api = new FakeApi().queue({ id: "job-0", apply_url: forms.url(ARC) }, { id: "job-1", apply_url: forms.url(ANDURIL) });
  loaded = await loadExtension([api.handler, webapp, check.handler]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  await expect.poll(() => [api.stages.get("job-0"), api.stages.get("job-1")], { timeout: 60_000 }).toEqual(["needs_you", "needs_you"]);

  const row = page(forms.url(ARC)).locator('#workit-autofiller-overlay-host [data-key="_human_check"]');
  await expect(row.locator(".label")).toHaveText("Prove you're human on this page");
  await expect(row.locator(".reason")).toHaveText("WorkIt fills the form once it shows.");

  // From Anduril's tab, the first thing is Arc's check (Arc opened first), then Anduril's own questions.
  await expect(page(forms.url(ANDURIL)).locator("#workit-autofiller-overlay-host [data-key]").first()).toBeAttached({ timeout: 60_000 });
  const { walked } = await walkToEnd(forms.url(ANDURIL), { most: 2 });
  expect(walked).toEqual([[forms.url(ARC), "_human_check"], [forms.url(ANDURIL), "question_13130330007"]]);

  // Passed, the form fills with its own panel in place of the check's.
  check.pass();
  await page(forms.url(ARC)).reload();
  await expect(page(forms.url(ARC)).locator("#first_name")).toHaveValue("Test", { timeout: 60_000 });
  await expect(page(forms.url(ARC)).locator("#workit-autofiller-overlay-host")).toHaveCount(1);
  expect(forms.submissions).toEqual([]);
});

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

/**
 * Presses "Next Thing That Needs You" in the tab `at` shows, then in whichever tab it went to, until it
 * says nothing is left (at most `most` presses): each step's [tab link, row key], and what it said.
 * `onStep` runs after each step, as the student would act on what it showed.
 */
/** The batch tab showing the form at `url`. */
const page = (url: string) => loaded.context.pages().find((p) => p.url().startsWith(url.split("?")[0]))!;

async function walkToEnd(at: string, { most = 20, onStep = async (_url: string, _key: string) => {} } = {}) {
  const panel = (url: string) => page(url).locator("#workit-autofiller-overlay-host");
  const shownTab = async () => (await tabs(loaded.worker)).find((t) => t.active)!.url!;
  const currentIn = async (url: string) => {
    const row = panel(url).locator("[data-current]");
    return (await row.count()) ? row.getAttribute("data-key") : null;
  };
  const walked: [string, string][] = [];
  let left = "";
  for (let n = 0; n < most && !left; n++) {
    const before = JSON.stringify(walked.at(-1));
    await panel(at).getByRole("button", { name: "Next Thing That Needs You" }).click();
    // Either it says nothing is left, or a tab shows a field it hasn't just shown.
    const after = async () => {
      const said = panel(at).locator("[data-said]");
      if (await said.isVisible()) return `said: ${await said.innerText()}`;
      const url = await shownTab();
      const key = await currentIn(url);
      return key && JSON.stringify([url, key]) !== before ? JSON.stringify([url, key]) : "waiting";
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
    await onStep(url, key);
  }
  return { walked, left };
}

/** Opens a batch of `forms`' saved forms, in order, and waits until every tab is in a group. */
async function startBatch(forms: SavedForms, names: string[], handlers: Handler[] = [forms.handler], fake = new FakeApi()) {
  const api = fake.queue(...names.map((name, n) => ({ id: `job-${n}`, apply_url: forms.url(name) })));
  loaded = await loadExtension([api.handler, webapp, ...handlers]);
  await signIn(loaded.context);
  const webappPage = loaded.context.pages()[0] ?? (await loaded.context.newPage());
  await webappPage.goto("http://localhost:3000/auto-apply");
  await sendFromWebapp(webappPage, { type: "run/open" });
  const grouped = async () => (await tabs(loaded.worker)).filter((t) => t.url?.startsWith("https://") && t.group).length;
  await expect.poll(grouped, { timeout: 90_000 }).toBe(names.length);
  return api;
}

test("Next Thing That Needs You walks every flagged field across the tabs in batch order, then says none are left", async () => {
  test.setTimeout(120_000);
  const forms = new SavedForms(["greenhouse-arc", "greenhouse-anduril"]);
  await startBatch(forms, ["greenhouse-arc", "greenhouse-anduril"], [withScript(forms, "greenhouse-arc", DROPS_FIRST_NAME)]);
  const { walked, left } = await walkToEnd(forms.url("greenhouse-arc"), {
    // The field itself is brought into view and focused.
    onStep: async (url, key) => expect(await page(url).evaluate(() => document.activeElement?.id)).toBe(key),
  });

  // Arc's one flagged field (its name box rejected the answer), then Anduril's, in batch order,
  // and Anduril's guess at how the student heard of it, once, for them to check.
  expect(walked).toEqual([
    [forms.url("greenhouse-arc"), "first_name"],
    [forms.url("greenhouse-anduril"), "question_13130330007"],
    [forms.url("greenhouse-anduril"), "question_13130331007"],
    [forms.url("greenhouse-anduril"), "question_13130335007"],
  ]);
  expect(left).toBe("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

test("Next Thing That Needs You passes over filled fields whose names start with an underscore (Ashby's own)", async () => {
  test.setTimeout(120_000);
  const HARVEY = "ashby-harvey";
  const forms = new SavedForms([HARVEY]);
  await startBatch(forms, [HARVEY]);
  let locationFocused = false;
  const { walked, left } = await walkToEnd(forms.url(HARVEY), {
    onStep: async (url, key) => {
      if (key === "_systemfield_location")
        locationFocused = await page(url).evaluate(() => Boolean(document.activeElement?.closest('[data-field-path="_systemfield_location"]')));
    },
  });
  const panelRow = (key: string) => page(forms.url(HARVEY)).locator(`#workit-autofiller-overlay-host [data-key="${key}"]`);

  // Harvey's name, email and resume are Ashby's "_systemfield_" fields, filled from the profile: never walked.
  for (const key of ["_systemfield_name", "_systemfield_email", "_systemfield_resume"]) {
    await expect(panelRow(key).locator(".source")).toHaveText("Profile");
    expect(walked.map(([, k]) => k)).not.toContain(key);
  }
  // Its location, which WorkIt has no answer for, is: a field, brought into view like any other.
  expect(walked.map(([, k]) => k)).toContain("_systemfield_location");
  expect(locationFocused).toBe(true);
  expect(await panelRow("_systemfield_location").locator(".label").innerText()).toBe("Current Location");
  expect(left).toBe("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

test("Next Thing That Needs You goes on from where it was when the student answers that field and the one before", async () => {
  test.setTimeout(120_000);
  const HARVEY = "ashby-harvey";
  const forms = new SavedForms([HARVEY]);
  await startBatch(forms, [HARVEY]);
  // Harvey's first four flagged fields, in page order: its location, a choice, a short question, then a written one.
  const [INTERNSHIPS, LAST, WHY] = ["7f6c3046-8557-4f77-869a-9e874d3ead38", "dfa930a1-8ce3-4246-a520-e2df415622c5", "e4d88906-fe42-43c1-bebc-05e24a4c967d"];
  const form = () => page(forms.url(HARVEY));
  const { walked } = await walkToEnd(forms.url(HARVEY), {
    most: 4,
    onStep: async (_url, key) => {
      if (key !== LAST) return;
      // On the second one, the student answers it and the first.
      await form().locator(`[data-field-path="${INTERNSHIPS}"] input`).first().check();
      await form().locator(`[data-field-path="${LAST}"] input`).fill("A rail signalling company");
      for (const name of [INTERNSHIPS, LAST]) {
        await expect(form().locator(`#workit-autofiller-overlay-host [data-key="${name}"] .source`)).toHaveText("You", { timeout: 10_000 });
      }
    },
  });

  // The next press goes to the written question after them, not past it.
  expect(walked.map(([, key]) => key)).toEqual(["_systemfield_location", INTERNSHIPS, LAST, WHY]);
  expect(forms.submissions).toEqual([]);
});

// Anduril's form never shows its work authorization question (as a form hides a follow-up its answer
// before doesn't call for): the question's box is taken off the page as soon as it is drawn.
const HIDES_WORK_AUTHORIZATION = `new MutationObserver(() => {
  document.getElementById("question_13130333007")?.closest(".select, .field-wrapper, fieldset")?.remove();
}).observe(document, { childList: true, subtree: true });`;

test("a required question the form doesn't show is left alone: Next Thing passes it over", async () => {
  test.setTimeout(120_000);
  const ANDURIL = "greenhouse-anduril";
  const forms = new SavedForms([ANDURIL]);
  await startBatch(forms, [ANDURIL], [withScript(forms, ANDURIL, HIDES_WORK_AUTHORIZATION)]);
  const row = page(forms.url(ANDURIL)).locator('#workit-autofiller-overlay-host [data-key="question_13130333007"]');
  await expect(row.locator(".reason")).toHaveText("The form didn't show this question");

  const { walked, left } = await walkToEnd(forms.url(ANDURIL));
  // Only the two questions WorkIt has no answer for, and its guess at how the student heard of Anduril.
  expect(walked.map(([, key]) => key)).toEqual(["question_13130330007", "question_13130331007", "question_13130335007"]);
  expect(left).toBe("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

test("a dropdown the student answers with the mouse alone no longer needs them: Next Thing passes it over", async () => {
  test.setTimeout(120_000);
  const ANDURIL = "greenhouse-anduril";
  const forms = new SavedForms([ANDURIL]);
  await startBatch(forms, [ANDURIL]);
  const form = page(forms.url(ANDURIL));
  // A click opens the dropdown and a click picks its first option: no typing, so no input event.
  await form.locator("#question_13130330007").click();
  await form.getByRole("option").first().click();
  const row = form.locator('#workit-autofiller-overlay-host [data-key="question_13130330007"]');
  await expect(row.locator(".source")).toHaveText("You", { timeout: 10_000 });

  const { walked } = await walkToEnd(forms.url(ANDURIL));
  expect(walked.map(([, key]) => key)).toEqual(["question_13130331007", "question_13130335007"]);
  expect(forms.submissions).toEqual([]);
});

test("once only fine rows are left, Next Thing says none are left, across the tabs in batch order", async () => {
  test.setTimeout(150_000);
  const [ARC, ANDURIL] = ["greenhouse-arc", "greenhouse-anduril"];
  const forms = new SavedForms([ARC, ANDURIL]);
  await startBatch(forms, [ARC, ANDURIL], [withScript(forms, ARC, DROPS_FIRST_NAME)]);
  const rowOf = (url: string, key: string) => page(url).locator(`#workit-autofiller-overlay-host [data-key="${key}"]`);
  // How Anduril heard of the student is a guess: the walk shows it once, for the student to check.
  const HEARD = "question_13130335007";
  await expect(rowOf(forms.url(ANDURIL), HEARD).locator(".source")).toHaveText("Guessed");

  // The student answers each field the walk shows them, Arc's first name and Anduril's two questions.
  const answer = async (url: string, key: string) => {
    const form = page(url);
    if (key === "first_name") {
      // Arc's box dropped WorkIt's typing (DROPS_FIRST_NAME); it takes the student's.
      await form.evaluate(() => window.dispatchEvent(new Event("workit-test-stop-dropping")));
      await form.locator("#first_name").fill("Sam");
    } else if (key !== HEARD) {
      await form.locator(`#${key}`).click();
      await form.getByRole("option").first().click();
    } else return;
    await expect(rowOf(url, key).locator(".source")).toHaveText("You", { timeout: 10_000 });
  };
  const first = await walkToEnd(forms.url(ARC), { onStep: answer });
  expect(first.walked.map(([url, key]) => [url === forms.url(ARC) ? "arc" : "anduril", key])).toEqual([
    ["arc", "first_name"],
    ["anduril", "question_13130330007"],
    ["anduril", "question_13130331007"],
    ["anduril", HEARD],
  ]);
  expect(first.left).toBe("Nothing else needs you.");

  // Pressed again, it starts over and finds nothing: every row left is filled and fine, the guess seen.
  const again = await walkToEnd(forms.url(ANDURIL));
  expect(again.walked).toEqual([]);
  expect(again.left).toBe("Nothing else needs you.");
  expect(forms.submissions).toEqual([]);
});

test("the next form fills a question the student saved as theirs with their answer, not WorkIt's guess", async () => {
  test.setTimeout(120_000);
  const ANDURIL = "greenhouse-anduril";
  const forms = new SavedForms([ANDURIL]);
  const HEARD = "question_13130335007";
  // What GET .../answer-bank gives once the student said a guess looked right, or changed it, on an earlier form.
  const api = new FakeApi();
  api.bank["How did you hear about Anduril?"] = { answer: "Handshake", own: true };
  await startBatch(forms, [ANDURIL], [forms.handler], api);

  const heard = () => page(forms.url(ANDURIL)).locator(`#workit-autofiller-overlay-host [data-key="${HEARD}"]`);
  await expect(heard().locator(".source")).toHaveText("You");
  const shown = page(forms.url(ANDURIL)).locator(`#${HEARD}`).locator("xpath=ancestor::div[contains(@class, 'select__control')]").locator(".select__single-value");
  await expect(shown).toHaveText("Handshake");
  const { walked } = await walkToEnd(forms.url(ANDURIL));
  expect(walked.map(([, key]) => key)).not.toContain(HEARD);
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

test("with a number in Phone and its country empty, the tab needs you until the country is picked", async () => {
  // A number written without its country code that isn't a US one: WorkIt can't tell its country and leaves
  // the picker to the student. Neither the Job Board API nor the page marks it required, but Greenhouse
  // refuses the submit with a number in Phone and no country beside it ("Select a country").
  const forms = new SavedForms(["greenhouse-arc"]);
  const api = new FakeApi({ phone_number: "020 7946 0958" }).queue({ id: "job-0", apply_url: forms.url("greenhouse-arc") });
  const { webappPage } = await start(api, forms);
  await sendFromWebapp(webappPage, { type: "run/open" });
  const groupOfArc = async () => (await tabs(loaded.worker)).find((t) => t.url === forms.url("greenhouse-arc"))?.group?.title;
  await expect.poll(groupOfArc, { timeout: 60_000 }).toBe("Needs you");
  await expect.poll(() => api.stages.get("job-0")).toBe("needs_you");

  const form = loaded.context.pages().find((p) => p.url() === forms.url("greenhouse-arc"))!;
  expect(await phoneCountryShown(form)).toEqual([]);
  const row = form.locator('#workit-autofiller-overlay-host [data-key="country"]');
  await expect(row.locator(".reason")).toHaveText("The form needs this before it sends. Answer it yourself.");

  // The student picks it: the tab is ready.
  await form.locator("#country").click();
  await form.locator("#country").pressSequentially("United Kingdom");
  await form.getByRole("option", { name: /^United Kingdom/ }).first().click();
  await expect.poll(groupOfArc, { timeout: 15_000 }).toBe("Ready");
  await expect.poll(() => api.stages.get("job-0")).toBe("queued");
  expect(forms.submissions).toEqual([]);
});
