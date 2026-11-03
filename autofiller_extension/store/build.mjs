#!/usr/bin/env node
// The Chrome Web Store package (KAN-463): the checked-in dev extension, minus everything that is only for
// development. `node autofiller_extension/store/build.mjs [outDir]` writes <outDir>/extension/ (the
// package, unpacked) and <outDir>/workit-extension.zip, and fails if any packaged file still names
// localhost, a Vercel host or "Prototype". outDir defaults to autofiller_extension/.store-build/.
//
// - manifest.json: store.json's name, version, description and toolbar title; no localhost or Vercel
//   host in host_permissions or externally_connectable; no `key` (the Store signs with its own, and
//   the dev `key` is the Store item's public key, so both have one ID: CLAUDE.md, "Extension ID").
// - src/shared/config.js: DEV_API_URL and DEV_WEB_URL null (never probe or call localhost), the
//   Vercel site gone (KAN-296), TEST_HOOKS false (no hooks on the service worker's global).
//
// The dev manifest and config stay as they are, for the tests. KAN-447's publish workflow uploads
// this zip rather than packaging the folder itself. Needs `zip` (macOS and ubuntu-latest have it).
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** What Chrome loads: never test/, store/, the docs, or the engine's source. */
const PARTS = ["manifest.json", "icons", "fonts", "src", "fill-engine/dist"];
const DEV_ONLY = /localhost|vercel\.app/;
/** What no packaged file may contain. "Prototype" as a word: the engine's Object.getPrototypeOf is fine. */
export const FORBIDDEN = /localhost|vercel\.app|\bPrototype\b/;

/** The Store manifest from the dev one. */
export function storeManifest(dev, store) {
  const manifest = structuredClone(dev);
  delete manifest.key;
  manifest.name = store.name;
  manifest.version = store.version;
  manifest.description = store.description;
  manifest.action.default_title = store.default_title;
  manifest.host_permissions = manifest.host_permissions.filter((host) => !DEV_ONLY.test(host));
  manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter((host) => !DEV_ONLY.test(host));
  return manifest;
}

/** The Store config.js from the dev one; throws if a line it rewrites has changed shape. */
export function storeConfig(dev) {
  let config = dev;
  const swap = (pattern, to) => {
    if (!pattern.test(config)) throw new Error(`config.js no longer matches ${pattern}: update store/build.mjs`);
    config = config.replace(pattern, to);
  };
  swap(/^export const DEV_API_URL = .*;$/m, "export const DEV_API_URL = null;");
  swap(/^export const DEV_WEB_URL = .*;$/m, "export const DEV_WEB_URL = null;");
  swap(/^export const TEST_HOOKS = .*;$/m, "export const TEST_HOOKS = false;");
  swap(/^.*vercel\.app.*\n/m, "");
  return config;
}

/** Every file under `dir`, relative to it. */
function walk(dir, root = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path)];
  });
}

export function build(out = join(EXTENSION, ".store-build")) {
  const dir = join(out, "extension");
  const zip = join(out, "workit-extension.zip");
  rmSync(dir, { recursive: true, force: true });
  rmSync(zip, { force: true });
  mkdirSync(dir, { recursive: true });
  for (const part of PARTS) cpSync(join(EXTENSION, part), join(dir, part), { recursive: true });

  const store = JSON.parse(readFileSync(join(EXTENSION, "store", "store.json"), "utf8"));
  const manifest = storeManifest(JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8")), store);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const config = join(dir, "src", "shared", "config.js");
  writeFileSync(config, storeConfig(readFileSync(config, "utf8")));

  const found = walk(dir)
    .filter((file) => !/\.(png|woff2?)$/.test(file))
    .filter((file) => FORBIDDEN.test(readFileSync(join(dir, file), "utf8")));
  if (found.length) throw new Error(`The Store package still names localhost, vercel.app or Prototype in: ${found.join(", ")}`);

  execFileSync("zip", ["-qrX", zip, "."], { cwd: dir });
  return { dir, zip };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { zip } = build(process.argv[2] ? resolve(process.argv[2]) : undefined);
    console.log(zip);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
