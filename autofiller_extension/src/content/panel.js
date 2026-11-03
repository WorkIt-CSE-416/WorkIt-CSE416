// The panel's shell (KAN-394): one panel docked to the right edge of the job
// page, full height with its own scroll, over the page (the page is never
// resized), in a shadow root so the employer's styles can't reach it. It
// collapses to an edge tab the student drags up and down, with "Hide until
// next visit", "Hide on this site" and "Hide everywhere" (KAN-480). Where the
// tab sits, a collapse and a site hide are kept per site (background.js's
// panel/where and panel/site); a hide everywhere is one switch (panel/hide-everywhere).
// Options lists the hidden sites with Remove and has the switch.
//
// This file owns only the frame. What goes in it plugs into its slots
// (`slot(name)`, autofiller_extension/CLAUDE.md "The panel's shell"):
// "header-actions", "batch-line", "job-card", "primary", the tabs
// (`addTab`; "autofill" holds overlay.js's rows and cards) and "settings",
// and into the header's ⋯ menu (`menuItem`, KAN-369 Q4). The frame, top to
// bottom: the header (WorkIt, ⋯, Close), the job (batch line, job card) and
// the tabs, fixed (Q6); the tab's body, which scrolls; and the primary slot,
// fixed at the bottom (Q5).
// Loaded by launcher.js's static content script on job pages and by every
// fill (content-scripts.js), in the same isolated world: the first copy
// makes the shell and later ones keep it.
window.WIA = window.WIA || {};

/**
 * Whether this page is Workday's: on its own hosts, or a Workday career site
 * on the employer's domain, which its scripts mark (KAN-472). The background
 * reads it with the Fill engine (its jobOf and PAGE_MARKS, site-access.js
 * pageSystem) and sets `window.WIA.jobSystem`: a fill before its scripts
 * load (content-scripts.js injectFill), the panel from panel/where.
 */
window.WIA.onWorkday = () => window.WIA.jobSystem === "workday";

(function () {
  "use strict";

  if (window.WIA.panel) return;

  // tokens.js's --font-sans names the shipped font this way.
  const FONT_FAMILY = "WorkIt Jakarta Sans";
  // Where the edge tab sits until the student drags it (px from the top).
  const TAB_TOP = 120;
  // WorkIt's logo (frontend/src/components/logo.tsx's lockup): the figure in violet, the word in ink, as the
  // webapp draws it everywhere (KAN-300). Change the two together.
  const LOGO = `<svg role="img" aria-label="WorkIt" viewBox="0 0 434.78 91"><g class="figure"><path d="M7.94 26.87 L33.59 83.06 L59.24 45.19 L84.89 83.06 L110.54 26.87" fill="none" stroke="currentColor" stroke-width="15.88" stroke-linecap="round" stroke-linejoin="round"/><circle cx="59.24" cy="13.44" r="13.44" fill="currentColor"/></g><path d="M18 77.7 1 27.7H14.4L24.8 59.9L35.3 27.7H48.3L58.6 59.4L69.1 27.7H82.5L65.5 77.7H52.5L41.8 43.9L31 77.7H18ZM109.6 78.9Q102 78.9 96 75.5Q90.1 72.2 86.8 66.3Q83.4 60.4 83.4 52.7Q83.4 45 86.7 39.1Q90 33.2 95.9 29.9Q101.8 26.5 109.4 26.5Q117.1 26.5 123 29.9Q128.9 33.2 132.2 39.1Q135.5 45 135.5 52.7Q135.5 60.4 132.2 66.3Q128.9 72.2 123.1 75.5Q117.2 78.9 109.6 78.9ZM109.6 66.7Q113.3 66.7 116.1 64.9Q118.9 63.1 120.4 60Q122 56.8 122 52.7Q122 48.6 120.4 45.4Q118.8 42.3 116 40.5Q113.1 38.7 109.4 38.7Q105.8 38.7 102.9 40.5Q100.1 42.3 98.5 45.4Q96.9 48.6 96.9 52.7Q96.9 56.8 98.5 60Q100.1 63.1 103 64.9Q105.9 66.7 109.6 66.7ZM142.7 77.7V27.7H155.9V36.9Q159 32.2 163.7 29.8Q168.5 27.5 173.6 27.5V40.3Q169 40.3 165 41.4Q160.9 42.5 158.4 45Q155.9 47.5 155.9 51.4V77.7H142.7ZM179.1 77.7V7.7H192.3V46.3L209.4 27.7H225.1L206.2 48.8L226.6 77.7H211.1L197.8 58.3L192.3 64.3V77.7H179.1ZM232.2 77.7V27.7H245.4V77.7H232.2ZM238.8 19.6Q235.8 19.6 233.5 17.3Q231.2 15.1 231.2 12Q231.2 8.9 233.5 6.7Q235.8 4.4 238.8 4.4Q241.9 4.4 244.2 6.7Q246.4 8.9 246.4 12Q246.4 15.1 244.2 17.3Q241.9 19.6 238.8 19.6ZM276.7 78.9Q268.4 78.9 264.1 74.8Q259.9 70.7 259.9 63.1V38.9H251.8V27.7H259.9V12.1H273.1V27.7H285.6V38.9H273.1V60.2Q273.1 63.4 274.5 65.1Q275.9 66.7 278.6 66.7Q279.6 66.7 280.8 66.2Q282 65.8 283.3 64.9L287.9 74.8Q285.5 76.6 282.5 77.8Q279.6 78.9 276.7 78.9Z" fill="currentColor" transform="translate(145.78 0)"/></svg>`;
  const { send, trusted } = window.WIA.ui;

  const SHELL_CSS = `
    :host { all: initial; }
    /* Floats 8px in from the page's edges, its corners the webapp's large-surface radius. */
    .panel {
      position: fixed; top: 8px; right: 8px; bottom: 8px; z-index: 2147483647; box-sizing: border-box;
      width: 380px; display: flex; flex-direction: column; overflow: hidden;
      font: var(--font-weight-normal) var(--text-label) / var(--text-label--line-height) var(--font-sans);
      background: var(--color-panel); color: var(--color-ink);
      border: 1px solid var(--color-border); border-radius: var(--radius-shell); box-shadow: var(--shadow-lift);
    }
    .panel[hidden], [data-slot][hidden], .tab[hidden], .edge[hidden], .menu[hidden], .tabs[hidden] { display: none; }
    .header {
      flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 10px 12px; background: var(--color-panel); border-bottom: 1px solid var(--color-border);
    }
    .brand { display: flex; align-items: center; color: var(--color-ink); }
    .brand svg { height: 20px; width: auto; display: block; }
    .brand .figure { color: var(--color-brand); }
    .header-actions, [data-slot="header-actions"] { display: flex; align-items: center; gap: 6px; }
    .header button {
      all: unset; cursor: pointer; font-size: var(--text-note); font-weight: 500; color: var(--color-ink-muted);
      padding: 4px 8px; border-radius: var(--radius-control); white-space: nowrap;
    }
    .header button:hover { background: var(--color-hover); }
    .header button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 1px; }
    /* ⋯ and Close: a bare 18 px Phosphor glyph centred in a 32 px target (a text glyph sat off its line);
     * no outline, which read as odd, so only hover shows the round target. */
    .header button[data-collapse], .header button[data-more-menu] {
      display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; box-sizing: border-box;
      border-radius: 9999px; color: var(--color-ink);
    }
    .header button[data-collapse] svg, .header button[data-more-menu] svg { width: 18px; height: 18px; display: block; fill: currentColor; }
    .header button[aria-expanded="true"] { background: var(--color-hover); }
    .top { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 0; }
    .scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
    .bottom { flex: none; padding: 8px; background: var(--color-panel); border-top: 1px solid var(--color-border); }
    .bottom:has(> [data-slot="primary"]:empty) { display: none; }
    .panel-menu {
      position: absolute; top: 44px; right: 8px; z-index: 1; display: flex; flex-direction: column; min-width: 200px; padding: 4px;
      background: var(--color-panel); border: 1px solid var(--color-border); border-radius: var(--radius-card); box-shadow: var(--shadow-lift);
    }
    .panel-menu[hidden] { display: none; }
    .panel-menu button { all: unset; cursor: pointer; padding: 8px 10px; font-size: var(--text-note); color: var(--color-ink); border-radius: var(--radius-control); }
    .panel-menu button:hover { background: var(--color-hover); }
    .panel-menu button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
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
    /* The tabs are the webapp's segmented control (frontend/src/components/ui/segmented-control.tsx, its sm
     * size): a pill track of 5% ink, equal-width options, and a white thumb that glides to the chosen one
     * (300 ms; it jumps under reduced motion). Change the two together. */
    .tabs {
      position: relative; isolation: isolate; display: grid; grid-auto-columns: 1fr; grid-auto-flow: column;
      padding: 2px; border-radius: 999px; background: color-mix(in srgb, var(--color-ink) 5%, transparent);
    }
    .tabs .thumb {
      position: absolute; top: 2px; bottom: 2px; left: 2px; z-index: 0; pointer-events: none;
      width: calc((100% - 4px) / var(--count, 1)); transform: translateX(calc(var(--index, 0) * 100%));
      border-radius: 999px; background: var(--color-panel);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--color-ink) 8%, transparent), 0 2px 8px color-mix(in srgb, var(--color-ink) 8%, transparent);
      transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    @media (prefers-reduced-motion: reduce) { .tabs .thumb { transition: none; } }
    .tabs button {
      all: unset; position: relative; z-index: 1; cursor: pointer; height: 32px; padding: 0 12px;
      display: flex; align-items: center; justify-content: center; white-space: nowrap; border-radius: 999px;
      font-size: var(--text-note); font-weight: 500; color: var(--color-ink-meta); transition: color 200ms;
    }
    .tabs button:hover, .tabs button[aria-selected="true"] { color: var(--color-ink); }
    .tabs button[hidden] { display: none; }
    .tabs button:focus-visible { outline: 2px solid var(--color-brand); outline-offset: -2px; }
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
  // Hidden on every site (KAN-480): Options' "Show the WorkIt tab on job pages" turns it back on.
  let hiddenEverywhere = false;
  // Hidden until the next visit: this page only, so a new page load shows the tab again.
  let hiddenThisVisit = false;
  let ready = null;
  const tabs = [];

  function build() {
    host = document.createElement("div");
    host.id = "workit-autofiller-overlay-host";
    // Closed: the employer's page can't reach the panel through host.shadowRoot. The extension's own files reach it
    // through window.WIA.panel.root, in the isolated world the page can't see.
    root = host.attachShadow({ mode: "closed" });
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
        <span class="brand">${LOGO}</span>
        <span class="header-actions">
          <span data-slot="header-actions"></span>
          <button type="button" data-more-menu aria-label="More" aria-haspopup="menu" aria-expanded="false" title="More"><svg viewBox="0 0 256 256" aria-hidden="true"><path d="M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z"/></svg></button>
          <button type="button" data-collapse data-close aria-label="Close" title="Close (Alt+W opens it again)"><svg viewBox="0 0 256 256" aria-hidden="true"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg></button>
        </span>
      </div>
      <div class="panel-menu" role="menu" aria-label="More" hidden></div>
      <div class="top">
        <div class="card" data-slot="batch-line" hidden></div>
        <div class="card" data-slot="job-card" hidden></div>
        <div class="tabs" role="tablist" hidden><span class="thumb" aria-hidden="true"></span></div>
      </div>
      <div class="scroll">
        <div data-tabs></div>
        <div class="card" data-slot="settings" hidden>
          <h2>Settings</h2>
          <button type="button" data-signup>Workday Sign-Up</button>
          <button type="button" data-back>Back</button>
        </div>
        <div class="card" data-slot="report" hidden></div>
      </div>
      <div class="bottom"><div data-slot="primary"></div></div>
    `;
    panel.querySelector("[data-collapse]").addEventListener("click", trusted(() => collapse()));
    for (const back of panel.querySelectorAll("[data-back]")) back.addEventListener("click", trusted(() => showSettings(false)));
    menuParts(panel);
    // The extension's own settings page (src/options/): the password is never typed into the employer's page.
    panel.querySelector("[data-signup]").addEventListener("click", trusted(() => send({ type: "workday/signup-open" })));

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
      <button type="button" role="menuitem" data-hide-everywhere>Hide everywhere</button>
    `;
    edge.querySelector("[data-more]").addEventListener("click", trusted(() => {
      menu.style.top = `${edge.getBoundingClientRect().top}px`;
      menu.hidden = !menu.hidden;
    }));
    menu.querySelector("[data-hide-visit]").addEventListener("click", trusted(() => {
      hiddenThisVisit = true;
      paint();
    }));
    menu.querySelector("[data-hide-site]").addEventListener("click", trusted(() => {
      remember({ hidden: true });
      paint();
    }));
    menu.querySelector("[data-hide-everywhere]").addEventListener("click", trusted(() => hideEverywhere()));
    draggable(edge);

    root.append(panel, edge, menu);
    // One view (KAN-424): Autofill holds everything. The Resume and Answers tabs are gone: the résumé's actions are
    // the Resume/CV row's card (resume-tab.js) and written answers a box in the list (card-written.js), so with one
    // tab the strip stays hidden (addTab shows it from two).
    addTab({ id: "autofill", label: "Autofill" });
    document.documentElement.appendChild(host);
    keepAttached();
    loadFont().catch(() => {});
    for (const hook of builtHooks.splice(0)) hook();
  }

  // The ⋯ menu's items (menuItem): id → { label, onPress, order }, drawn by order.
  const items = new Map();
  let menu = null;
  let more = null;

  /** The header's ⋯ and its menu: Report a problem and Settings are the shell's own; the fill adds the rest. */
  function menuParts(panel) {
    more = panel.querySelector("[data-more-menu]");
    menu = panel.querySelector(".panel-menu");
    more.addEventListener("click", trusted(() => showMenu(menu.hidden)));
    // Shut by Escape and by a press anywhere else in the panel.
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu.hidden) return;
      showMenu(false);
      more.focus();
    });
    panel.addEventListener("click", trusted((event) => {
      if (!menu.hidden && !menu.contains(event.target) && !more.contains(event.target)) showMenu(false);
    }));
    // Report a problem (report.js, KAN-403) fills the report slot; a second press closes it.
    menuItem("report", {
      label: "Report a problem",
      order: 40,
      onPress: () => {
        if (!panel.querySelector('[data-slot="report"]').hidden) showView("report", false);
        else window.WIA.reportCard?.open();
      },
    });
    menuItem("settings", { label: "Settings", order: 50, onPress: () => showSettings(panel.querySelector('[data-slot="settings"]').hidden) });
    // The edge tab's hides (KAN-480), here too (menuItem passes each press through ui.trusted): the panel closes with no edge tab; Alt+W and the toolbar still open it.
    menuItem("hide-site", { label: "Hide on this site", order: 60, onPress: () => hideSite() });
    menuItem("hide-everywhere", { label: "Hide everywhere", order: 70, onPress: () => hideEverywhere() });
  }

  /** Hides the edge tab on this site, kept until Options' Remove; an open panel closes. */
  function hideSite() {
    remember({ hidden: true });
    collapse({ keep: false });
  }

  /** Hides the edge tab on every site, until Options' switch shows it again; an open panel closes. */
  function hideEverywhere() {
    hiddenEverywhere = true;
    void send({ type: "panel/hide-everywhere" });
    collapse({ keep: false });
  }

  function showMenu(shown) {
    menu.hidden = !shown;
    more.setAttribute("aria-expanded", String(shown));
    if (shown) menu.querySelector("button")?.focus();
  }

  /**
   * Adds (or with null takes out) one item of the header's ⋯ menu (KAN-369
   * Q4): `label`, `onPress(event)` and `order` (I submitted this 10, Skip
   * 20, Fill Again 30, Report a problem 40, Settings 50). The item carries
   * `data-<id>`; the menu shuts before `onPress` runs. Only the student's own
   * press runs it (ui.trusted), as every panel button's.
   * @param {string} id
   * @param {{ label: string, onPress: (event: MouseEvent) => void, order: number } | null} item
   */
  function menuItem(id, item) {
    if (item) items.set(id, item);
    else items.delete(id);
    if (!menu) return;
    menu.replaceChildren(
      ...[...items].sort(([, a], [, b]) => a.order - b.order).map(([key, { label, onPress }]) => {
        const button = Object.assign(document.createElement("button"), { type: "button", textContent: label });
        button.setAttribute("role", "menuitem");
        button.dataset[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = "";
        button.addEventListener("click", trusted((event) => {
          showMenu(false);
          onPress(event);
        }));
        return button;
      }),
    );
  }

  // Who wants to know when a view (settings, report) shows or goes (onView).
  const viewHooks = [];
  /** Runs `hook(name, shown)` whenever showView shows or hides a view. */
  const onView = (hook) => viewHooks.push(hook);

  // What waits for the shell to exist (onBuilt): the files that fill its slots.
  const builtHooks = [];
  // Whether a batch tab's panel opens by itself (panel/where's autoOpen).
  let autoOpens = true;

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
    grip.addEventListener("click", trusted((event) => {
      if (moved) {
        moved = false;
        event.preventDefault();
        return;
      }
      open();
    }));
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
    edge.hidden = shown || hiddenThisVisit || Boolean((site.hidden || hiddenEverywhere) && !shell.batch);
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
      window.WIA.jobSystem ??= answer?.jobSystem ?? null;
      hiddenEverywhere = Boolean(answer?.hiddenEverywhere);
      shell.batch = Boolean(answer?.batch);
      // The settings view's Open the panel by itself (KAN-402), on unless the student turned it off.
      autoOpens = answer?.autoOpen !== false;
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

  /** Opens the panel (the student's press: a collapse kept for the site is let go; a hide stays until Options). */
  function open() {
    if (!root) return false;
    root.querySelector(".panel").hidden = false;
    if (site.collapsed) remember({ collapsed: false });
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

  /** Opens the panel by itself (a batch tab whose fill is done), unless the student collapsed it on this site or turned auto-open off. */
  async function autoOpen() {
    await ensure();
    if (site.collapsed || !autoOpens) return paint();
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
   * own (overlay.js fills it); others (Resume, Answers) add theirs. The tab
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
    // A tab's press also leaves the settings or report view: the tabs stay on top in every view (KAN-369 Q6).
    button.addEventListener("click", trusted(() => {
      if (root.querySelector("[data-tabs]").hidden) showView(null, false);
      selectTab(id);
      keepTab(id);
    }));
    tabs.push(id);
    root.querySelector(".tabs").appendChild(button);
    root.querySelector("[data-tabs]").appendChild(body);
    root.querySelector(".tabs").hidden = tabs.length < 2;
    selectTab(tabs.includes(keptTab()) && !hiddenTabs.has(keptTab()) ? keptTab() : tabs[0]);
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

  // Tabs a file hid (showTab): the Answers tab on a form with nothing written.
  const hiddenTabs = new Set();

  /**
   * Shows or hides a tab's option (KAN-424): a tab with nothing for this page
   * goes from the strip; hiding the chosen one chooses the first shown.
   */
  function showTab(id, shown) {
    const button = root?.querySelector(`.tabs button[data-tab="${CSS.escape(id)}"]`);
    if (!button) return;
    if (shown) hiddenTabs.delete(id);
    else hiddenTabs.add(id);
    button.hidden = !shown;
    const chosen = root.querySelector('.tabs button[aria-selected="true"]')?.dataset.tab;
    selectTab(chosen && !hiddenTabs.has(chosen) ? chosen : tabs.find((t) => !hiddenTabs.has(t)));
  }

  function selectTab(id) {
    const strip = root.querySelector(".tabs");
    // The thumb slides to the chosen option: its place among the shown, equal-width options.
    const shown = tabs.filter((t) => !hiddenTabs.has(t));
    strip.style.setProperty("--count", String(shown.length || 1));
    strip.style.setProperty("--index", String(Math.max(shown.indexOf(id), 0)));
    for (const button of root.querySelectorAll(".tabs button")) button.setAttribute("aria-selected", String(button.dataset.tab === id));
    for (const body of root.querySelectorAll(".tab")) body.hidden = body.dataset.tab !== id;
  }

  /** The settings view in place of the tabs (true), or the tabs again (false). */
  function showSettings(shown) {
    showView("settings", shown);
  }

  /** A view in place of the tab's body ("settings", "report"), or the tab again (shown false). The tab strip stays. */
  function showView(name, shown) {
    for (const view of ["settings", "report"]) root.querySelector(`[data-slot="${view}"]`).hidden = !(shown && view === name);
    root.querySelector("[data-tabs]").hidden = shown;
    for (const hook of viewHooks) hook(name, shown);
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
    button.addEventListener("click", trusted(options.onPress));
    const said = Object.assign(document.createElement("div"), { className: "primary-said", hidden: true });
    place.replaceChildren(button, said);
    return { button, said };
  }

  /**
   * The words of the button before a fill (KAN-396): Fill this step on a
   * Workday step outside a batch (the fill fills the step shown; Fill to
   * Review, workday-walk.js, goes on from there), else Autofill This Page.
   */
  const startLabel = () =>
    window.WIA.onWorkday() && !window.WIA.batch ? "Fill this step" : "Autofill This Page";

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
    where, ensure, open, collapse, autoOpen, toggle, isOpen, showEdge, slot, addCss, addTab, selectTab, showTab, showSettings, showView, setPrimary, fillButton, startLabel, onBuilt, menuItem, onView,
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
