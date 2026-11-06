// S2 op: `dom`, Playwright's locators and actions in the extension's isolated world.
// page/dom.js does the work there, over Playwright's own injected script (vendor/injected.js).

import { inPage, vendor } from "./shared.js";

async function dom(params) {
  const run = () => inPage(params, "ISOLATED", (method, args) =>
    globalThis.__applyDom ? globalThis.__applyDom.run(method, args) : { missing: true }, [params.method, params.args ?? []]);
  let answer = await run();
  if (answer?.missing) {
    await chrome.scripting.executeScript({ target: { tabId: params.tab, frameIds: [params.frame ?? 0] }, world: "ISOLATED", files: [vendor("vendor/injected.js"), "page/dom.js"], injectImmediately: true });
    answer = await run();
  }
  return answer;
}

export const ops = { dom };
