// Timing probes for speed.extension.spec.ts: where a batch tab's fill spends
// its time, seen from outside the code under test. Nothing here changes how
// the extension or the Fill engine work; the probes only wrap the browser's
// own functions (setTimeout, MutationObserver, fetch, chrome.scripting,
// chrome.runtime.sendMessage) and note the time:
// - MAIN_PROBE: the page's main world (the engine), as an init script;
// - workerProbe: the service worker (batch.js, background.js, api.js), which
//   also puts isoProbe into the content scripts' isolated world just before
//   injectFill injects them, so their sleeps, messages and panel rows are seen.
// Times are Date.now() everywhere, so the three worlds line up.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The page's main world: the engine's timers and observers, and every field's input/change events. */
export const MAIN_PROBE = `(() => {
  if (window.__speed) return;
  const S = window.__speed = { timers: [], observers: [], events: [] };
  const ours = (skip) => (new Error().stack || "").split("\\n").slice(skip).map((l) => l.trim().replace(/^at /, "")).filter((l) => l.includes("chrome-extension://")).slice(0, 6);
  const set = window.setTimeout, clear = window.clearTimeout, byId = new Map();
  window.setTimeout = function (fn, ms, ...rest) {
    const all = (new Error().stack || "").split("\\n").slice(2).map((l) => l.trim().replace(/^at /, ""));
    const site = all.filter((l) => l.includes("chrome-extension://")).slice(0, 6);
    if (!site.length) return set.call(window, fn, ms, ...rest);
    // own: set by the extension's code itself; else by the page's own code, in an event the extension fired.
    const rec = { ms: Number(ms) || 0, set: Date.now(), site, own: all[0].includes("chrome-extension://") };
    S.timers.push(rec);
    const id = set.call(window, function () { rec.fired = Date.now(); byId.delete(id); return typeof fn === "function" ? fn.apply(this, arguments) : undefined; }, ms, ...rest);
    byId.set(id, rec);
    return id;
  };
  window.clearTimeout = function (id) { const rec = byId.get(id); if (rec) { rec.cleared = Date.now(); byId.delete(id); } return clear.call(window, id); };
  const MO = window.MutationObserver;
  window.MutationObserver = class extends MO {
    constructor(cb) { super(cb); this.__site = ours(2); }
    observe(...a) { if (this.__site.length && !this.__rec) S.observers.push(this.__rec = { start: Date.now(), site: this.__site }); return super.observe(...a); }
    disconnect() { if (this.__rec && !this.__rec.end) this.__rec.end = Date.now(); return super.disconnect(); }
  };
  const control = "input,select,textarea,[role=combobox],[contenteditable=true]";
  window.__speedField = (el) => {
    if (!(el instanceof Element)) return null;
    let f = el.closest(control);
    if (!f) { const a = document.activeElement; f = a && a !== document.body && a.matches(control) ? a : null; }
    if (!f) return null;
    const text = (t) => (t || "").replace(/\\s+/g, " ").trim().slice(0, 90);
    const by = f.getAttribute("aria-labelledby");
    // A label the form doesn't tie to its field (Rippling's): label-like text up to four levels above it, in a box holding no other field.
    const near = (f) => { for (let p = f.parentElement, i = 0; p && i < 4 && p.querySelectorAll(control).length <= 2; p = p.parentElement, i++) { const l = p.querySelector("label,legend,[id$=-label],[class*=label],[class*=Label]"); if (l && !l.contains(f) && text(l.innerText)) return text(l.innerText); } return ""; };
    const wd = f.closest("[data-automation-id^=formField-]")?.getAttribute("data-automation-id");
    const label = text(f.labels?.[0]?.innerText) || text(f.getAttribute("aria-label")) || (by && text(by.split(" ").map((i) => document.getElementById(i)?.innerText).join(" "))) ||
      text(f.closest("label")?.innerText) || text(f.getAttribute("placeholder")) || near(f) || f.getAttribute("name") || f.id || wd || f.tagName.toLowerCase();
    const kind = f.getAttribute("role") === "combobox" ? "combobox" : f.tagName === "INPUT" ? f.type : f.tagName.toLowerCase();
    return { el: f, label: (wd && !label.includes(wd) ? wd.replace("formField-", "") + " / " : "") + label, kind };
  };
  const seen = new WeakMap();
  let n = 0;
  for (const type of ["input", "change"]) document.addEventListener(type, (e) => {
    const f = window.__speedField(e.composedPath()[0]);
    if (!f || f.el.closest("#workit-autofiller-overlay-host")) return;
    if (!seen.has(f.el)) seen.set(f.el, n++);
    S.events.push({ t: Date.now(), type, field: seen.get(f.el), label: f.label, kind: f.kind, trusted: e.isTrusted, hidden: document.visibilityState === "hidden" });
  }, true);
  window.__speedValues = () => {
    const out = {}, put = (k, v) => { let key = k, i = 2; while (key in out) key = k + " #" + i++; out[key] = v; };
    for (const el of document.querySelectorAll("input,select,textarea")) {
      if (["hidden", "submit", "button", "reset", "image"].includes(el.type) || el.closest("#workit-autofiller-overlay-host")) continue;
      const f = window.__speedField(el);
      if (!f) continue;
      if (el.type === "radio") { if (el.checked) put(f.label + " (radio " + (el.name || "") + ")", el.value || "on"); continue; }
      if (el.type === "checkbox") { put(f.label, el.checked); continue; }
      if (el.type === "file") { put(f.label, [...(el.files || [])].map((x) => x.name).join(", ")); continue; }
      // A combobox's choice shows beside its input (react-select's single or multi values), not in it.
      const shown = f.kind === "combobox" && !el.value
        ? [...(el.closest("[class*=value-container],[class*=ValueContainer]")?.querySelectorAll("[class*=single-value],[class*=singleValue],[class*=multi-value__label],[class*=multiValue] > div:first-child") ?? [])].map((x) => x.textContent.trim()).join("; ")
        : "";
      put(f.label, el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent?.trim() ?? "" : el.value || shown);
    }
    return out;
  };
})();`;

/**
 * The service worker's probes (run with worker.evaluate): executeScript calls
 * (the engine calls among them, by name), fetches, timers and new tabs. The
 * originals stay at globalThis.__speedOrig for the harness's own reads.
 */
export function workerProbe(): void {
  const g = globalThis as any;
  if (g.__speed) return;
  const S = (g.__speed = { exec: [] as any[], fetches: [] as any[], timers: [] as any[], tabs: [] as any[] });
  const orig = (g.__speedOrig = { exec: chrome.scripting.executeScript, fetch: g.fetch, setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, create: chrome.tabs.create });
  const ours = (skip: number) => (new Error().stack || "").split("\n").slice(skip).map((l) => l.trim().replace(/^at /, "")).filter((l) => l.includes("chrome-extension://")).slice(0, 6);

  // The content scripts' isolated world, before content-script.js runs: their timers, their messages to the worker, the panel's rows.
  function isoProbe() {
    const w = globalThis as any;
    if (w.__speedIso) return;
    const S = (w.__speedIso = { timers: [] as any[], msgs: [] as any[], rows: [] as any[], phases: [] as any[], at: Date.now() });
    const ours = (skip: number) => (new Error().stack || "").split("\n").slice(skip).map((l) => l.trim().replace(/^at /, "")).filter((l) => l.includes("chrome-extension://")).slice(0, 6);
    const set = w.setTimeout, clear = w.clearTimeout, byId = new Map();
    w.setTimeout = function (fn: any, ms: number, ...rest: any[]) {
      const site = ours(2);
      if (!site.length) return set.call(w, fn, ms, ...rest);
      const rec: any = { ms: Number(ms) || 0, set: Date.now(), site };
      S.timers.push(rec);
      const id = set.call(w, function (this: any) { rec.fired = Date.now(); byId.delete(id); return typeof fn === "function" ? fn.apply(this, arguments) : undefined; }, ms, ...rest);
      byId.set(id, rec);
      return id;
    };
    w.clearTimeout = function (id: any) { const rec = byId.get(id); if (rec) { rec.cleared = Date.now(); byId.delete(id); } return clear.call(w, id); };
    const last = new Map<string, string>();
    let hooked = false;
    const hook = () => {
      const wia = w.WIA;
      if (!wia) return;
      if (!Object.getOwnPropertyDescriptor(wia, "phase")?.get) {
        let phase = wia.phase;
        if (phase !== undefined) S.phases.push({ t: Date.now(), phase });
        Object.defineProperty(wia, "phase", { configurable: true, enumerable: true, get: () => phase, set: (v) => { phase = v; S.phases.push({ t: Date.now(), phase: v }); } });
      }
      if (!hooked && wia.status?.subscribe) {
        hooked = true;
        wia.status.subscribe((snap: any) => {
          for (const f of snap.fields ?? []) {
            const now = `${f.status}|${f.shows ?? ""}|${f.reason ?? ""}`;
            if (last.get(f.key) === now) continue;
            last.set(f.key, now);
            S.rows.push({ t: Date.now(), key: f.key, label: f.label, status: f.status });
          }
        });
      }
    };
    hook();
    const send = w.chrome.runtime.sendMessage;
    w.chrome.runtime.sendMessage = function (...a: any[]) {
      hook();
      const rec: any = { type: a[0]?.type, start: Date.now() };
      S.msgs.push(rec);
      const p = send.apply(w.chrome.runtime, a);
      p?.then?.((r: any) => { rec.end = Date.now(); rec.ok = r?.ok; }, (e: any) => { rec.end = Date.now(); rec.error = String(e); });
      return p;
    };
  }

  (chrome.scripting as any).executeScript = async function (inj: any) {
    const files: string[] | undefined = inj.files;
    if (files?.some((f) => f.endsWith("content-script.js"))) await orig.exec.call(chrome.scripting, { target: inj.target, func: isoProbe }).catch(() => {});
    const rec: any = {
      start: Date.now(), world: inj.world ?? "ISOLATED", tabId: inj.target?.tabId,
      what: files ? files.map((f) => f.split("/").pop()).join(",") : inj.func?.name || "(anonymous func)",
      engine: inj.func?.name === "runEngine" ? inj.args?.[0]?.name : undefined,
    };
    S.exec.push(rec);
    try {
      return await orig.exec.call(chrome.scripting, inj);
    } finally {
      rec.end = Date.now();
    }
  };
  g.fetch = async function (input: any, init?: any) {
    const url = String(input?.url ?? input);
    const rec: any = { url, method: init?.method ?? input?.method ?? "GET", start: Date.now(), site: ours(2) };
    S.fetches.push(rec);
    try {
      const response = await orig.fetch.call(g, input, init);
      rec.status = response.status;
      return response;
    } finally {
      rec.end = Date.now();
    }
  };
  const byId = new Map();
  g.setTimeout = function (fn: any, ms: number, ...rest: any[]) {
    const site = ours(2);
    if (!site.length) return orig.setTimeout.call(g, fn, ms, ...rest);
    const rec: any = { ms: Number(ms) || 0, set: Date.now(), site };
    S.timers.push(rec);
    const id = orig.setTimeout.call(g, function (this: any) { rec.fired = Date.now(); byId.delete(id); return typeof fn === "function" ? fn.apply(this, arguments) : undefined; }, ms, ...rest);
    byId.set(id, rec);
    return id;
  };
  g.clearTimeout = function (id: any) { const rec = byId.get(id); if (rec) { rec.cleared = Date.now(); byId.delete(id); } return orig.clearTimeout.call(g, id); };
  (chrome.tabs as any).create = async function (props: any) {
    const start = Date.now();
    const tab = await orig.create.call(chrome.tabs, props);
    S.tabs.push({ start, t: Date.now(), id: tab.id, url: props.url });
    return tab;
  };
}

// ---- Turning the raw records into the numbers SPEED-baseline.md reports ----

const ENGINE_DIR = join(__dirname, "..", "fill-engine");
let engineLines: string[] | undefined;
const srcCache = new Map<string, string[]>();

/** "chrome-extension://id/src/x.js:12:3" (or the engine bundle's line) as a source file:line; the bundle's line is found again in fill-engine/src. */
export function sourceOf(frame: string | undefined): string {
  if (!frame) return "?";
  const m = /chrome-extension:\/\/[a-z]+\/([^:)]+):(\d+)/.exec(frame);
  if (!m) return frame;
  const [, file, line] = m;
  const fn = /^([^\s(]+) \(/.exec(frame)?.[1];
  const tag = fn ? ` ${fn}` : "";
  if (file !== "fill-engine/dist/engine.js") return `${file}:${line}${tag}`;
  engineLines ??= readFileSync(join(ENGINE_DIR, "dist", "engine.js"), "utf8").split("\n");
  const n = Number(line) - 1;
  let src = "";
  for (let i = n; i >= 0; i--) {
    const c = /^ {2}\/\/ (src\/\S+\.ts)$/.exec(engineLines[i]);
    if (c) { src = c[1]; break; }
  }
  if (!src) return `engine.js:${line}${tag}`;
  if (!srcCache.has(src)) srcCache.set(src, readFileSync(join(ENGINE_DIR, src), "utf8").split("\n"));
  // esbuild rewrites a line (types gone, `export const` to `var`, names renamed with a number): the src line sharing most words.
  const words = (l: string) => new Set(l.match(/[A-Za-z_$][\w$]*|\d+/g)?.map((w) => w.replace(/\d+$/, "")) ?? []);
  const want = words(engineLines[n]);
  let at = -1, best = 0;
  srcCache.get(src)!.forEach((l, i) => {
    let score = 0;
    for (const w of words(l)) if (want.has(w)) score++;
    if (score > best) [at, best] = [i, score];
  });
  return `fill-engine/${src}:${at >= 0 ? at + 1 : `~(bundle ${line})`}${tag}`;
}

export type Timer = { ms: number; set: number; fired?: number; cleared?: number; site: string[]; own?: boolean };

const PAGE_OWN = "(the page's own timer, in an event from) ";

/** Timers set in [from, to], by call site (the frame that set it and its caller): how many, the ms asked, the ms they took. */
export function timersBySite(timers: Timer[], from: number, to: number, world: string) {
  const sites = new Map<string, { world: string; site: string; caller: string; count: number; askedMs: number; tookMs: number; cleared: number }>();
  for (const t of timers) {
    if (t.set < from || t.set > to) continue;
    const site = (t.own === false ? PAGE_OWN : "") + sourceOf(t.site[0]);
    // Who asked: the next three frames that are neither this one nor a promise's.
    const at = (f: string) => f.replace(PAGE_OWN, "").split(" ")[0];
    const chain: string[] = [];
    for (const f of t.site.slice(1).filter((f) => !/^(new Promise|Promise)\b/.test(f)).map(sourceOf)) {
      if (at(f) !== at(site) && !chain.some((c) => at(c) === at(f))) chain.push(f);
    }
    chain.splice(3);
    const caller = chain.join(" <- ") || "?";
    const key = `${site} <- ${caller}`;
    const s = sites.get(key) ?? { world, site, caller, count: 0, askedMs: 0, tookMs: 0, cleared: 0 };
    s.count++;
    if (t.cleared && !t.fired) s.cleared++;
    else {
      s.askedMs += t.ms;
      s.tookMs += (t.fired ?? to) - t.set;
    }
    sites.set(key, s);
  }
  return [...sites.values()];
}

/** The total length of the union of intervals, clipped to [from, to]. */
export function covered(intervals: [number, number][], from = -Infinity, to = Infinity): number {
  const sorted = intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of sorted) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
