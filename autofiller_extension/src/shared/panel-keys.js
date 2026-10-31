// The panel's kept choices in chrome.storage.local (KAN-480), read and
// written by the background (background.js, panel-settings.js) and the
// options page (options.js), so all three name them once, here.

/** Hide everywhere: true while the panel is hidden on every site. */
export const HIDDEN_EVERYWHERE_KEY = "panel_hidden_everywhere";
/** Each site's choices, by host name: where the edge tab sits, collapsed, `hidden`. */
export const PANEL_SITES_KEY = "panel_sites";
