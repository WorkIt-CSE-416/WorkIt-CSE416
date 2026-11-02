import assert from "node:assert/strict";
import { test } from "node:test";

import { healthQuery, percent } from "./fill-health.ts";

test("the fill-health query keeps a day count from 1 to 90 and a plain engine version", () => {
  assert.equal(
    healthQuery({ days: "7", engine_version: "v0.3.2-105-gfcaaf20" }),
    "?days=7&engine_version=v0.3.2-105-gfcaaf20",
  );
  assert.equal(healthQuery({}), "?days=14");
  assert.equal(healthQuery({ days: "400", engine_version: "a b&c" }), "?days=14");
  assert.equal(healthQuery({ days: ["1", "2"] }), "?days=1");
});

test("a share reads as a whole percent", () => {
  assert.equal(percent(2 / 3), "67%");
  assert.equal(percent(0), "0%");
  assert.equal(percent(1), "100%");
});
