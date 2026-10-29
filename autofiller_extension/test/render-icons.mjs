// Renders the extension's toolbar icons from the webapp's own icon
// (frontend/public/workit-icon.svg, the favicon's source), so the two never
// differ. Run after changing that file: node autofiller_extension/test/render-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "..", "..", "frontend", "public", "workit-icon.svg"), "utf8");
// Chrome asks for these sizes: 16 and 32 in the toolbar, 48 on the extensions page, 128 at install.
const SIZES = [16, 32, 48, 128];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(here, "..", "icons", `icon-${size}.png`), omitBackground: true });
}
await browser.close();
