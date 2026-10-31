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
