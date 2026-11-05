// S5 ops (KAN-611): what a Record keeps of a page, and Apply's fixed page functions.
//
// - tabs.fullScreenshot: the whole page, by scroll and stitch. captureVisibleTab gives one
//   viewport, about 2 a second, so the page is scrolled a viewport at a time and the strips are
//   drawn onto one canvas. Fixed and sticky elements (a site's header) are hidden after the first
//   strip, so they show once, at the top, as in Playwright's full-page shot.
// - page.html: the page's HTML for a Record, with the values the form shows now.
// - fixed.call: one of the page functions Apply's own modules run by evaluate (on_page's FIELD,
//   stuck's FIELD_ERROR, ...), from vendor/fixed.js, which `apply plain prepare` writes from those
//   very strings. A file goes in as code the extension ships, so no eval runs and page CSP and
//   the Allow User Scripts toggle don't matter.

import { inPage, named, sleep, vendor } from "./shared.js";
import { ops as tabs } from "./tabs.js";

const STRIP_GAP_MS = 520; // captureVisibleTab's quota is about 2 calls a second
const MAX_SIDE = 32000; // a canvas side Chrome can draw

function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// In the page (isolated world): its size and scroll, and a way to scroll it and hide what is pinned.
function layout(action, y) {
  const root = document.scrollingElement || document.documentElement;
  const HIDDEN = "data-apply-strip-hidden";
  if (action === "start") {
    const was = [root.style.scrollBehavior, root.style.scrollbarWidth];
    root.style.scrollBehavior = "auto"; // a page's smooth scrolling would land each strip late
    root.style.scrollbarWidth = "none"; // no scrollbar drawn down every strip's edge
    globalThis.__applyStrip = { was, x: scrollX, y: scrollY };
    return {
      width: innerWidth, height: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight),
      viewport: innerHeight, dpr: devicePixelRatio, x: scrollX, y: scrollY,
    };
  }
  if (action === "scroll") {
    scrollTo(0, y);
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(scrollY))));
  }
  if (action === "hide") {
    // Each strip: a header can turn fixed only once the page scrolls.
    for (const element of document.querySelectorAll(`body *:not([${HIDDEN}])`)) {
      const { position } = getComputedStyle(element);
      if (position === "fixed" || position === "sticky") {
        element.setAttribute(HIDDEN, element.style.getPropertyValue("visibility") + "|" + element.style.getPropertyPriority("visibility"));
        element.style.setProperty("visibility", "hidden", "important");
      }
    }
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))));
  }
  // "end": everything back as it was
  for (const element of document.querySelectorAll(`[${HIDDEN}]`)) {
    const [value, priority] = element.getAttribute(HIDDEN).split("|");
    if (value) element.style.setProperty("visibility", value, priority);
    else element.style.removeProperty("visibility");
    element.removeAttribute(HIDDEN);
  }
  const strip = globalThis.__applyStrip;
  if (strip) {
    scrollTo(strip.x, strip.y);
    [root.style.scrollBehavior, root.style.scrollbarWidth] = strip.was;
    delete globalThis.__applyStrip;
  }
  return true;
}

async function fullScreenshot({ tab, format = "png", quality, clip = null, scale = 1, maxHeight = 20000 }) {
  const page = await inPage({ tab }, "ISOLATED", layout, ["start"]);
  if (clip?.viewport) clip = { x: clip.x + page.x, y: clip.y + page.y, width: clip.width, height: clip.height };
  const top = clip ? Math.max(0, clip.y) : 0;
  const bottom = Math.min(page.height, clip ? clip.y + clip.height : page.height, top + maxHeight);
  const left = clip ? Math.max(0, clip.x) : 0;
  const width = clip ? Math.min(clip.width, page.width - left) : page.width;
  const factor = Math.min(scale, MAX_SIDE / Math.max(1, bottom - top), MAX_SIDE / Math.max(1, width));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round((bottom - top) * factor)));
  const draw = canvas.getContext("2d");
  let strips = 0;
  try {
    for (let y = top; y < bottom; y += page.viewport) {
      // Pinned elements show once, at the page's top: hidden from the second strip on, and from the
      // first when the shot starts lower down (an element's), where a sticky header would cover it.
      if (strips || y > 0) await inPage({ tab }, "ISOLATED", layout, ["hide"]);
      if (strips) await sleep(STRIP_GAP_MS);
      const at = await inPage({ tab }, "ISOLATED", layout, ["scroll", y]);
      const { data } = await tabs["tabs.screenshot"]({ tab, format: "png" });
      const shot = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const px = shot.width / page.width; // device pixels per CSS pixel, as captured
      // The strip covers page rows at..at+viewport; draw the part inside top..bottom.
      const from = Math.max(top, at), to = Math.min(bottom, at + page.viewport);
      if (to > from) {
        draw.drawImage(shot, left * px, (from - at) * px, width * px, (to - from) * px,
                       0, (from - top) * factor, width * factor, (to - from) * factor);
      }
      shot.close();
      strips++;
      if (at + page.viewport >= bottom) break; // the page scrolls no further
    }
  } finally {
    await inPage({ tab }, "ISOLATED", layout, ["end"]).catch(() => {});
  }
  const type = format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvas.convertToBlob(type === "image/jpeg" ? { type, quality: (quality ?? 80) / 100 } : { type });
  return { data: base64(new Uint8Array(await blob.arrayBuffer())), width: canvas.width, height: canvas.height, strips,
           cut: page.height > bottom && !clip };
}

// In the page (isolated world): its HTML. For a Record (`snapshot`), with each field's value as the
// page shows it now, no scripts, a <base> so its styles load where it is opened, and no password.
function html(snapshot) {
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : "";
  if (!snapshot) return doctype + document.documentElement.outerHTML;
  const copy = document.documentElement.cloneNode(true);
  const live = document.documentElement.querySelectorAll("input, textarea, select");
  const kept = copy.querySelectorAll("input, textarea, select");
  live.forEach((field, i) => {
    const into = kept[i];
    if (!into) return;
    if (field.type === "password") into.removeAttribute("value");
    else if (field.type === "checkbox" || field.type === "radio") into.toggleAttribute("checked", field.checked);
    else if (field.tagName === "TEXTAREA") into.textContent = field.value;
    else if (field.tagName === "SELECT") [...into.options].forEach((o, n) => o.toggleAttribute("selected", field.options[n]?.selected));
    else if (field.type !== "file") into.setAttribute("value", field.value);
  });
  for (const gone of copy.querySelectorAll("script, noscript, [id^='apply-']")) gone.remove();
  const head = copy.querySelector("head");
  if (head && !head.querySelector("base")) {
    const base = document.createElement("base");
    base.href = location.href;
    head.prepend(base);
  }
  return doctype + copy.outerHTML;
}

// In the page, either world: Apply's fixed function `name` on `arg`, or on the element(s)
// `selector` matches (Playwright's selector engine, isolated world only).
function runFixed(name, arg, selector, every) {
  const fixed = globalThis.__applyFixed;
  if (!fixed) return { missing: true };
  const f = fixed[name];
  if (!f) return { err: { name: "BadOp", message: `no fixed function ${name}: run \`apply plain prepare\`` } };
  let input;
  if (selector != null) {
    const pw = globalThis.__applyPW;
    if (!pw) return { missing: true };
    const found = pw.querySelectorAll(pw.parseSelector(selector), document);
    if (!every && !found.length) return { retry: `waiting for locator('${selector}')` };
    input = every ? found : found[0];
  }
  try {
    return Promise.resolve(selector != null ? f(input, arg) : f(arg)).then(
      (value) => ({ ok: value === undefined ? null : value }),
      (error) => ({ err: { name: error?.name || "Error", message: String(error?.message ?? error) } }));
  } catch (error) {
    return { err: { name: error?.name || "Error", message: String(error?.message ?? error) } };
  }
}

async function callFixed(params) {
  const world = params.world === "MAIN" ? "MAIN" : "ISOLATED";
  const args = [params.name, params.arg ?? null, params.selector ?? null, !!params.all];
  let answer = await inPage(params, world, runFixed, args);
  if (answer?.missing) {
    const files = world === "ISOLATED" && params.selector != null ? [vendor("vendor/injected.js"), vendor("vendor/fixed.js")] : [vendor("vendor/fixed.js")];
    await chrome.scripting.executeScript({ target: { tabId: params.tab, frameIds: [params.frame ?? 0] }, world, files, injectImmediately: true });
    answer = await inPage(params, world, runFixed, args);
  }
  if (answer?.missing) throw named("Navigated", "the fixed functions are gone (the page changed while they loaded)");
  return answer;
}

export const ops = {
  "tabs.fullScreenshot": fullScreenshot,
  "page.html": async (params) => inPage(params, "ISOLATED", html, [!!params.snapshot]),
  "fixed.call": callFixed,
};
