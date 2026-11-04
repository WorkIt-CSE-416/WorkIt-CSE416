// S1 ops: ping, the Worker's tabs, and page code (eval).

import { named, target, untilNavigated, userScriptsOn } from "./shared.js";

function tabInfo(tab) {
  return { tab: tab.id, url: tab.url || tab.pendingUrl || "", title: tab.title || "", status: tab.status, active: tab.active, window: tab.windowId };
}

// `code` is one expression (Apply wraps the caller's code so it returns {ok} or {err}).
// Through chrome.userScripts in the MAIN world, which page CSP doesn't govern; with user
// scripts off (Chrome for Testing in tests, where no one can toggle them) through an
// indirect eval in MAIN, which works only where the page's CSP allows eval.
async function evaluate(params) {
  if (userScriptsOn()) {
    const [result] = await untilNavigated(params, chrome.userScripts.execute({ target: target(params), world: "MAIN", js: [{ code: params.code }], injectImmediately: true }));
    if (!result) throw named("NoFrame", `no frame ${params.frame ?? 0} in tab ${params.tab}`);
    if (result.error) throw named("EvalError", result.error);
    return result.result;
  }
  const [result] = await untilNavigated(params, chrome.scripting.executeScript({
    target: target(params),
    world: "MAIN",
    injectImmediately: true,
    func: (code) => {
      try {
        return (0, eval)(code);
      } catch (error) {
        return { err: { name: error?.name === "EvalError" ? "UserScriptsOff" : error?.name || "Error", message: String(error?.message ?? error) } };
      }
    },
    args: [params.code],
  }));
  if (!result) throw named("NoFrame", `no frame ${params.frame ?? 0} in tab ${params.tab}`);
  return result.result;
}

export const ops = {
  ping: async () => ({ pong: true, userScripts: userScriptsOn(), webdriver: navigator.webdriver === true, tabs: (await chrome.tabs.query({})).length }),
  "tabs.query": async () => (await chrome.tabs.query({})).map(tabInfo),
  "tabs.create": async ({ url, active = false }) => tabInfo(await chrome.tabs.create({ url: url || "about:blank", active })),
  // focused: false shows the window without activating Chrome, so it never takes Lisul's focus.
  "windows.create": async ({ url, left, top, width, height }) =>
    tabInfo((await chrome.windows.create({ url: url || "about:blank", focused: false, left, top, width, height })).tabs[0]),
  "tabs.get": async ({ tab }) => tabInfo(await chrome.tabs.get(tab)),
  "tabs.close": async ({ tab }) => {
    await chrome.tabs.remove(tab);
    return null;
  },
  eval: evaluate,
};

export { tabInfo };
