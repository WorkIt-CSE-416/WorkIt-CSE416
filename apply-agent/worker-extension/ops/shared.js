// Helpers every slice's ops share.

// Whether chrome.userScripts works here: Chrome hides it until the user turns
// on Allow User Scripts for this extension (once, in the seed profile).
export function userScriptsOn() {
  try {
    chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

// Where Apply's generated files are: a write-once set, vendor/sets/<id>/, that the Apply process
// driving this Worker wrote and named in its welcome (or with vendor.use), so two Apply processes
// on different engines never change each other's files. Plain "vendor" until then.
let vendorRoot = "vendor";

export function useVendor(root) {
  if (!/^vendor(\/sets\/[0-9a-f]{16,64})?$/.test(root || "")) throw named("BadOp", `not a vendor set: ${root}`);
  vendorRoot = root;
  return vendorRoot;
}

export const vendorSet = () => vendorRoot;

// `vendor/<path>` in the vendor set in use.
export const vendor = (path) => (path.startsWith("vendor/") ? `${vendorRoot}/${path.slice("vendor/".length)}` : path);

export function named(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The target of chrome.scripting / chrome.userScripts for a tab and frame (0 = top).
export const target = ({ tab, frame = 0 }) => ({ tabId: tab, frameIds: [frame] });

// `running` (a script running in one frame), or Navigated as soon as that frame commits another
// document, NoTab if its tab closes: Chrome never settles a script whose document went away
// mid-run (a Workday step's Save and Continue loads the next step while the engine waits on it).
export function untilNavigated(params, running) {
  const frame = params.frame ?? 0;
  let stop = () => {};
  const gone = new Promise((_, reject) => {
    const committed = (d) => {
      if (d.tabId === params.tab && d.frameId === frame) reject(named("Navigated", `Execution context was destroyed, most likely because of a navigation (to ${d.url})`));
    };
    const removed = (id) => {
      if (id === params.tab) reject(named("NoTab", "Target page, context or browser has been closed"));
    };
    chrome.webNavigation.onCommitted.addListener(committed);
    chrome.tabs.onRemoved.addListener(removed);
    stop = () => {
      chrome.webNavigation.onCommitted.removeListener(committed);
      chrome.tabs.onRemoved.removeListener(removed);
    };
  });
  return Promise.race([running, gone]).finally(stop);
}

// Runs `func(...args)` in the page's world ("MAIN" or "ISOLATED") of one frame, and returns its value.
export async function inPage(params, world, func, args = []) {
  const [result] = await untilNavigated(params, chrome.scripting.executeScript({ target: target(params), world, func, args, injectImmediately: true }));
  if (!result) throw named("NoFrame", `no frame ${params.frame ?? 0} in tab ${params.tab}`);
  return result.result;
}

// captureVisibleTab allows about 2 calls a second per browser, and the tile (S3) and
// screenshots share it: every capture goes through this one gate, spaced CAPTURE_GAP apart.
// A capture that never answers (a minimized window) gives up after CAPTURE_WAIT.
const CAPTURE_GAP = 520; // ms
const CAPTURE_WAIT = 5000; // ms
let gate = Promise.resolve();
let capturedAt = 0;

export function capture(windowId, options) {
  const run = gate.then(async () => {
    const wait = capturedAt + CAPTURE_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await Promise.race([
        chrome.tabs.captureVisibleTab(windowId, options),
        sleep(CAPTURE_WAIT).then(() => { throw named("TimeoutError", `captureVisibleTab: no answer in ${CAPTURE_WAIT} ms (is the window minimized?)`); }),
      ]);
    } finally {
      capturedAt = Date.now();
    }
  });
  gate = run.catch(() => {});
  return run;
}
