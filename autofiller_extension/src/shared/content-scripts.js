// The fill engine's files, injected in this exact order by both the popup
// ("Autofill This Page") and the auto-apply runner, so the two can never
// fill with different files. lib-dom/lib-fill/lib-status/field-map/
// ats-greenhouse populate window.WIA, overlay.js reads from it, and
// content-script.js (last) is the only one that expects everything above
// it to already exist. See content-script.js's own comment for why these
// can't be ES modules instead.
export const CONTENT_SCRIPT_FILES = [
  "src/content/lib-dom.js",
  "src/content/lib-fill.js",
  "src/content/lib-status.js",
  "src/content/field-map.js",
  "src/content/ats-greenhouse.js",
  "src/content/overlay.js",
  "src/content/content-script.js",
];
