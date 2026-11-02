#!/usr/bin/env node
// The extension's ID, from manifest.json's `key` (KAN-463): Chrome's ID is the first 128 bits of the
// SHA-256 of the key's DER bytes, each hex digit 0-f written as a-p. The key is the one place the ID is
// set: the dev build, the tests (test/loaded-extension.ts) and, through `--write`, the website
// (frontend/src/lib/autofill-extension.ts) all take it from there. test/extension-id.spec.ts fails
// while the website's ID differs.
//
//   node autofiller_extension/store/extension-id.mjs           prints the ID
//   node autofiller_extension/store/extension-id.mjs --write   also writes it into the website
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** @param {string} key a manifest `key`: base64 DER, one line, no BEGIN/END markers */
export function extensionId(key) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}

/** The ID of the extension in `folder` (autofiller_extension/), from its manifest.json. */
export function manifestId(folder) {
  return extensionId(JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")).key);
}

// Run as a script (no import.meta here: the tests' loader imports this file too).
if (/extension-id\.mjs$/.test(process.argv[1] ?? "")) {
  const extension = resolve(dirname(resolve(process.argv[1])), "..");
  const WEBSITE = join(extension, "..", "frontend", "src", "lib", "autofill-extension.ts");
  const id = manifestId(extension);
  if (process.argv.includes("--write")) {
    const source = readFileSync(WEBSITE, "utf8");
    const pattern = /const EXTENSION_ID = "[a-p]{32}";/;
    if (!pattern.test(source)) throw new Error(`${WEBSITE} has no EXTENSION_ID line to write`);
    writeFileSync(WEBSITE, source.replace(pattern, `const EXTENSION_ID = "${id}";`));
  }
  console.log(id);
}
