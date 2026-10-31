import assert from "node:assert/strict";
import { test } from "node:test";

import { ROTATE_WITHIN_S, needsRotation } from "./session-refresh.ts";

const now = Date.UTC(2026, 9, 31, 12, 0, 0);
const at = (secondsFromNow: number) => now / 1000 + secondsFromNow;

test("a token with most of its hour left is kept", () => {
  assert.equal(needsRotation(at(50 * 60), now), false);
});

test("a token inside the extension's two minutes is rotated, with room for clock skew", () => {
  assert.equal(ROTATE_WITHIN_S, 180);
  assert.equal(needsRotation(at(119), now), true);
  assert.equal(needsRotation(at(170), now), true);
  assert.equal(needsRotation(at(181), now), false);
});

test("an expired token, or one with no expiry, is rotated", () => {
  assert.equal(needsRotation(at(-60), now), true);
  assert.equal(needsRotation(undefined, now), true);
});
