// The Chrome Web Store package (KAN-463, store/build.mjs): what the Store gets, read back out of the zip itself.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const EXTENSION = join(__dirname, "..");
let out: string;
let zip: string;

test.beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "workit-store-build-"));
  execFileSync("node", [join(EXTENSION, "store", "build.mjs"), out]);
  zip = join(out, "workit-extension.zip");
});
test.afterAll(() => rmSync(out, { recursive: true, force: true }));

const files = () => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
const read = (file: string) => execFileSync("unzip", ["-p", zip, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

test("no file in the zip names localhost, a Vercel host or the prototype", () => {
  for (const file of files().filter((f) => !f.endsWith("/") && !/\.(png|woff2?)$/.test(f))) {
    const text = read(file);
    expect(text, file).not.toContain("localhost");
    expect(text, file).not.toContain("vercel.app");
    // A word, so the engine's Object.getPrototypeOf is not one.
    expect(text, file).not.toMatch(/\bPrototype\b/);
  }
});

test("the zip holds what Chrome loads and nothing of the repo's own", () => {
  const list = files();
  for (const file of ["manifest.json", "src/background/background.js", "fill-engine/dist/engine.js", "icons/icon-128.png"]) expect(list).toContain(file);
  expect(list.filter((f) => /^(test|store)\/|CLAUDE\.md|README\.md|fill-engine\/(src|test)\//.test(f))).toEqual([]);
});

test("the Store manifest is WorkIt's, at its launch version, with no dev key", () => {
  const manifest = JSON.parse(read("manifest.json"));
  expect(manifest.name).toBe("WorkIt");
  expect(manifest.version).toBe(JSON.parse(readFileSync(join(EXTENSION, "store", "store.json"), "utf8")).version);
  expect(manifest.description.length).toBeLessThanOrEqual(132);
  // The Store signs the item with its own key; its ID is the one the dev manifest's key pins (manifest.json).
  expect(manifest.key).toBeUndefined();
  expect(manifest.host_permissions).toContain("https://api.workitjobs.ai/*");
  expect(manifest.externally_connectable.matches).toEqual(["https://workitjobs.ai/*"]);
});

test("the Store build's config has no dev servers and no test hooks", () => {
  const config = read("src/shared/config.js");
  expect(config).toMatch(/export const DEV_API_URL = null;/);
  expect(config).toMatch(/export const DEV_WEB_URL = null;/);
  expect(config).toMatch(/export const TEST_HOOKS = false;/);
});

test("the dev manifest is left as it is", () => {
  const manifest = JSON.parse(readFileSync(join(EXTENSION, "manifest.json"), "utf8"));
  expect(manifest.host_permissions).toContain("http://localhost:8000/*");
  expect(manifest.key).toBeTruthy();
});
