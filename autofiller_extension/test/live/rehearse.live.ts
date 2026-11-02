// KAN-324's live rehearsals: batch apply on real job postings, by hand only.
// Never in CI: no config's testMatch takes *.live.ts (run it with
// live/live.config.ts). It never submits: it presses nothing on a form, and
// it records every non-GET request a job system's page sends, to prove no
// submit went out.
//
// The extension is the student's (the test copy, its panel root open), on a
// real Chromium with a fresh profile. Only localhost is faked, as in
// loadExtension's `live` mode: localhost:8000 is passed through to the local
// WorkIt API (auto-apply/rehearsals/stack/serve.py, API env), signed in as
// its test student; localhost:3000 is a blank webapp page to send run/open
// from. Every job system is the real one.
//
//   SHARD=shard-1.json OUT=out/shard-1 API=http://127.0.0.1:8124 \
//     npx playwright test -c live/live.config.ts
//
// SHARD lists the postings ({ local_id, site, url, company, title }); each
// batch of 5 opens as the student's picks in Up Next (run/open with jobIds),
// and each tab is recorded once it settles, then closed, as a student moves
// on. OUT gets results.jsonl (one line a posting), a screenshot a tab and
// requests.jsonl (the pages' non-GET requests).
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { loadExtension, sendFromWebapp, signIn, webapp, type Loaded } from "../loaded-extension";
import { localApi, operationOf, pageUrl, readPanel, sendReport } from "./helpers";

const API = process.env.API ?? "http://127.0.0.1:8124";
const TOKEN = process.env.TOKEN ?? "kan324-local-token";
const STUDENT = process.env.STUDENT ?? "00000000-0000-4000-8000-000000000324";
const OUT = process.env.OUT ?? "out";
const BATCH = 5;
const TAB_TIMEOUT = Number(process.env.TAB_TIMEOUT ?? 7 * 60_000);
// A tab is settled once its batch state, its panel's words and rows have stayed the same this long, with
// nothing filling: a Workday or Oracle tab walks its steps to Review by itself (workday-walk.js) and stays
// needs_you meanwhile, so the state alone says nothing.
const SETTLE = 15_000;
const BUSY = /Autofilling|Filling this step|Scanning|Reading this page|Saving/;

type Posting = { local_id: string; site: string; url: string; company: string; title: string };

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}/applicants/${STUDENT}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

type Tab = { id: number; jobId: string; url: string; state: string };

async function batchTabs(loaded: Loaded): Promise<{ tabs: Tab[]; held: string[]; opened: string[] }> {
  return loaded.worker.evaluate(async () => {
    const batch = (await chrome.storage.local.get("workit_batch")).workit_batch;
    const tabs = [];
    for (const [id, t] of Object.entries<any>(batch?.tabs ?? {})) {
      const tab = await chrome.tabs.get(Number(id)).catch(() => null);
      if (tab) tabs.push({ id: Number(id), jobId: t.jobId, url: tab.url ?? t.url, state: t.state });
    }
    return { tabs, held: (batch?.held ?? []).map((h: any) => h.jobId), opened: batch?.opened ?? [] };
  });
}

async function pageOf(loaded: Loaded, tab: Tab): Promise<Page | undefined> {
  const pages = loaded.context.pages();
  return pages.find((p) => p.url() === tab.url) ?? pages.find((p) => p.url().split("#")[0] === tab.url.split("#")[0]);
}

test("rehearse a shard of live postings in batches of 5", async () => {
  const postings: Posting[] = JSON.parse(readFileSync(process.env.SHARD!, "utf8"));
  test.setTimeout(postings.length * 4 * 60_000 + 10 * 60_000);
  mkdirSync(join(OUT, "shots"), { recursive: true });
  const results = join(OUT, "results.jsonl");
  const requests = join(OUT, "requests.jsonl");

  const loaded = await loadExtension([localApi, webapp], { live: true });
  // Every non-GET request a page sends to anything but WorkIt: the proof that nothing was submitted.
  loaded.context.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() === "GET" || u.hostname === "localhost" || u.protocol === "chrome-extension:") return;
    appendFileSync(requests, JSON.stringify({ t: Date.now(), method: r.method(), url: r.url().slice(0, 400), page: pageUrl(r), op: operationOf(r), type: r.resourceType() }) + "\n");
  });
  try {
    await signIn(loaded.context, TOKEN);
    const app = await loaded.context.newPage();
    await app.goto("http://localhost:3000/auto-apply");

    for (let start = 0; start < postings.length; start += BATCH) {
      const five = postings.slice(start, start + BATCH);
      const queued: Record<string, string> = {};
      for (const p of five) {
        const r = await api("/applications", { method: "POST", body: JSON.stringify({ job_id: p.local_id }) });
        queued[p.local_id] = r.status === 200 ? r.body.stage : `refused ${r.status}: ${r.body?.detail ?? ""}`;
      }
      const ids = five.filter((p) => queued[p.local_id] === "queued").map((p) => p.local_id);
      const opened = ids.length ? await sendFromWebapp(app, { type: "run/open", jobIds: ids }) : null;
      const t0 = Date.now();
      const firstSeen: Record<string, number> = {};
      const stableSince: Record<string, { state: string; at: number }> = {};
      const done = new Set<string>();
      for (const p of five) {
        if (!ids.includes(p.local_id)) {
          appendFileSync(results, JSON.stringify({ ...p, outcome: "not queued", queue: queued[p.local_id] }) + "\n");
          done.add(p.local_id);
        }
      }

      while (done.size < five.length) {
        const { tabs } = await batchTabs(loaded);
        const now = Date.now();
        for (const tab of tabs) {
          if (done.has(tab.jobId)) continue;
          firstSeen[tab.jobId] ??= now;
          const prev = stableSince[tab.jobId];
          const look = await pageOf(loaded, tab).then((page) => (page ? readPanel(page) : null)).catch(() => null);
          const key = `${tab.state}|${tab.url}|${look?.panelText ?? ""}|${(look?.rows ?? []).map((r) => r.mark).join(",")}`;
          const busy = BUSY.test(look?.panelText ?? "") || (look?.rows ?? []).some((r) => r.mark === "filling");
          if (!prev || prev.state !== key) stableSince[tab.jobId] = { state: key, at: now };
          const settled = tab.state !== "filling" && !busy && now - stableSince[tab.jobId].at >= SETTLE;
          const timedOut = now - firstSeen[tab.jobId] > TAB_TIMEOUT;
          if (!settled && !timedOut) continue;
          const p = five.find((x) => x.local_id === tab.jobId)!;
          const page = await pageOf(loaded, tab);
          const panel = page ? await readPanel(page) : null;
          const shot = join(OUT, "shots", `${start + five.indexOf(p) + 1}-${p.site}.png`);
          if (page) await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
          const report = page ? await sendReport(page) : "no page";
          const stage = (await api(`/applications/${tab.jobId}`)).body?.stage ?? null;
          appendFileSync(
            results,
            JSON.stringify({ ...p, outcome: timedOut && !settled ? "timed out" : tab.state, tab_state: tab.state, stage, final_url: tab.url, secs: Math.round((now - firstSeen[tab.jobId]) / 1000), report, shot, panel }) + "\n",
          );
          done.add(tab.jobId);
          // The student moves on: closing the tab lets the batch open the next (a held Workday job).
          await loaded.worker.evaluate((id) => chrome.tabs.remove(id), tab.id).catch(() => {});
        }
        // A job that never got a tab: closed by the batch itself (a closed posting), refused, or still held.
        for (const p of five) {
          if (done.has(p.local_id) || tabs.some((t) => t.jobId === p.local_id)) continue;
          const stage = (await api(`/applications/${p.local_id}`)).body?.stage ?? null;
          if (stage === "skipped" || stage === "applied") {
            appendFileSync(results, JSON.stringify({ ...p, outcome: stage === "skipped" ? "closed or skipped" : "APPLIED", stage }) + "\n");
            done.add(p.local_id);
          } else if (now - t0 > TAB_TIMEOUT * 3) {
            appendFileSync(results, JSON.stringify({ ...p, outcome: "never opened", stage, opened }) + "\n");
            done.add(p.local_id);
          }
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    writeFileSync(join(OUT, "done"), new Date().toISOString());
  } finally {
    await loaded.close();
  }
});
