// Employer career sites the student allowed WorkIt on (KAN-369). The
// manifest asks for no site beyond the job systems' own hosts at install; an
// employer's own careers site (careers.acuityinc.com, a jobs2web host) is
// asked for one origin at a time, from the toolbar popup's Allow WorkIt on
// <host> (the popup's own click calls chrome.permissions.request, which needs
// that gesture; manifest `optional_host_permissions`). Once allowed, the
// panel's launcher files (the manifest's content script with launcher.js)
// are registered for that origin, kept across Chrome restarts, and injected
// into the tab at once. The options page lists the allowed sites, each with
// Remove, which gives the permission back and unregisters the scripts.
//
// What WorkIt fills there is the Fill engine's to say (`jobOf`), as on any
// other page: a link it covers (jobs.sap.com, a jobs2web posting), or a job
// system on the employer's own domain, which its page's markup names (the
// engine's PAGE_MARKS: a SuccessFactors career-site posting's rmkcdn assets, a
// Workday career site's candidate-experience scripts), read as the engine
// reads a link marked `ats=<site>` (KAN-472). A job system's
// form in an iframe (Greenhouse's embed) is filled in that frame by the
// manifest's own content script, with or without this.

import { jobOf, markedLink, PAGE_MARKS } from "./engine.js";

// The origins the student allowed from the popup, kept so the options page lists only those (not the manifest's).
const ALLOWED_KEY = "allowed_sites";
const scriptId = (origin) => `site-${new URL(origin).hostname}`;
const pattern = (origin) => `${origin}/*`;

/** The https origin of `url`, or null for any other link. */
export function originOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

const recorded = async () => (await chrome.storage.local.get(ALLOWED_KEY))[ALLOWED_KEY] ?? [];

/** The origins the student allowed that Chrome still grants, in the order they were allowed. */
export async function allowedSites() {
  const sites = [];
  for (const origin of await recorded()) if (await chrome.permissions.contains({ origins: [pattern(origin)] })) sites.push(origin);
  return sites;
}

/** Whether the student allowed WorkIt on `url`'s site. */
export async function allowedOn(url) {
  const origin = originOf(url);
  return Boolean(origin) && (await allowedSites()).includes(origin);
}

/** The panel's launcher files: the manifest's content script that runs launcher.js. */
function launcherFiles() {
  return chrome.runtime.getManifest().content_scripts.find((entry) => entry.js.includes("src/content/launcher.js")).js;
}

async function register(origin) {
  const id = scriptId(origin);
  if ((await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: [pattern(origin)], js: launcherFiles(), runAt: "document_idle", persistAcrossSessions: true }]);
}

async function forget(origin) {
  await chrome.storage.local.set({ [ALLOWED_KEY]: (await recorded()).filter((o) => o !== origin) });
  await chrome.scripting.unregisterContentScripts({ ids: [scriptId(origin)] }).catch(() => {});
}

/**
 * The student allowed WorkIt on the tab's site (the popup's permission
 * request was granted): its scripts are registered and run in the tab now.
 * Answers whether the page holds anything WorkIt fills (`found`), and
 * whether that is the page itself (`onPage`), not a form's frame.
 * @param {number} tabId
 */
export async function allowTabSite(tabId) {
  const { url = "" } = await chrome.tabs.get(tabId);
  const origin = originOf(url);
  if (!origin || !(await chrome.permissions.contains({ origins: [pattern(origin)] }))) throw new Error("WorkIt isn't allowed on this site");
  const sites = await recorded();
  if (!sites.includes(origin)) await chrome.storage.local.set({ [ALLOWED_KEY]: [...sites, origin] });
  await register(origin);
  await chrome.scripting.executeScript({ target: { tabId }, files: launcherFiles() });
  const onPage = Boolean(await pageJobUrl(tabId, 0, url));
  return { found: onPage || (await framesWithForm(tabId)), onPage };
}

/** Remove on the options page: the site's permission goes back to Chrome, and its scripts with it. */
export async function removeSite(origin) {
  await chrome.permissions.remove({ origins: [pattern(origin)] });
  await forget(origin);
  return {};
}

/** At the worker's start and on Chrome's own removal (chrome://extensions): the registrations follow the grants. */
export async function syncSites() {
  for (const origin of await recorded()) {
    if (await chrome.permissions.contains({ origins: [pattern(origin)] })) await register(origin);
    else await forget(origin);
  }
}

/**
 * The link the Fill engine reads for the page in this frame: the page's
 * own when the engine covers it, else, on a site the student allowed, the
 * page's link marked `ats=<site>` for the job system its markup names
 * (PAGE_MARKS). Null when the engine fills nothing there.
 * @param {number | undefined} tabId
 * @param {number} frameId
 * @param {string} url
 * @returns {Promise<string | null>}
 */
export async function pageJobUrl(tabId, frameId, url) {
  if (jobOf(url)) return url;
  if (tabId === undefined || !(await allowedOn(url))) return null;
  const [read] = await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (marks) => Object.keys(marks).find((site) => document.querySelector(marks[site])) ?? null,
      args: [PAGE_MARKS],
    })
    .catch(() => []);
  return read?.result ? markedLink(url, read.result) : null;
}

/**
 * The job system of the page in `tabId`'s frame `frameId` ("workday"), on
 * its own hosts or marked on an employer's domain (pageJobUrl), else null.
 * Content scripts can't load the engine, so they are told it: the panel
 * (panel/where) and a fill (content-scripts.js injectFill) set it as
 * `window.WIA.jobSystem`.
 * @param {number | undefined} tabId
 * @param {number} frameId
 * @param {string} url
 */
export async function pageSystem(tabId, frameId, url) {
  const link = await pageJobUrl(tabId, frameId, url);
  return link ? (jobOf(link)?.site ?? null) : null;
}

/** Whether the page holds a frame showing a form the engine covers (an embedded Greenhouse form, say). */
async function framesWithForm(tabId) {
  const [read] = await chrome.scripting
    .executeScript({ target: { tabId }, func: () => [...document.querySelectorAll("iframe[src]")].map((frame) => frame.src) })
    .catch(() => []);
  return (read?.result ?? []).some((src) => jobOf(src)?.onForm);
}
