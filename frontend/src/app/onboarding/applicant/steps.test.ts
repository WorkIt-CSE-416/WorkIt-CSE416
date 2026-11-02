import assert from "node:assert/strict";
import { test } from "node:test";

import { EXTENSION_STEP_PATH, startStep } from "./steps.ts";

test("?step=extension, the extension's install tab (KAN-471), opens a finished seeker on the extension step", () => {
  assert.equal(EXTENSION_STEP_PATH, "/onboarding/applicant?step=extension");
  assert.equal(startStep("extension", true), 4);
});

test("a seeker with no saved answers starts at the first step, whatever the link asks", () => {
  assert.equal(startStep("extension", false), 0);
  assert.equal(startStep("2", false), 0);
  assert.equal(startStep(undefined, false), 0);
});

test("?step=2 still opens Profile, and anything else the first step", () => {
  assert.equal(startStep("2", true), 2);
  assert.equal(startStep(undefined, true), 0);
  assert.equal(startStep(["extension"], true), 0);
  assert.equal(startStep("practice", true), 0);
});

test("a seeker who finished onboarding opens on the extension step from the install tab, even with no saved answers", () => {
  // Loading the extension opens ?step=extension. A finished seeker must not be
  // sent back to Role to fill everything in again (2026-11-01). The extension
  // and practice steps save nothing, so they need no saved answers.
  assert.equal(startStep("extension", false, true), 4);
  // Profile's Next saves step 1's answers as preferences: never without them.
  assert.equal(startStep("2", false, true), 0);
  assert.equal(startStep(undefined, false, true), 0);
});
