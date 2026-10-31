/** The live canary (KAN-468): for each job system in postings.json, reads live postings' forms
 * with the Fill engine and compares their fields with the engine's saved forms
 * (fill-engine/test/fixtures/forms/<site>-*\/question-set.json).
 *
 * It only reads. Postings come from each board's public listing API. Each posting's Question set
 * is the engine's own read (`questionSet`, the job system's public API, no page). Then its form is
 * opened headless and the engine's `readback` must find the listed fields on it, with
 * `readQuestions` too where postings.json says the host reads the form off the page. It types
 * nothing, uploads nothing and presses nothing: canary.spec.ts fails on any fill or click call.
 *
 * Writes to the folder given as its argument (default ./canary-out): report.md (the run's
 * summary), and issues/<site>.md for each job system whose form changed. Exits 1 when any did.
 *
 *   node canary/run.mjs [out-dir]        (from autofiller_extension/test, after npm ci) */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { chromium } from "@playwright/test";
import { kindDiff, pickPostings } from "./canary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_FILE = join(HERE, "../../fill-engine/dist/engine.js");
const FORMS = join(HERE, "../../fill-engine/test/fixtures/forms");
const CONFIG = JSON.parse(readFileSync(join(HERE, "postings.json"), "utf8"));
const OUT = process.argv[2] ?? "canary-out";
const FETCH_WAIT = 30_000;
const PAGE_WAIT = 30_000;

const ENGINE = readFileSync(ENGINE_FILE, "utf8");
/** The engine as a host with no page holds it (as fill-engine's own specs do). */
const FillEngine = (() => {
  const scope = { URL, URLSearchParams };
  runInNewContext(ENGINE, scope);
  return scope.FillEngine;
})();

/** The engine's FetchText: a GET, or the JSON POST that only reads (Ashby's GraphQL query). */
async function fetchText(url, init) {
  const response = await fetch(url, {
    method: init?.method ?? "GET", body: init?.body, signal: AbortSignal.timeout(FETCH_WAIT),
    headers: init ? { "content-type": "application/json" } : {},
  });
  if (!response.ok) throw Object.assign(new Error(`${url} answered ${response.status}`), { status: response.status });
  return response.text();
}
const getJson = async (url) => JSON.parse(await fetchText(url));

/** Each job system's public list of a board's open postings, as links the engine reads. */
const LISTINGS = {
  greenhouse: async (board) => (await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`)).jobs
    .map((j) => `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`),
  lever: async (board) => (await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`)).map((j) => j.hostedUrl),
  ashby: async (board) => (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`)).jobs.map((j) => j.jobUrl),
  rippling: async (board) => (await getJson(`https://ats.rippling.com/api/v2/board/${board}/jobs?page=0&pageSize=1000`)).items
    .map((j) => j.url),
  workable: async (board) => (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${board}`)).jobs
    .map((j) => `https://apply.workable.com/${board}/j/${j.shortcode}`),
};

/** The job a link is, whichever way it is written: its job system and ids, as the engine reads them. */
function jobKey(url) {
  const job = FillEngine.jobOf(url);
  if (!job) return `not a job: ${url}`;
  const { form, onForm, ...ids } = job;
  return JSON.stringify(Object.entries(ids).sort());
}

/** The saved Question sets of a job system's forms. */
function savedForms(site) {
  return readdirSync(FORMS).filter((name) => name.startsWith(`${site}-`) && existsSync(join(FORMS, name, "question-set.json")))
    .map((name) => ({ name, questions: JSON.parse(readFileSync(join(FORMS, name, "question-set.json"), "utf8")) }));
}

/** What differs on one live posting's form, read once. */
async function readPosting(browser, system, saved, url) {
  let questions;
  try {
    questions = await FillEngine.questionSet(url, fetchText);
  } catch (error) {
    if (error.status === 404 || error.status === 410) return { closed: true };
    return { diff: [`the engine could not read the form: ${error.message}`] };
  }
  const diff = kindDiff(saved, questions);
  const job = FillEngine.jobOf(url);
  const context = await browser.newContext({ bypassCSP: true, serviceWorkers: "block" });
  try {
    await context.addInitScript(ENGINE); // in the page's own world on every load, as the extension runs it
    const page = await context.newPage();
    const response = await page.goto(job.form, { waitUntil: "domcontentloaded", timeout: PAGE_WAIT });
    if (response && (response.status() === 404 || response.status() === 410)) return { closed: true };
    // A form drawn by the page's script (Ashby, Workable) shows its fields a moment after the load.
    const until = Date.now() + PAGE_WAIT;
    let shown = {};
    for (;;) {
      shown = await page.evaluate(([site, q, names]) => FillEngine.readback(site, q, names), [system.site, questions, system.onPage])
        .catch(() => ({})); // a page that navigated as it loaded: read again
      if (system.onPage.every((name) => name in shown) || Date.now() > until) break;
      await page.waitForTimeout(1000);
    }
    for (const name of system.onPage) if (!(name in shown)) diff.push(`${name}: not found on the page`);
    if (system.readsPage) {
      const read = await page.evaluate((site) => FillEngine.readQuestions(site), system.site).catch((error) => error);
      if (read instanceof Error) diff.push(`the engine could not read the page's form: ${read.message}`);
      else diff.push(...kindDiff(saved, read).map((line) => `on the page, ${line}`));
    }
  } catch (error) {
    diff.push(`the form's page did not open: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
  return { diff };
}

/** One job system's run: which postings were read and what differed on each. */
async function checkSystem(browser, system) {
  const saved = savedForms(system.site).map((form) => form.questions);
  if (!saved.length) return { system, error: `no saved form for ${system.site} under fill-engine/test/fixtures/forms` };
  let listed;
  try {
    listed = await LISTINGS[system.site](system.board);
  } catch (error) {
    return { system, error: `the board's postings could not be listed: ${error.message}` };
  }
  const { check, closed } = pickPostings(system.pinned ?? [], listed, CONFIG.count, jobKey);
  if (!check.length) return { system, closed, results: [], error: `${system.board} lists no open posting` };
  const results = [];
  for (const url of check) {
    let result = await readPosting(browser, system, saved, url);
    if (result.diff?.length) result = await readPosting(browser, system, saved, url); // a blip, or a change: read again
    if (result.closed) closed.push(url);
    else results.push({ url, diff: result.diff });
  }
  return { system, closed, results };
}

const changed = (run) => Boolean(run.error) || run.results.some((r) => r.diff.length);

function report(runs) {
  const lines = [`# Live canary, ${new Date().toISOString().slice(0, 10)}`, "", `Engine ${FillEngine.version}.`, ""];
  for (const run of runs) {
    lines.push(`## ${run.system.site} (${run.system.board}): ${changed(run) ? "CHANGED" : "ok"}`, "");
    if (run.error) lines.push(`- ${run.error}`);
    for (const url of run.closed ?? []) lines.push(`- ${url}: posting closed (pinned in postings.json; another listed posting was read instead)`);
    for (const { url, diff } of run.results ?? []) {
      lines.push(`- ${url}: ${diff.length ? "differs from the saved forms" : "matches the saved forms"}`);
      for (const line of diff) lines.push(`  - ${line}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function issue(run) {
  const forms = savedForms(run.system.site).map((form) => form.name).join(", ");
  const lines = [
    `The nightly live canary read ${run.system.site}'s live form and it no longer matches the engine's saved forms (${forms}).`,
    "A job system that changed its markup or API needs an engine fix, and new saved forms.", "",
  ];
  if (run.error) lines.push(`- ${run.error}`);
  for (const { url, diff } of run.results ?? []) {
    if (!diff.length) continue;
    lines.push(`Posting: ${url}`, "", "Field-kind diff:", "", ...diff.map((line) => `- ${line}`), "");
  }
  if (process.env.RUN_URL) lines.push(`Run: ${process.env.RUN_URL}`);
  return lines.join("\n");
}

const browser = await chromium.launch({ headless: true });
const runs = [];
try {
  for (const system of CONFIG.systems) runs.push(await checkSystem(browser, system));
} finally {
  await browser.close();
}
mkdirSync(join(OUT, "issues"), { recursive: true });
writeFileSync(join(OUT, "report.md"), report(runs));
for (const run of runs.filter(changed)) writeFileSync(join(OUT, "issues", `${run.system.site}.md`), issue(run));
console.log(report(runs));
process.exit(runs.some(changed) ? 1 : 0);
