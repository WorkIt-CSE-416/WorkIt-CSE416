// WorkIt's design tokens for the extension's two surfaces, the popup and the
// on-page panel (overlay.js), defined once here. The values are copied from
// frontend/src/app/globals.css, since the extension has no build step to
// import its Tailwind @theme: change a value there and here together
// (test/tokens.spec.ts fails when they differ). Sizes are in px where
// globals.css has rem: the panel sits on an employer's page, whose root font
// size isn't WorkIt's 16px.
//
// A classic script, so it loads both ways: popup.html's <script> (which also
// puts the tokens on the popup's :root, before it paints) and
// content-scripts.js's injection ahead of overlay.js (which puts
// window.WIA.tokens in the panel's shadow root, on :host).
window.WIA = window.WIA || {};

(function () {
  "use strict";

  const TOKENS = `
    :root, :host {
      --color-brand: #6d3fd8;
      --color-brand-hover: #5b30c0;
      --color-brand-active: #4c27a3;
      --color-brand-tint: #efeaff;
      --color-brand-ink: #5b30c0;
      --color-on-brand: #ffffff;
      --color-ink: #121a28;
      --color-ink-muted: #3b3e46;
      --color-ink-meta: #596980;
      --color-ink-subtle: #94969d;
      --color-panel: #ffffff;
      --color-well: #f7f7f7;
      --color-hover: #f0f0f0;
      --color-border: #e3e9f0;
      --color-border-subtle: #e8ebf5;
      --color-border-control: #8a8f9a;
      --color-positive: #17b076;
      --color-positive-ink: #107a52;
      --color-positive-tint: #e3f7f0;
      --color-warning: #8a5a00;
      --color-warning-tint: #fdf0d9;
      --color-warning-strong: #d97706;
      --color-danger: #c02a3d;
      --color-danger-tint: #fce9eb;
      --color-advanced: #2f5fd6;
      --color-advanced-tint: #e3ebff;

      --radius-control: 8px;
      --radius-card: 10px;
      --shadow-lift: 0 2px 4px rgb(18 26 40 / 0.04), 0 10px 24px rgb(18 26 40 / 0.08);

      --font-weight-normal: 450;
      --text-meta: 11px;
      --text-meta--line-height: 15px;
      --text-note: 12px;
      --text-note--line-height: 16px;
      --text-label: 13px;
      --text-label--line-height: 18px;
      --text-label--font-weight: 500;
      --text-body: 14px;
      --text-body--line-height: 20px;
      --text-subtitle: 16px;
      --text-subtitle--line-height: 22px;
      --text-subtitle--font-weight: 600;

      /* Plus Jakarta Sans, shipped in fonts/ under its own name (so it never meets a page's font of
         that name): popup.css's @font-face, the panel's FontFace (overlay.js). */
      --font-sans: "WorkIt Jakarta Sans", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
  `;

  window.WIA.tokens = TOKENS;

  // Loaded by a page's own <script> (the popup), not injected: style that page.
  if (document.currentScript) {
    const style = document.createElement("style");
    style.textContent = TOKENS;
    document.head.appendChild(style);
  }
})();
