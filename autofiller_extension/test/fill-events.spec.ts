// A fill event's shape (background/fill-events.js eventOf, KAN-476), off the
// page: each part forced to its shape before it goes to POST /fill-events.
import { expect, test } from "@playwright/test";

// eventOf names the extension's version from the manifest: outside Chrome, a stand-in.
(globalThis as any).chrome ??= { runtime: { getManifest: () => ({ version: "0.1.0" }) } };
const { eventOf } = require("../src/background/fill-events.js");

const URL = "https://job-boards.greenhouse.io/acme/jobs/1";
const COUNTS = { site: "greenhouse", fields: 4, filled: 3, guessed: 0, needs_you: 1, failed: 0, errors: {} };

test("a fill's time is kept as it took, up to an hour, not capped at ten seconds", () => {
  expect(eventOf(URL, { ...COUNTS, duration_ms: 95_000 }).duration_ms).toBe(95_000);
  expect(eventOf(URL, { ...COUNTS, duration_ms: 5 * 60 * 60 * 1000 }).duration_ms).toBe(60 * 60 * 1000);
  expect(eventOf(URL, { ...COUNTS, duration_ms: -3 }).duration_ms).toBe(1);
});
