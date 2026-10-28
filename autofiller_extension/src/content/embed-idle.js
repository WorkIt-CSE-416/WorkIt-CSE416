// Runs in Greenhouse's embed frame (`*.greenhouse.io/embed/job_app`, a
// careers page's iframe, KAN-369) before its own scripts, in its JavaScript
// world. Greenhouse's page starts React (hydrates the form) only in
// `requestIdleCallback`, and an iframe in a tab no one looks at may never
// get an idle period: its form then stays dead, and the fill's wait for it
// (the engine's waitForHydration) never ends. Seen in 1 of 2 to 4 runs of
// batch.extension.spec.ts with four Chromiums at once. A deadline makes the
// callback run anyway, as `{ timeout }` is meant to.
(() => {
  const idle = window.requestIdleCallback;
  if (typeof idle !== "function") return;
  window.requestIdleCallback = (callback, options) => idle.call(window, callback, { timeout: 500, ...options });
})();
