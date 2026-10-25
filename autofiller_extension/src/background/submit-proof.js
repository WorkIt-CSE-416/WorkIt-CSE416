// What marks a batch tab's application applied (KAN-374): the job system's
// own answer to the student's Submit, seen here, in the service worker, by
// chrome.webRequest (observing only: it never blocks or changes a request,
// and reads no response). The page's own signals (the Fill engine's
// watchSubmit event, a confirmation or thanks page) are only hints: a page
// script shares the engine's MAIN world, so it could hook the engine and
// tell the tab "sent", or move the tab to a thanks page itself, but it can't
// make this worker see the job system accept a submit request it never got.
//
// webRequest carries no install warning (the hosts below are already in
// host_permissions, which is what lets it see their requests), so adding it
// doesn't disable the extension on update. It gives no response body, so a
// job system that answers 200 to a refused submit (Ashby) needs the page's
// hint too.

/**
 * Each job system's submit request: the POST its form sends the application
 * with. `ok`: the answer statuses that mean it was taken (a 3xx is a redirect:
 * Lever's plain HTML post moves on to its thanks page). `alone`: whether that
 * answer proves the submit by itself; otherwise the page must also say it was
 * sent (Ashby answers 200 to a refusal; how Lever and Workable answer one
 * isn't recorded, so their status is checked against the page too). A job system
 * not listed (Workday, Eightfold, Rippling: no submit request is known) is
 * never marked from the page: the student marks it Applied on WorkIt.
 */
export const SUBMIT_REQUESTS = {
  greenhouse: { url: /^https:\/\/([\w-]+\.)*greenhouse\.io\/(embed\/)?[\w-]+\/jobs\/\d+\/?([?#].*)?$/, ok: [200, 299], alone: true },
  lever: { url: /^https:\/\/jobs\.lever\.co\/[^/?#]+\/[0-9a-f-]{36}\/apply\/?([?#].*)?$/i, ok: [200, 399], alone: false },
  ashby: { url: /^https:\/\/jobs\.ashbyhq\.com\/api\/non-user-graphql\?(.*&)?op=ApiSubmitMultipleFormsAction(&.*)?$/, ok: [200, 299], alone: false },
  workable: { url: /^https:\/\/apply\.workable\.com\/api\/v1\/(accounts\/[^/?#]+\/)?jobs\/\w+\/apply\/?([?#].*)?$/, ok: [200, 299], alone: false },
};

/** The site whose submit request `url` is, or null. */
export function submitSite(url) {
  return Object.keys(SUBMIT_REQUESTS).find((site) => SUBMIT_REQUESTS[site].url.test(url)) ?? null;
}

// How long a submit's answer and the page's hint may be apart and still be one submit.
const PAIRED_MS = 5 * 60_000;
// How long a hint waits for an answer that proves the submit alone, which it may arrive just before
// (Greenhouse's: the engine tells the page's answer as the page gets it).
const WAIT_MS = 15_000;

/** Per tab: when the job system took a submit (`answered`, `alone`) and when the page said "sent" (`hinted`). */
const seen = new Map();
const waiting = new Map();
const pending = new Map();

function proven(tabId) {
  const tab = seen.get(tabId);
  if (!tab?.answered || Date.now() - tab.answered > PAIRED_MS) return false;
  // The page's notice of a sent application shows after the job system's answer, never before.
  return tab.alone || (tab.hinted >= tab.answered && tab.hinted - tab.answered <= PAIRED_MS);
}

/**
 * Starts watching every tab's submit requests; `mark(tabId)` marks a batch
 * tab's application applied (batch.js's markSubmitted, which ignores any
 * other tab and marks once).
 */
export function watchSubmitRequests(mark) {
  const urls = ["https://*.greenhouse.io/*", "https://jobs.lever.co/*", "https://jobs.ashbyhq.com/*", "https://apply.workable.com/*"];
  const filter = { urls, types: ["main_frame", "sub_frame", "xmlhttprequest", "other"] };
  chrome.webRequest.onBeforeRequest.addListener((d) => {
    const site = d.method === "POST" && d.tabId >= 0 ? submitSite(d.url) : null;
    if (site) pending.set(d.requestId, { tabId: d.tabId, site });
  }, filter);
  const answered = (d) => {
    const request = pending.get(d.requestId);
    if (!request) return;
    pending.delete(d.requestId);
    const [low, high] = SUBMIT_REQUESTS[request.site].ok;
    if (d.statusCode < low || d.statusCode > high) return;
    seen.set(request.tabId, { ...seen.get(request.tabId), answered: Date.now(), alone: SUBMIT_REQUESTS[request.site].alone });
    if (proven(request.tabId)) settle(request.tabId, mark);
  };
  chrome.webRequest.onBeforeRedirect.addListener(answered, filter);
  chrome.webRequest.onCompleted.addListener(answered, filter);
  chrome.webRequest.onErrorOccurred.addListener((d) => pending.delete(d.requestId), filter);
}

function settle(tabId, mark) {
  const done = mark(tabId).then(() => true);
  done.catch((error) => console.warn("[batch] the application wasn't marked applied:", error.message));
  for (const resolve of waiting.get(tabId) ?? []) resolve(done);
  waiting.delete(tabId);
  return done;
}

/**
 * The page says tab `tabId`'s application was sent (the engine's event, or a
 * confirmation page). Marks it applied once the job system's answer to its
 * submit was seen too, waiting a little for an answer still on its way.
 * Resolves true when it was marked, false when no answer came; throws when
 * the mark itself failed.
 * @param {number} tabId
 * @param {(tabId: number) => Promise<unknown>} mark
 */
export function submitHinted(tabId, mark) {
  seen.set(tabId, { ...seen.get(tabId), hinted: Date.now() });
  if (proven(tabId)) return mark(tabId).then(() => true);
  return new Promise((resolve) => {
    const answer = (done) => {
      clearTimeout(timer);
      resolve(done);
    };
    const timer = setTimeout(() => {
      waiting.set(tabId, (waiting.get(tabId) ?? []).filter((r) => r !== answer));
      resolve(false);
    }, WAIT_MS);
    waiting.set(tabId, [...(waiting.get(tabId) ?? []), answer]);
  });
}

/** Forgets a closed tab. */
export function forgetSubmits(tabId) {
  seen.delete(tabId);
}
