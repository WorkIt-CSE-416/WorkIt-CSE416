// The panel's settings view (KAN-402), in the shell's "settings" slot
// (panel.js), shown by the header's gear in place of the tabs:
//
// - Claude: whether the student's Claude is connected to WorkIt, with Add to
//   Claude (the webapp's link to Claude's Add Custom Connector dialog) or
//   Disconnect (revokes it at once, as the webapp's Settings does). Read
//   again each time the view opens and when the student comes back to the tab.
// - Open the panel by itself: whether a batch tab's panel opens once its fill
//   is done (background panel-settings.js; panel.js's autoOpen reads it).
// - Report a problem: the report view (panel.showView("report"), KAN-403's).
// - Workday Sign-Up: opens the extension's own options page. The password is
//   never typed here: the panel lives in the employer's page.
//
// Loaded after panel.js by the static launcher and by every fill; the first
// copy draws, once the shell exists.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.panelSettings) return;
  window.WIA.panelSettings = true;
  const panel = window.WIA.panel;
  if (!panel) return;
  const send = (message) => Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);

  const CSS = `
    [data-slot="settings"] .group { padding: 10px 0; border-top: 1px solid var(--color-border-subtle); }
    [data-slot="settings"] .group:first-of-type { border-top: none; padding-top: 0; }
    [data-slot="settings"] h3 { margin: 0 0 2px; font-size: var(--text-note); font-weight: 600; color: var(--color-ink); }
    [data-slot="settings"] p { margin: 0; font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink-meta); }
    [data-slot="settings"] .claude .state { color: var(--color-ink-muted); }
    [data-slot="settings"] .claude .state[data-connected] { color: var(--color-positive-ink); font-weight: 600; }
    [data-slot="settings"] .error { color: var(--color-danger); }
    [data-slot="settings"] label.switch { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
    [data-slot="settings"] label.switch input { margin: 2px 0 0; accent-color: var(--color-ink); }
    [data-slot="settings"] label.switch span { display: flex; flex-direction: column; gap: 2px; }
    [data-slot="settings"] label.switch strong { font-size: var(--text-note); font-weight: 600; color: var(--color-ink); }
    [data-slot="settings"] label.switch small { font-size: var(--text-note); line-height: var(--text-note--line-height); color: var(--color-ink-meta); }
  `;

  function draw() {
    const view = panel.slot("settings");
    panel.addCss(CSS);
    view.replaceChildren();
    view.insertAdjacentHTML(
      "beforeend",
      `
      <h2>Settings</h2>
      <div class="group claude">
        <h3>Claude</h3>
        <p class="state" role="status">Checking your Claude…</p>
        <button type="button" data-claude hidden></button>
      </div>
      <div class="group">
        <label class="switch">
          <input type="checkbox" data-auto-open checked />
          <span><strong>Open the panel by itself</strong><small>In a batch, each tab's panel opens once its fill is done.</small></span>
        </label>
      </div>
      <div class="group">
        <h3>Report a problem</h3>
        <p>Tell WorkIt what went wrong on this page. You see what is sent first.</p>
        <button type="button" data-report-open>Report a problem</button>
      </div>
      <div class="group">
        <h3>Workday sign-up</h3>
        <p>Set your Workday password on WorkIt's own settings page, never on the employer's page.</p>
        <button type="button" data-signup>Workday Sign-Up</button>
      </div>
      <button type="button" data-back>Back</button>
      `,
    );
    view.querySelector("[data-back]").addEventListener("click", () => panel.showSettings(false));
    // KAN-403's entry point: the shell's report view (its ticket fills the "report" slot).
    view.querySelector("[data-report-open]").addEventListener("click", () => panel.showView("report", true));
    view.querySelector("[data-signup]").addEventListener("click", () => send({ type: "workday/signup-open" }));
    view.querySelector("[data-auto-open]").addEventListener("change", (event) => {
      void send({ type: "settings/auto-open", on: event.target.checked });
    });
    view.querySelector("[data-claude]").addEventListener("click", pressClaude);

    // Read again each time the gear opens the view (the shell's own listener shows it first).
    panel.root.querySelector("[data-settings]")?.addEventListener("click", () => {
      if (!view.hidden) void read();
    });
    // The student added Claude in another tab and came back.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !view.hidden) void read();
    });
  }

  let connected = null;

  /** Shows the Claude connection: true, false, or null (signed out, or not read). */
  function showClaude(claude, { signedIn = true, error = "" } = {}) {
    const view = panel.slot("settings");
    const state = view.querySelector(".claude .state");
    const button = view.querySelector("[data-claude]");
    connected = claude;
    state.classList.toggle("error", Boolean(error) || (signedIn && claude === null));
    state.toggleAttribute("data-connected", claude === true);
    if (!signedIn) state.textContent = "Sign in to WorkIt to connect your Claude.";
    else if (error) state.textContent = error;
    else if (claude === null) state.textContent = "WorkIt couldn't check your Claude. Open settings again to retry.";
    else state.textContent = claude ? "Your Claude is connected." : "Your Claude isn't connected.";
    button.hidden = !signedIn || claude === null;
    button.disabled = false;
    button.textContent = claude ? "Disconnect" : "Add to Claude";
  }

  async function read() {
    const answer = await send({ type: "settings/read" });
    if (!answer?.ok) return showClaude(null);
    panel.slot("settings").querySelector("[data-auto-open]").checked = answer.autoOpen !== false;
    showClaude(answer.claude, { signedIn: answer.signedIn });
  }

  async function pressClaude(event) {
    const button = event.currentTarget;
    if (!connected) return void send({ type: "settings/claude-add" });
    button.disabled = true;
    const answer = await send({ type: "settings/claude-disconnect" });
    if (answer?.ok) showClaude(false);
    else showClaude(true, { error: "WorkIt couldn't disconnect your Claude. Try again." });
  }

  panel.onBuilt(() => {
    draw();
    void read();
  });
})();
