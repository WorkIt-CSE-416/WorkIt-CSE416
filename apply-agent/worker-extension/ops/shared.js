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

export function named(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The target of chrome.scripting / chrome.userScripts for a tab and frame (0 = top).
export const target = ({ tab, frame = 0 }) => ({ tabId: tab, frameIds: [frame] });

// Runs `func(...args)` in the page's world ("MAIN" or "ISOLATED") of one frame, and returns its value.
export async function inPage(params, world, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: target(params), world, func, args, injectImmediately: true });
  if (!result) throw named("NoFrame", `no frame ${params.frame ?? 0} in tab ${params.tab}`);
  return result.result;
}
