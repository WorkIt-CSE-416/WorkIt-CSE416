// A company's own careers page that embeds Greenhouse's form (`?gh_jid=` in
// its query, KAN-369): the form is Greenhouse's embed iframe
// (`*.greenhouse.io/embed/job_app`), and batch apply fills it there, in place,
// as Jobright and Simplify do. The extension has no host permission for the
// company's page, so Chrome neither names that page's frames nor lets
// `allFrames` inject (it refuses the whole tab); it does let the extension
// inject into the Greenhouse frame by its frameId. The frameId comes from the
// iframe's own request, which `webRequest` sees (no new permission, no
// install warning: greenhouse.io is in host_permissions), kept in
// storage.session, since Chrome stops this worker when idle.

// One key per tab, `embeddedForm:<tabId>` = the frameId of its Greenhouse embed frame (one key each: no lost write).
const key = (tabId) => `embeddedForm:${tabId}`;

/** A ?gh_jid= link on a site other than Greenhouse's: a careers page that embeds its form. */
export function embedsGreenhouse(url) {
  try {
    const { hostname, searchParams } = new URL(url);
    return !/(^|\.)greenhouse\.io$/.test(hostname) && /^\d+$/.test(searchParams.get("gh_jid") ?? "");
  } catch {
    return false;
  }
}

/** Notes each Greenhouse embed frame a tab loads. Called once, at the worker's top level. */
export function watchEmbeddedForms() {
  chrome.webRequest.onBeforeRequest.addListener(
    ({ tabId, frameId }) => {
      if (tabId >= 0) void chrome.storage.session.set({ [key(tabId)]: frameId });
    },
    { urls: ["https://*.greenhouse.io/embed/job_app*"], types: ["sub_frame"] },
  );
}

/**
 * The frameId of the tab's Greenhouse embed frame, once its Greenhouse page
 * takes a script, within `timeoutMs`; else null. Until Greenhouse's page
 * commits, the frame holds the iframe's first blank document, which is the
 * company page's origin and refuses the script (seen live on Databricks'
 * careers page).
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<number | null>}
 */
export async function embeddedForm(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { [key(tabId)]: frameId } = await chrome.storage.session.get(key(tabId));
    if (frameId !== undefined && (await onGreenhouse(tabId, frameId))) return frameId;
    if (Date.now() >= deadline) return null;
    await new Promise((done) => setTimeout(done, 250));
  }
}

/** Whether the frame shows Greenhouse's page (false while it can't take a script). */
async function onGreenhouse(tabId, frameId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: () => location.hostname });
    return /(^|\.)greenhouse\.io$/.test(result);
  } catch {
    return false;
  }
}
