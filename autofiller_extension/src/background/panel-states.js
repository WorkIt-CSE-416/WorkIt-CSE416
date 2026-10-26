// The panel's other states (KAN-401; content/panel-states.js draws them):
// signed out's Sign in to WorkIt, and the toolbar popup on a site WorkIt
// can't fill: a web page on a host the manifest doesn't list, or one the
// Fill engine fills nothing on. The popup reads that tab's link only because
// the student pressed the icon there (activeTab), and sends it only on Save
// to WorkIt or Send report; Request this job system (KAN-369) sends only its
// host.

import { DEV_WEB_URL, PROD_SITES } from "../shared/config.js";
import { requestJobSystem, saveJobByLink } from "./api.js";
import { jobOf } from "./engine.js";
import { reportOf, sendReport } from "./report.js";

/**
 * The webapp to sign in at, with no session to name it: the local one when
 * it answers (development), else WorkIt's site (popup.js's own rule).
 */
export async function webappOrigin() {
  try {
    const response = await fetch(DEV_WEB_URL, { signal: AbortSignal.timeout(1000) });
    if (response.ok || response.type === "opaque") return DEV_WEB_URL;
  } catch {
    // no local webapp: WorkIt's site
  }
  return PROD_SITES[0].web;
}

// WorkIt's own pages (the webapp, the API): never "a site WorkIt can't fill".
const OWN_ORIGINS = [DEV_WEB_URL, "http://localhost:8000", ...PROD_SITES.flatMap((site) => [site.web, site.api])];

/**
 * Whether `url` is on a job system's host the manifest lists (its content
 * scripts' matches): a page there that isn't a posting (a board, a home
 * page) is still a site WorkIt fills.
 */
function onListedHost(url) {
  const { hostname } = new URL(url);
  return chrome.runtime.getManifest().content_scripts.some((script) =>
    script.matches.some((pattern) => {
      const host = /^https:\/\/([^/]+)\//.exec(pattern)?.[1] ?? "";
      return host.startsWith("*.") ? hostname === host.slice(2) || hostname.endsWith(host.slice(1)) : hostname === host;
    }),
  );
}

/** The tab's link, or "" when the extension may not read it. */
async function linkOf(tabId) {
  return (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
}

// A path that names a job posting: a jobs, careers, apply or position part.
const POSTING_PATH = /(^|[/_.-])(jobs?|careers?|apply|positions?)([/_.-]|$)/i;

/**
 * Whether the tab's page looks like a job posting: its path names one, or it
 * carries a schema.org JobPosting block (read in the tab, which the icon's
 * press lets the extension do). Elsewhere the popup is the usual one.
 */
async function looksLikePosting(tabId, url) {
  if (POSTING_PATH.test(new URL(url).pathname)) return true;
  const [read] = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const posting = (node) =>
          Array.isArray(node) ? node.some(posting) : Boolean(node) && typeof node === "object" && ([node["@type"]].flat().includes("JobPosting") || posting(node["@graph"]));
        return [...document.querySelectorAll('script[type="application/ld+json"]')].some((script) => {
          try {
            return posting(JSON.parse(script.textContent));
          } catch {
            return false;
          }
        });
      },
    })
    .catch(() => []);
  return read?.result === true;
}

/**
 * What the popup shows for the tab: `unsupported` on a web page WorkIt
 * can't fill that looks like a job posting, with the report it would send
 * (`report`).
 * @param {number} tabId
 */
export async function popupPage(tabId) {
  const url = await linkOf(tabId);
  const web = /^https?:/.test(url) && !OWN_ORIGINS.some((origin) => url.startsWith(origin));
  if (!web || jobOf(url) || onListedHost(url) || !(await looksLikePosting(tabId, url))) return { unsupported: false };
  return { unsupported: true, report: reportOf(url), requested: (await requestedHosts()).includes(new URL(url).hostname) };
}

// The hosts this browser asked WorkIt to add (chrome.storage.local), so a student asks once per job system.
const REQUESTED = "requested_job_systems";
const requestedHosts = async () => (await chrome.storage.local.get(REQUESTED))[REQUESTED] ?? [];

/**
 * Request this job system: the tab's host (no path, page text or answer)
 * to WorkIt (POST /job-system-requests), once per host from this browser.
 */
export async function requestTabSystem(tabId) {
  const url = await linkOf(tabId);
  if (!/^https?:/.test(url)) throw new Error("Not a web page");
  const host = new URL(url).hostname;
  const asked = await requestedHosts();
  if (!asked.includes(host)) {
    await requestJobSystem(host);
    await chrome.storage.local.set({ [REQUESTED]: [...asked, host] });
  }
  return {};
}

/** Save to WorkIt: the feed's job whose apply link the tab is, saved to the student's Applications. */
export async function saveTabJob(tabId) {
  return saveJobByLink(await linkOf(tabId));
}

/** Report a problem from the popup: the site and the posting's link, no fields, and the student's note. */
export async function reportTab(tabId, note = null) {
  await sendReport(await linkOf(tabId), { fields: [], note });
  return {};
}
