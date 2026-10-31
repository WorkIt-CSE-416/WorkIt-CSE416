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

test("a stepped system's step and last-step mark go as they came; a bad one goes not at all", () => {
  expect(eventOf(URL, { ...COUNTS, step: 3, final_step: true })).toMatchObject({ step: 3, final_step: true });
  const bad = eventOf(URL, { ...COUNTS, step: "3", final_step: "yes" });
  expect(bad).not.toHaveProperty("step");
  expect(bad).not.toHaveProperty("final_step");
  // A single-page fill has neither.
  expect(eventOf(URL, COUNTS)).not.toHaveProperty("step");
});

test("a last step with no field (Workday's Review) still ends the fill; another empty step sends nothing", () => {
  const empty = { site: "workday", fields: 0, errors: {} };
  expect(eventOf(URL, { ...empty, step: 5, final_step: true })).toMatchObject({ job_system: "workday", fields: 0, final_step: true });
  expect(eventOf(URL, { ...empty, step: 4, final_step: false })).toBeNull();
});

test("onboarding's practice form, shaped as Lever's, is no fill of Lever's: it sends nothing", () => {
  const practice = "http://localhost:3000/practice/harbor/00000000-0000-0000-0000-00000000000a/apply";
  expect(eventOf(practice, { ...COUNTS, site: "lever" })).toBeNull();
});
