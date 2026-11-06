// S2 ops: the Fill engine, from the same build the WorkIt extension loads (vendor/engine.js).
// Both run fixed functions through chrome.scripting in the page's MAIN world, so they need no
// eval and no user scripts, and the page's CSP can't block the bundle (it goes in as a file).

import { inPage, named, vendor } from "./shared.js";

async function load(params) {
  if (!(await inPage(params, "MAIN", () => typeof FillEngine !== "undefined"))) {
    await chrome.scripting.executeScript({ target: { tabId: params.tab, frameIds: [params.frame ?? 0] }, world: "MAIN", files: [vendor("vendor/engine.js")], injectImmediately: true });
  }
  return true;
}

async function call(params) {
  const run = () => inPage(params, "MAIN", async (name, args) => {
    if (typeof FillEngine === "undefined") return { missing: true };
    return FillEngine.call(name, args);
  }, [params.name, params.args ?? []]);
  let answer = await run();
  if (answer?.missing) {
    await load(params);
    answer = await run();
  }
  if (answer?.missing) throw named("Navigated", "FillEngine is not defined (the page changed while it loaded)");
  return answer;
}

export const ops = { "engine.load": load, "engine.call": call };
