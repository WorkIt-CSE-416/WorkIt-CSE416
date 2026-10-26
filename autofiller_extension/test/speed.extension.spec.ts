// How long a batch tab's fill takes, job system by job system: the unpacked
// extension loaded headless (loaded-extension.ts), one queued posting on a
// saved form of each system (the Fill engine's fakes), filled by run/open as
// the webapp's Start Auto Apply does. The probes (speed-probe.ts) only note
// the time; nothing in the extension or the engine is changed or skipped.
//
//   cd autofiller_extension/test
//   SPEED_OUT=<dir> SPEED_PREFIX=baseline SPEED_RUNS=5 npx playwright test speed.extension.spec.ts --workers=1
//
// SPEED_ONLY=greenhouse,lever picks systems. Each system writes
// <SPEED_OUT>/<prefix>-<system>.json (every run's numbers, and the last run's
// field values and panel rows, to diff "same fields, same values" against
// another prefix); the last test writes <prefix>-summary.md.
// Not a check: it asserts only that each form filled and sent nothing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FakeApi } from "./fake-api";
import { FakeWorkdays, SavedForms, SavedWorkable } from "./fake-job-systems";
import { FakeLever } from "../fill-engine/test/fake-lever";
import { FakeRippling } from "../fill-engine/test/fake-rippling";
import { FakeEightfold } from "../fill-engine/test/fake-eightfold";
import { STEPS } from "../fill-engine/test/fake-workday";
import { loadExtension, sendFromWebapp, signIn, webapp, type Handler, type Loaded, type Reply, type Request } from "./loaded-extension";
import { MAIN_PROBE, covered, median, sourceOf, timersBySite, workerProbe, type Timer } from "./speed-probe";

const OUT = process.env.SPEED_OUT ?? join(__dirname, "test-results", "speed");
const PREFIX = process.env.SPEED_PREFIX ?? "baseline";
const RUNS = Number(process.env.SPEED_RUNS ?? 5);
const ONLY = process.env.SPEED_ONLY?.split(",");
// How long nothing may change (a panel row, a field) after the fill's last phase for it to count as settled.
const QUIET_MS = 2_500;

/** Answers a request with a Fill engine fake's own route handler (its `handle`, TypeScript-private only). */
async function viaRoute(server: unknown, request: Request): Promise<Reply | undefined> {
  let reply: Reply | undefined;
  const route = {
    request: () => ({
      url: () => request.url.href, method: () => request.method, headers: () => request.headers,
      postData: () => request.body.toString(), postDataBuffer: () => request.body, postDataJSON: () => JSON.parse(request.body.toString()),
    }),
    fulfill: async ({ status = 200, contentType, body, json }: { status?: number; contentType?: string; body?: string | Buffer; json?: unknown }) => {
      reply = json !== undefined ? { status, json } : { status, headers: contentType ? { "content-type": contentType } : {}, body };
    },
    abort: async () => {},
    continue: async () => {},
  };
  await (server as any).handle(route);
  return reply;
}

// Lever's résumé parse (fake-lever.ts's PARSED, and its default 2 s, "as Lever's does").
const LEVER_PARSED = {
  name: "Parsed Name", email: "parsed@example.com", phone: "+1 555 010 0000", position: "Parsed Company",
  location: { name: "Parsed City, ZZ, USA", id: "parsed" }, links: [{ domain: "linkedin.com", url: "https://www.linkedin.com/in/parsed" }],
  resumeStorageId: "stored",
};
const LEVER_PARSE_MS = 2_000;

type System = { url: string; handler: Handler; submissions: () => unknown[] };
const onHost = (url: string, handler: Handler): Handler => (r) => (r.url.host === new URL(url).host ? handler(r) : undefined);

const SYSTEMS: Record<string, () => System> = {
  greenhouse: () => {
    const forms = new SavedForms(["greenhouse-arc"]);
    return { url: forms.url("greenhouse-arc"), handler: forms.handler, submissions: () => forms.submissions };
  },
  lever: () => {
    const lever = new FakeLever("lever-rhombus");
    const handler: Handler = async (r) => {
      if (r.method === "POST" && r.url.pathname === "/parseResume") {
        await new Promise((done) => setTimeout(done, LEVER_PARSE_MS));
        return { json: LEVER_PARSED };
      }
      return viaRoute(lever, r);
    };
    return { url: lever.url, handler: onHost(lever.url, handler), submissions: () => lever.submissions };
  },
  ashby: () => {
    const forms = new SavedForms(["ashby-patreon"]);
    return { url: forms.url("ashby-patreon"), handler: forms.handler, submissions: () => forms.submissions };
  },
  workable: () => {
    const form = new SavedWorkable("workable-perryhomes");
    return { url: form.url, handler: form.handler, submissions: () => form.server.submissions };
  },
  rippling: () => {
    const rippling = new FakeRippling("rippling-rippling");
    const url = `${rippling.url}/apply?step=application`;
    // The job's API answer (job.json), which the extension reads the questions from.
    const handler: Handler = (r) => (r.method === "GET" && /^\/api\/v1\/board\/[^/]+\/jobs\/[^/]+$/.test(r.url.pathname) ? { json: rippling.job } : viaRoute(rippling, r));
    return { url, handler: onHost(url, handler), submissions: () => rippling.submissions };
  },
  eightfold: () => {
    const eightfold = new FakeEightfold("eightfold-netflix");
    return { url: eightfold.url, handler: onHost(eightfold.url, (r) => viaRoute(eightfold, r)), submissions: () => eightfold.submissions };
  },
  // The fake tenant's first step (My Information, 8 fields): the student presses Save and Continue, so one step is one fill.
  workday: () => {
    const workdays = new FakeWorkdays(["workday-caci"], [STEPS[0]]);
    return { url: workdays.url(0), handler: workdays.handler, submissions: () => workdays.submissions };
  },
};

type Raw = { t0: number; worker: any; iso: any; main: any; values: Record<string, unknown>; rows: Record<string, unknown>; settled: number; timedOut: boolean };

/** One batch of one posting on `system`'s form, from run/open until the panel settles. */
async function runOnce(name: string): Promise<Raw> {
  const system = SYSTEMS[name]();
  const api = new FakeApi().queue({ id: "job-0", apply_url: system.url });
  const loaded: Loaded = await loadExtension([api.handler, webapp, system.handler]);
  try {
    await signIn(loaded.context);
    await loaded.context.addInitScript(MAIN_PROBE);
    const app = loaded.context.pages()[0] ?? (await loaded.context.newPage());
    await app.goto("http://localhost:3000/auto-apply");
    await loaded.worker.evaluate(workerProbe);
    const host = new URL(system.url).host;
    const t0 = Date.now();
    await sendFromWebapp(app, { type: "run/open" });

    let page: Page | undefined;
    await expect.poll(() => (page = loaded.context.pages().find((p) => p.url().includes(host))), { timeout: 30_000 }).toBeTruthy();
    const tabId = async () => loaded.worker.evaluate((host) => (globalThis as any).__speed.tabs.find((t: any) => new URL(t.url).host === host)?.id, host);
    const id = await tabId();
    // The content scripts' world, read with the original executeScript (not logged).
    const iso = async (): Promise<any> => loaded.worker.evaluate(async (id) => {
      try {
        const [{ result }] = await (globalThis as any).__speedOrig.exec.call(chrome.scripting, {
          target: { tabId: id },
          func: () => JSON.stringify({ ...((globalThis as any).__speedIso ?? {}), summary: (window as any).WIA?.status?.summary?.().fields ?? null }),
        });
        return JSON.parse(result);
      } catch {
        return {};
      }
    }, id);
    const main = async (): Promise<any> => page!.evaluate(() => (window as any).__speed ?? {}).catch(() => ({}));

    // Settled: the fill reached its last phase and no panel row or field has changed for QUIET_MS.
    const deadline = Date.now() + 75_000;
    let timedOut = false;
    let settled = t0;
    for (;;) {
      const [i, m] = [await iso(), await main()];
      const phase = i.phases?.at(-1)?.phase;
      const last = Math.max(i.rows?.at(-1)?.t ?? 0, m.events?.at(-1)?.t ?? 0, i.phases?.at(-1)?.t ?? 0);
      if (["filled", "step", "last", "stopped"].includes(phase) && Date.now() - last > QUIET_MS) {
        settled = last;
        break;
      }
      if (Date.now() > deadline) {
        timedOut = true;
        settled = last;
        break;
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    const [isoData, mainData] = [await iso(), await main()];
    const values = await page!.evaluate(() => (window as any).__speedValues?.() ?? {});
    const worker = await loaded.worker.evaluate(() => (globalThis as any).__speed);
    const rows = Object.fromEntries((isoData.summary ?? []).map((f: any) => [f.key, { label: f.label, status: f.status, shows: f.shows ?? null, reason: f.reason ?? null, source: f.source ?? null }]));
    expect(system.submissions()).toEqual([]);
    return { t0, worker, iso: isoData, main: mainData, values, rows, settled, timedOut };
  } finally {
    await loaded.close();
  }
}

const span = (r: { start: number; end?: number }) => (r.end ?? r.start) - r.start;
const pathOf = (url: string) => new URL(url).pathname.replace(/\/applicants\/[^/]+/, "/applicants/:id").replace(/[0-9a-f-]{36}/g, ":id").replace(/\/jobs\/[^/]+/, "/jobs/:job");

/** One run's numbers. */
function measure(raw: Raw) {
  const { t0, worker, iso, main, settled } = raw;
  const tab = worker.tabs[0];
  const exec = (worker.exec as any[]).filter((e) => e.tabId === tab?.id && e.start >= t0);
  const inject = exec.find((e) => e.what === "engine.js")?.start ?? NaN;
  const firstExec = exec[0]?.start ?? NaN;
  const formWaits = exec.filter((e) => e.start < inject && e.what !== "(anonymous func)");
  const events = (main.events ?? []).filter((e: any) => e.t >= t0);
  const msgs = (iso.msgs ?? []) as any[];
  const fetches = (worker.fetches as any[]).filter((f) => f.start >= t0 && f.start <= settled);

  // Per field: from the previous field's last event (or the fill/page message's start) to this field's last.
  const pages = msgs.filter((m) => m.type === "fill/page");
  const byField = new Map<number, { label: string; kind: string; first: number; last: number; events: number; bursts: number }>();
  for (const e of events) {
    const f = byField.get(e.field) ?? { label: e.label, kind: e.kind, first: e.t, last: e.t, events: 0, bursts: 1 };
    if (e.t - f.last > 500) f.bursts++;
    f.last = e.t;
    f.events++;
    byField.set(e.field, f);
  }
  const fields = [...byField.values()].sort((a, b) => a.first - b.first);
  let prev = pages[0]?.start ?? inject;
  const perField = fields.map((f) => {
    const begin = Math.max(prev, pages.filter((p) => p.start <= f.first).at(-1)?.start ?? prev);
    const ms = f.last - begin;
    prev = f.last;
    return { label: f.label, kind: f.kind, ms, events: f.events, bursts: f.bursts };
  });

  const engineCalls: Record<string, { count: number; ms: number }> = {};
  for (const e of exec.filter((e) => e.engine)) {
    const c = (engineCalls[e.engine] ??= { count: 0, ms: 0 });
    c.count++;
    c.ms += span(e);
  }
  const messages: Record<string, { count: number; ms: number }> = {};
  for (const m of msgs) {
    const c = (messages[m.type] ??= { count: 0, ms: 0 });
    c.count++;
    c.ms += span(m);
  }
  const apiCalls: Record<string, { count: number; ms: number }> = {};
  for (const f of fetches) {
    const c = (apiCalls[`${f.method} ${new URL(f.url).host === "localhost:8000" ? "" : new URL(f.url).host}${pathOf(f.url)}`] ??= { count: 0, ms: 0 });
    c.count++;
    c.ms += span(f);
  }
  const plans = msgs.filter((m) => m.type === "fill/plan");
  const planIntervals = plans.map((m) => [m.start, m.end ?? m.start] as [number, number]);
  const fetchIntervals = fetches.map((f) => [f.start, f.end ?? f.start] as [number, number]);
  const pageCallsInPlan = exec.filter((e) => e.engine && plans.some((p) => e.start >= p.start && e.start <= (p.end ?? p.start))).map((e) => [e.start, e.end] as [number, number]);

  const timers = [
    ...timersBySite(main.timers ?? [], t0, settled, "page"),
    ...timersBySite(iso.timers ?? [], t0, settled, "content"),
    ...timersBySite(worker.timers as Timer[], t0, settled, "worker"),
  ].sort((a, b) => b.tookMs - a.tookMs);
  const own = timers.filter((t) => !t.site.startsWith("(the page's own"));
  const observers = (main.observers ?? []).filter((o: any) => o.start >= t0 && o.start <= settled).map((o: any) => ({ site: sourceOf(o.site[0]), caller: sourceOf(o.site[1]), ms: (o.end ?? settled) - o.start, open: !o.end }));
  const readbackCalls = Object.entries(engineCalls).filter(([n]) => /readback|shows|fill\/read/i.test(n));
  const reads = messages["fill/read"] ?? { count: 0, ms: 0 };
  const essayMsgs = Object.entries(messages).filter(([t]) => /essay|written|claude|answer/i.test(t));
  const essayFetches = Object.entries(apiCalls).filter(([p]) => /essay|written|answer/i.test(p));

  return {
    timedOut: raw.timedOut,
    total: settled - t0,
    firstField: (events[0]?.t ?? NaN) - t0,
    lastField: (events.at(-1)?.t ?? NaN) - t0,
    panelSettled: (iso.rows?.at(-1)?.t ?? NaN) - t0,
    phases: (iso.phases ?? []).map((p: any) => `${p.phase}@${p.t - t0}`),
    pageWait: {
      tabOpen: (tab?.start ?? NaN) - t0,
      tabCreateMs: (tab?.t ?? NaN) - (tab?.start ?? NaN),
      load: firstExec - (tab?.t ?? NaN),
      formWait: formWaits.map((e) => `${e.what} ${span(e)}ms`),
      untilInject: inject - t0,
      injectToContent: (exec.find((e) => e.what?.endsWith("content-script.js"))?.start ?? NaN) - inject,
    },
    plan: { count: plans.length, ms: covered(planIntervals), apiMsInPlan: covered(fetchIntervals, Math.min(...planIntervals.map((i) => i[0])), Math.max(...planIntervals.map((i) => i[1]))), pageCallsMsInPlan: covered(pageCallsInPlan) },
    api: { count: fetches.length, ms: covered(fetchIntervals), byPath: apiCalls },
    engineCalls,
    messages,
    fields: { count: perField.length, sumMs: perField.reduce((s, f) => s + f.ms, 0), slowest: [...perField].sort((a, b) => b.ms - a.ms).slice(0, 5), all: perField },
    waits: {
      // WorkIt's own sleeps (the page's own timers, set in an event the engine fired, are apart): ms asked, ms they took,
      // and the wall time the engine had one pending in the page (sleeps overlap little: the fill is one await chain).
      askedMs: own.reduce((s, t) => s + t.askedMs, 0),
      tookMs: own.reduce((s, t) => s + t.tookMs, 0),
      engineWallMs: covered((main.timers ?? []).filter((t: Timer) => t.own !== false && !t.cleared && t.set >= t0 && t.set <= settled).map((t: Timer) => [t.set, t.fired ?? settled] as [number, number])),
      pageOwnMs: timers.filter((t) => !own.includes(t)).reduce((s, t) => s + t.tookMs, 0),
      byWorld: Object.fromEntries(["page", "content", "worker"].map((w) => [w, own.filter((t) => t.world === w).reduce((s, t) => s + t.tookMs, 0)])),
      top: timers.slice(0, 12),
      observers: observers.sort((a: any, b: any) => b.ms - a.ms).slice(0, 8),
    },
    readback: { engineCalls: readbackCalls, fillRead: reads },
    retries: { plans: plans.length, fillPages: pages.length, fieldsFilledTwice: perField.filter((f) => f.bursts > 1).map((f) => f.label) },
    essay: { messages: essayMsgs, fetches: essayFetches },
    hiddenEvents: events.filter((e: any) => e.hidden).length,
    // Everything in order, ms from run/open: to see what a gap is.
    timeline: [
      ...fetches.map((f) => [f.start - t0, `fetch ${f.method} ${pathOf(f.url)} ${span(f)}ms`]),
      ...(worker.exec as any[]).filter((e) => e.start >= t0).map((e) => [e.start - t0, `exec ${e.world} ${e.engine ?? e.what} ${span(e)}ms`]),
      ...(worker.tabs as any[]).map((t) => [t.start - t0, `tab create ${t.url} ${t.t - t.start}ms`]),
      ...msgs.map((m) => [m.start - t0, `msg ${m.type} ${span(m)}ms`]),
      ...(worker.timers as Timer[]).filter((t) => t.set >= t0).map((t) => [t.set - t0, `timer worker ${t.ms}ms ${sourceOf(t.site[0])}`]),
      ...(iso.phases ?? []).map((p: any) => [p.t - t0, `phase ${p.phase}`]),
      ...(events.length ? [[events[0].t - t0, "first field event"], [events.at(-1).t - t0, "last field event"]] : []),
    ].sort((a: any, b: any) => a[0] - b[0]).map(([t, what]) => `${t} ${what}`),
  };
}

const systems = Object.keys(SYSTEMS).filter((s) => !ONLY || ONLY.includes(s));
mkdirSync(OUT, { recursive: true });

for (const name of systems) {
  test(`${name}: fill timing over ${RUNS} runs`, async () => {
    test.setTimeout((RUNS + 1) * 120_000);
    const runs: ReturnType<typeof measure>[] = [];
    let last: Raw | undefined;
    // A first run warms Chromium's caches (the first launch after a while took 7-37 s to open its tab): not counted.
    if (!process.env.SPEED_NO_WARMUP) await runOnce(name);
    for (let n = 0; n < RUNS; n++) {
      last = await runOnce(name);
      runs.push(measure(last));
    }
    const stat = (pick: (r: (typeof runs)[number]) => number) => {
      const xs = runs.map(pick);
      return { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
    };
    const summary = {
      total: stat((r) => r.total), firstField: stat((r) => r.firstField), lastField: stat((r) => r.lastField), panelSettled: stat((r) => r.panelSettled),
      untilInject: stat((r) => r.pageWait.untilInject), plan: stat((r) => r.plan.ms), api: stat((r) => r.api.ms), fieldsSum: stat((r) => r.fields.sumMs),
      waitsTook: stat((r) => r.waits.tookMs), fillPage: stat((r) => r.messages["fill/page"]?.ms ?? 0),
    };
    writeFileSync(join(OUT, `${PREFIX}-${name}.json`), JSON.stringify({ system: name, prefix: PREFIX, runs: RUNS, at: new Date().toISOString(), summary, perRun: runs, values: last!.values, rows: last!.rows }, null, 2));
    expect(runs.every((r) => !r.timedOut && Number.isFinite(r.firstField))).toBe(true);
  });
}

test.afterAll(() => {
  const files = readdirSync(OUT).filter((f) => f.startsWith(`${PREFIX}-`) && f.endsWith(".json"));
  const fmt = (s: { median: number; min: number; max: number }) => `${Math.round(s.median)} (${Math.round(s.min)}-${Math.round(s.max)})`;
  const lines = ["| system | first field | last field | panel settled | total | until inject | plan | API | fields sum | sleeps took | fill/page |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const f of files.sort()) {
    const { system, summary: s } = JSON.parse(readFileSync(join(OUT, f), "utf8"));
    lines.push(`| ${system} | ${fmt(s.firstField)} | ${fmt(s.lastField)} | ${fmt(s.panelSettled)} | ${fmt(s.total)} | ${fmt(s.untilInject)} | ${fmt(s.plan)} | ${fmt(s.api)} | ${fmt(s.fieldsSum)} | ${fmt(s.waitsTook)} | ${fmt(s.fillPage)} |`);
  }
  writeFileSync(join(OUT, `${PREFIX}-summary.md`), `ms from run/open, median (min-max)\n\n${lines.join("\n")}\n`);
});
