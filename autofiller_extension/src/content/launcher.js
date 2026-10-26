// The edge tab on a job form the student opened themselves (KAN-394):
// manifest.json's one static content script on the job systems' hosts, top
// frame only. Nothing fills here: it asks the background whether the page
// is a job page WorkIt covers (panel/where, the Fill engine's jobOf) and,
// outside a batch, shows only the edge tab, with Autofill This Page in the
// panel behind it. Other pages get nothing drawn. A batch tab's panel is the
// fill's own (overlay.js), so this leaves it alone.
window.WIA = window.WIA || {};

(async function () {
  "use strict";

  if (window.WIA.launched) return;
  window.WIA.launched = true;
  const panel = window.WIA.panel;
  // After the page's own start-up: a node Greenhouse's React didn't render, drawn while it starts, makes it
  // draw the form again (overlay.js, "the panel goes on the page once the fill is done").
  if (document.readyState !== "complete") await new Promise((done) => addEventListener("load", done, { once: true }));
  await new Promise((done) => setTimeout(done, 1000));
  const fillOwns = () => window.WIA.running || window.WIA.batch || window.WIA.overlay?.state?.();
  if (fillOwns()) return;
  const { job, batch } = await panel.where();
  if (!job || batch || fillOwns()) return;
  await panel.ensure();
  // Autofill This Page, or Sign in to WorkIt when signed out (panel-states.js, KAN-401).
  if (!window.WIA.overlay?.state?.()) await window.WIA.panelStates.start();
  panel.showEdge();
})();
