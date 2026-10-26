// The extension's design tokens (src/shared/tokens.js) are WorkIt's own, copied from the frontend's
// globals.css, and the popup and the panel use only them: no colour of their own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const read = (...path: string[]) => readFileSync(join(__dirname, "..", ...path), "utf8");

/** Every `--name: value;` in a stylesheet's text, comments dropped; the first one of a name wins. */
function properties(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    if (!found.has(name)) found.set(name, value.trim());
  }
  return found;
}

/** A globals.css value as the extension writes it: rem in px (16px to the rem). */
const inPx = (value: string) => value.replace(/(\d*\.?\d+)rem\b/g, (_, n) => `${Number(n) * 16}px`);

test("the extension's tokens have globals.css's values", () => {
  const theirs = properties(read("..", "frontend", "src", "app", "globals.css"));
  const ours = properties(read("src", "shared", "tokens.js"));
  expect(ours.size).toBeGreaterThan(20);
  for (const [name, value] of ours) {
    // The font is the frontend's next/font variable there; here, the shipped file's family.
    if (name === "--font-sans") continue;
    expect(theirs.has(name), `${name} is not a globals.css token`).toBe(true);
    expect(value, name).toBe(inPx(theirs.get(name)!));
  }
});

for (const file of ["src/popup/popup.css", "src/popup/popup.html", "src/popup/popup.js", "src/content/overlay.js", "src/content/row-card.js", "src/content/card-failed.js", "src/content/marks.js", "src/content/card-guess.js", "src/content/card-flag.js"]) {
  test(`${file} uses the tokens, not colours of its own`, () => {
    const text = read(file);
    expect(text.match(/#[0-9a-f]{3,8}\b/gi) ?? [], file).toEqual([]);
    expect(text.match(/\b(rgba?|hsla?)\(/gi) ?? [], file).toEqual([]);
  });
}
