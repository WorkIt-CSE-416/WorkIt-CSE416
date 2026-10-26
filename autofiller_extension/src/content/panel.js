// The panel's shell (KAN-394): one panel docked to the right edge of the job
// page, full height with its own scroll, over the page (the page is never
// resized), in a shadow root so the employer's styles can't reach it. It
// collapses to an edge tab the student drags up and down, with "Hide until
// next visit" and "Hide on this site". Where the tab sits, a collapse and a
// site hide are kept per site (background.js's panel/where and panel/site).
//
// This file owns only the frame. What goes in it plugs into its slots
// (`slot(name)`, autofiller_extension/CLAUDE.md "The panel's shell"):
// "header-actions", "batch-line", "job-card", "primary", the tabs
// (`addTab`; "autofill" holds overlay.js's rows and cards) and "settings".
// Loaded by launcher.js's static content script on job pages and by every
// fill (content-scripts.js), in the same isolated world: the first copy
// makes the shell and later ones keep it.
window.WIA = window.WIA || {};

(function () {
  "use strict";

  if (window.WIA.panel) return;

  // tokens.js's --font-sans names the shipped font this way.
  const FONT_FAMILY = "WorkIt Jakarta Sans";
  // Where the edge tab sits until the student drags it (px from the top).
  const TAB_TOP = 120;
  // WorkIt's mark (frontend/src/components/logo.tsx), in ink: the header is neutral.
  const LOGO = `<svg role="img" aria-label="WorkIt" viewBox="0 0 118.48 91"><path d="M7.94 26.87 L33.59 83.06 L59.24 45.19 L84.89 83.06 L110.54 26.87" fill="none" stroke="currentColor" stroke-width="15.88" stroke-linecap="round" stroke-linejoin="round"/><circle cx="59.24" cy="13.44" r="13.44" fill="currentColor"/></svg>`;
  const send = (message) => Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);

  const SHELL_CSS = `
    :host { all: initial; }
    .panel {
      position: fixed; top: 0; right: 0; z-index: 2147483647; box-sizing: border-box;
      width: 380px; height: 100vh; display: flex; flex-direction: column;
      font: var(--font-weight-normal) var(--text-label) / var(--text-label--line-height) var(--font-sans);
      background: var(--color-well); color: var(--color-ink);
      border-left: 1px solid var(--color-border); box-shadow: var(--shadow-lift);
    }
    .panel[hidden], [data-slot][hidden], .tab[hidden], .edge[hidden], .menu[hidden], .tabs[hidden] { display: none; }
    .header {
      flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; background: var(--color-panel); border-bottom: 1px solid var(--color-border);
    }
    .brand { display: flex; align-items: center; gap: 6px; font-size: var(--text-body); font-weight: 700; color: var(--color-ink); }
    .brand svg { height: 18px; width: auto; display: block; }
    .header-actions, [data-slot="header-actions"] { display: flex; align-items: center; gap: 4px; }
    .header button {
      all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted);
      padding: 4px 8px; border-radius: var(--radius-control); white-space: nowrap;
    }
    .header button:hover { background: var(--color-hover); }
    .header button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .header button[data-collapse], .header button[data-settings], .header button[data-report] { font-size: var(--text-body); padding: 2px 8px; }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
    .card { background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-card); }
    [data-slot="batch-line"] { padding: 6px 10px; font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="job-card"] { padding: 12px; }
    [data-slot="primary"] { display: flex; flex-direction: column; gap: 6px; }
    [data-slot="primary"]:empty { display: none; }
    .primary-button {
      all: unset; box-sizing: border-box; cursor: pointer; text-align: center; width: 100%; padding: 10px 12px;
      font-size: var(--text-body); line-height: var(--text-body--line-height); font-weight: 600;
      border-radius: var(--radius-control); background: var(--color-brand); color: var(--color-on-brand);
    }
    .primary-button:hover { background: var(--color-brand-hover); }
    .primary-button[data-secondary] { background: var(--color-panel); color: var(--color-ink); border: 1px solid var(--color-border-subtle); }
    .primary-button[data-secondary]:hover { background: var(--color-hover); }
    .primary-button[disabled] { cursor: default; opacity: 0.7; }
    .primary-button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    .primary-said { font-size: var(--text-note); color: var(--color-ink-meta); }
    .primary-said[data-error] { color: var(--color-danger); }
    .tabs { display: flex; gap: 4px; }
    .tabs button {
      all: unset; cursor: pointer; padding: 6px 10px; font-size: var(--text-note); font-weight: 600;
      color: var(--color-ink-meta); border-radius: var(--radius-control);
    }
    .tabs button[aria-selected="true"] { color: var(--color-ink); background: var(--color-panel); box-shadow: inset 0 -2px 0 var(--color-ink); }
    .tabs button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    .tab { overflow: hidden; }
    .tab-placeholder { margin: 0; padding: 16px 12px; font-size: var(--text-note); color: var(--color-ink-meta); }
    [data-slot="settings"], [data-slot="report"] { padding: 12px; }
    [data-slot="settings"] h2, [data-slot="report"] h2 { margin: 0 0 8px; font-size: var(--text-label); font-weight: 600; }
    [data-slot="report"] p { margin: 0; color: var(--color-ink-meta); }
    [data-slot="settings"] button, [data-slot="report"] button {
      all: unset; cursor: pointer; display: block; margin-top: 6px; padding: 6px 10px; font-size: var(--text-note); font-weight: 500;
      border-radius: var(--radius-control); border: 1px solid var(--color-border-subtle); background: var(--color-panel); color: var(--color-ink);
    }
    [data-slot="settings"] button:hover, [data-slot="report"] button:hover { background: var(--color-hover); }
    [data-slot="settings"] button:focus-visible, [data-slot="report"] button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
    /* The edge tab: what a collapsed panel leaves on the right edge. */
    .edge {
      position: fixed; right: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: stretch;
      background: var(--color-panel); border: 1px solid var(--color-border); border-right: none;
      border-radius: var(--radius-card) 0 0 var(--radius-card); box-shadow: var(--shadow-lift);
      font: 600 var(--text-note) / var(--text-note--line-height) var(--font-sans); color: var(--color-ink);
    }
    .edge button { all: unset; cursor: pointer; text-align: center; }
    .edge [data-open] { writing-mode: vertical-rl; padding: 12px 6px; cursor: grab; touch-action: none; user-select: none; }
    .edge [data-open]:hover, .edge [data-more]:hover { background: var(--color-hover); }
    .edge [data-more] { padding: 2px 0 6px; color: var(--color-ink-meta); border-top: 1px solid var(--color-border); }
    .edge button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
    .menu {
      position: fixed; right: 36px; z-index: 2147483647; display: flex; flex-direction: column; min-width: 180px; padding: 4px;
      background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-card); box-shadow: var(--shadow-lift);
      font: var(--font-weight-normal) var(--text-note) / var(--text-note--line-height) var(--font-sans); color: var(--color-ink);
    }
    .menu button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: var(--radius-control); }
    .menu button:hover { background: var(--color-hover); }
    .menu button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
  `;

  let host = null;
  let root = null;
  let keeper = null;
  // This site's kept choices (background.js panel/where): { top, collapsed, hidden }.
  let site = {};
  // Hidden until the next visit: this page only, so a new page load shows the tab again.
  let hiddenThisVisit = false;
  let ready = null;
  const tabs = [];

  function build() {
    host = document.createElement("div");
    host.id = "workit-autofiller-overlay-host";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.dataset.shell = "";
    style.textContent = `${window.WIA.tokens ?? ""}\n${SHELL_CSS}`;
    root.appendChild(style);

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "WorkIt");
    panel.innerHTML = `
      <div class="header">
        <span class="brand">${LOGO}<span aria-hidden="true">WorkIt</span></span>
        <span class="header-actions">
          <span data-slot="header-actions"></span>
          <button type="button" data-report aria-label="Report a problem" title="Report a problem">⚑</button>
          <button type="button" data-settings aria-label="Settings" title="Settings">⚙</button>
          <button type="button" data-collapse data-close aria-label="Collapse" title="Collapse">›</button>
        </span>
      </div>
      <div class="scroll">
        <div class="card" data-slot="batch-line" hidden></div>
        <div class="card" data-slot="job-card" hidden></div>
        <div data-slot="primary"></div>
        <div class="tabs" role="tablist" hidden></div>
        <div data-tabs></div>
        <div class="card" data-slot="settings" hidden>
          <h2>Settings</h2>
          <button type="button" data-signup>Workday Sign-Up</button>
          <button type="button" data-back>Back</button>
        </div>
        <div class="card" data-slot="report" hidden>
          <h2>Report a problem</h2>
          <p>Soon you can tell WorkIt what went wrong on this page, and see exactly what is sent first. Nothing is sent yet.</p>
          <button type="button" data-back>Back</button>
        </div>
      </div>
    `;
    panel.querySelector("[data-collapse]").addEventListener("click", () => collapse());
    panel.querySelector("[data-settings]").addEventListener("click", () => showSettings(panel.querySelector('[data-slot="settings"]').hidden));
    for (const back of panel.querySelectorAll("[data-back]")) back.addEventListener("click", () => showSettings(false));
    // A placeholder until the report ticket fills the report slot (KAN-395).
    panel.querySelector("[data-report]").addEventListener("click", () => showView("report", panel.querySelector('[data-slot="report"]').hidden));
    // The extension's own settings page (src/options/): the password is never typed into the employer's page.
    panel.querySelector("[data-signup]").addEventListener("click", () => send({ type: "workday/signup-open" }));

    const edge = document.createElement("div");
    edge.className = "edge";
    edge.hidden = true;
    edge.innerHTML = `
      <button type="button" data-open aria-label="Show WorkIt panel" title="Show WorkIt panel (drag to move)">WorkIt</button>
      <button type="button" data-more aria-label="WorkIt tab options" aria-haspopup="menu" title="Hide">⋯</button>
    `;
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button type="button" role="menuitem" data-hide-visit>Hide until next visit</button>
      <button type="button" role="menuitem" data-hide-site>Hide on this site</button>
    `;
    edge.querySelector("[data-more]").addEventListener("click", () => {
      menu.style.top = `${edge.getBoundingClientRect().top}px`;
      menu.hidden = !menu.hidden;
    });
    menu.querySelector("[data-hide-visit]").addEventListener("click", () => {
      hiddenThisVisit = true;
      paint();
    });
    menu.querySelector("[data-hide-site]").addEventListener("click", () => {
      remember({ hidden: true });
      paint();
    });
    draggable(edge);

    root.append(panel, edge, menu);
    addTab({ id: "autofill", label: "Autofill" });
    // Résumé and Answers hold a placeholder until their own files fill them (replaceChildren).
    for (const [id, label, text] of [
      ["resume", "Résumé", "The résumé this form gets will show here."],
      ["answers", "Answers", "This job's written answers will show here."],
    ]) addTab({ id, label }).replaceChildren(Object.assign(document.createElement("p"), { className: "tab-placeholder", textContent: text }));
    document.documentElement.appendChild(host);
    keepAttached();
    loadFont().catch(() => {});
    for (const hook of builtHooks.splice(0)) hook();
  }

  // What waits for the shell to exist (onBuilt): the files that fill its slots.
  const builtHooks = [];

  /** Runs `hook` once the shell exists (now, if it does). */
  function onBuilt(hook) {
    if (root) hook();
    else builtHooks.push(hook);
  }

  /**
   * The edge tab moves up and down under the student's pointer; a press
   * that doesn't move opens the panel. Where it lands is kept for the site.
   */
  function draggable(edge) {
    const grip = edge.querySelector("[data-open]");
    let from = null;
    let moved = false;
    grip.addEventListener("pointerdown", (event) => {
      from = { y: event.clientY, top: edge.getBoundingClientRect().top };
      moved = false;
      grip.setPointerCapture(event.pointerId);
    });
    const follow = (event) => {
      if (!from) return;
      const dy = event.clientY - from.y;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      edge.style.top = `${clampTop(from.top + dy, edge)}px`;
    };
    grip.addEventListener("pointermove", follow);
    // The release's own position too: the last moves before it may come merged into it.
    grip.addEventListener("pointerup", (event) => {
      follow(event);
      if (from && moved) remember({ top: parseFloat(edge.style.top) });
      from = null;
    });
    grip.addEventListener("click", (event) => {
      if (moved) {
        moved = false;
        event.preventDefault();
        return;
      }
      open();
    });
  }

  const clampTop = (top, edge) => Math.max(8, Math.min(top, window.innerHeight - (edge.offsetHeight || 80) - 8));

  /** Saves this site's choices (merged into what is kept). */
  function remember(change) {
    site = { ...site, ...change };
    void send({ type: "panel/site", set: change });
  }

  /** Shows whichever of the panel and the edge tab is due. */
  function paint() {
    if (!root) return;
    const panel = root.querySelector(".panel");
    const edge = root.querySelector(".edge");
    const shown = !panel.hidden;
    edge.hidden = shown || hiddenThisVisit || Boolean(site.hidden && !shell.batch);
    root.querySelector(".menu").hidden = true;
    edge.style.top = `${clampTop(site.top ?? TAB_TOP, edge)}px`;
  }

  /**
   * Asks the background, once per page and before anything is drawn:
   * whether the page is a job system's page WorkIt covers (`job`), whether
   * the tab is a batch's (`batch`), and this site's kept choices.
   * @returns {Promise<{ job: boolean, batch: boolean }>}
   */
  function where() {
    ready ??= send({ type: "panel/where" }).then((answer) => {
      site = answer?.site ?? {};
      shell.batch = Boolean(answer?.batch);
      return { job: Boolean(answer?.job), batch: Boolean(answer?.batch) };
    });
    return ready;
  }

  /** Makes the shell (once per page), then paints it with this site's choices. */
  function ensure() {
    if (!host) build();
    return where().then((answer) => {
      paint();
      return answer;
    });
  }

  /** Opens the panel (the student's press: a collapse kept for the site is let go). */
  function open() {
    if (!root) return false;
    root.querySelector(".panel").hidden = false;
    if (site.collapsed || site.hidden) remember({ collapsed: false, hidden: false });
    hiddenThisVisit = false;
    paint();
    return true;
  }

  /** Collapses the panel to the edge tab; kept for the site unless `remember` is false. */
  function collapse({ keep = true } = {}) {
    if (!root) return;
    root.querySelector(".panel").hidden = true;
    if (keep) remember({ collapsed: true });
    paint();
  }

  /** Opens the panel by itself (a batch tab whose fill is done), unless the student collapsed it on this site. */
  async function autoOpen() {
    await ensure();
    if (site.collapsed) return paint();
    root.querySelector(".panel").hidden = false;
    paint();
  }

  /** The toolbar icon or Alt+W: opens a closed panel, collapses an open one. */
  function toggle() {
    if (!root) return false;
    if (isOpen()) collapse();
    else open();
    return true;
  }

  const isOpen = () => Boolean(root && !root.querySelector(".panel").hidden);

  /** Shows the edge tab (a job page outside a batch: nothing opens by itself). */
  function showEdge() {
    paint();
  }

  /**
   * One of the slots (CLAUDE.md "The panel's shell"): "header-actions",
   * "batch-line", "job-card", "primary", "settings", or "tab:<id>" for a
   * tab's body. The card slots hide while empty; fill one and set
   * `hidden = false`.
   */
  function slot(name) {
    if (!root) return null;
    if (name.startsWith("tab:")) return root.querySelector(`.tab[data-tab="${CSS.escape(name.slice(4))}"]`);
    return root.querySelector(`[data-slot="${CSS.escape(name)}"]`);
  }

  /** Adds styles to the shell's shadow root (tokens only), for what a file puts in a slot. */
  function addCss(css) {
    if (!root) return;
    const style = document.createElement("style");
    style.textContent = css;
    root.appendChild(style);
    return style;
  }

  /**
   * A tab of the panel's tab area: `id`, `label`. "autofill" is the shell's
   * own (overlay.js fills it); others (Résumé, Answers) add theirs. The tab
   * strip shows once there are two. Returns the tab's body.
   */
  function addTab({ id, label }) {
    const existing = root.querySelector(`.tab[data-tab="${CSS.escape(id)}"]`);
    if (existing) return existing;
    const body = Object.assign(document.createElement("div"), { className: "tab" });
    body.dataset.tab = id;
    body.setAttribute("role", "tabpanel");
    const button = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    button.setAttribute("role", "tab");
    button.dataset.tab = id;
    button.addEventListener("click", () => {
      selectTab(id);
      keepTab(id);
    });
    tabs.push(id);
    root.querySelector(".tabs").appendChild(button);
    root.querySelector("[data-tabs]").appendChild(body);
    root.querySelector(".tabs").hidden = tabs.length < 2;
    selectTab(tabs.includes(keptTab()) ? keptTab() : tabs[0]);
    return body;
  }

  // The tab the student chose, kept for this browser tab (a new page load or a Workday step shows it again).
  const TAB_KEY = "workit-panel-tab";
  function keptTab() {
    try {
      return sessionStorage.getItem(TAB_KEY);
    } catch {
      return null;
    }
  }
  function keepTab(id) {
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // A page that refuses storage: the choice lasts until the page goes.
    }
  }

  function selectTab(id) {
    for (const button of root.querySelectorAll(".tabs button")) button.setAttribute("aria-selected", String(button.dataset.tab === id));
    for (const body of root.querySelectorAll(".tab")) body.hidden = body.dataset.tab !== id;
  }

  /** The settings view in place of the tabs (true), or the tabs again (false). */
  function showSettings(shown) {
    showView("settings", shown);
  }

  /** A view in place of the tabs ("settings", "report"), or the tabs again (shown false). */
  function showView(name, shown) {
    for (const view of ["settings", "report"]) root.querySelector(`[data-slot="${view}"]`).hidden = !(shown && view === name);
    root.querySelector("[data-tabs]").hidden = shown;
    root.querySelector(".tabs").hidden = shown || tabs.length < 2;
  }

  /**
   * The primary slot's one button: `label`, `onPress`; `secondary` draws it
   * white (purple is kept for the next action). null empties the slot.
   * Returns the button and a line under it (`said`) for its result.
   * @param {{ label: string, onPress: () => void, secondary?: boolean } | null} options
   */
  function setPrimary(options) {
    const place = slot("primary");
    if (!place) return null;
    if (!options) return void place.replaceChildren();
    const button = Object.assign(document.createElement("button"), { type: "button", className: "primary-button", textContent: options.label });
    if (options.secondary) button.dataset.secondary = "";
    button.addEventListener("click", options.onPress);
    const said = Object.assign(document.createElement("div"), { className: "primary-said", hidden: true });
    place.replaceChildren(button, said);
    return { button, said };
  }

  /**
   * Autofill This Page and Fill Again: the background injects the fill into
   * this frame (panel/fill); the panel shows the rows once it is done.
   */
  function fillButton(label, { secondary = false } = {}) {
    const parts = setPrimary({
      label,
      secondary,
      onPress: async () => {
        parts.button.disabled = true;
        parts.button.textContent = "Filling…";
        parts.said.hidden = true;
        const answer = await send({ type: "panel/fill", batch: Boolean(window.WIA.batch) });
        if (answer?.ok) return;
        parts.button.disabled = false;
        parts.button.textContent = label;
        parts.said.dataset.error = "";
        parts.said.textContent = "WorkIt couldn't start filling this page. Reload it and try again.";
        parts.said.hidden = false;
      },
    });
    return parts;
  }

  /**
   * Puts the shell back whenever the page removes it (Greenhouse's start-up
   * can replace <html>; overlay.js's note on hydration).
   */
  function keepAttached() {
    keeper = new MutationObserver(() => {
      if (host && !host.isConnected) document.documentElement.appendChild(host);
    });
    keeper.observe(document, { childList: true, subtree: true });
  }

  /**
   * Adds Plus Jakarta Sans (fonts/, as "WorkIt Jakarta Sans") to the page's
   * fonts, once: @font-face inside a shadow root does nothing, and the
   * extension's files aren't web-accessible, so the background reads the
   * file and the bytes come here. Until it loads, the system font.
   */
  async function loadFont() {
    if ([...document.fonts].some((face) => face.family.replace(/"/g, "") === FONT_FAMILY)) return;
    const answer = await send({ type: "overlay/font" });
    if (!answer?.ok || !answer.data) return;
    const bytes = Uint8Array.from(atob(answer.data), (c) => c.charCodeAt(0));
    const face = new FontFace(FONT_FAMILY, bytes, { weight: "200 800" });
    document.fonts.add(await face.load());
  }

  const shell = {
    batch: false,
    where, ensure, open, collapse, autoOpen, toggle, isOpen, showEdge, slot, addCss, addTab, selectTab, showSettings, showView, setPrimary, fillButton, onBuilt,
    get root() {
      return root;
    },
  };
  window.WIA.panel = shell;

  // The toolbar icon and Alt+W (background.js toolbarPressed), in whichever frame has the shell.
  chrome.runtime.onMessage?.addListener?.((message, _sender, reply) => {
    if (message?.type !== "panel/toggle" || !root) return;
    reply({ toggled: toggle() });
  });

})();
