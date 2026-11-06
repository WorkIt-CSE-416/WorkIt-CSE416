import assert from "node:assert/strict";
import { test } from "node:test";

import { KEEP_CHANGES, leavesFeed, onFeed, stagesNow, withChange } from "./feed-stages.ts";

test("saved and applied jobs leave the feed; auto apply's stay", () => {
  for (const stage of ["saved", "applied", "interviewing", "offer", "rejected"] as const) {
    assert.equal(leavesFeed(stage), true, stage);
  }
  for (const stage of ["queued", "needs_you", "skipped", null, undefined] as const) {
    assert.equal(leavesFeed(stage), false, String(stage));
  }
});

test("a change made after the list was drawn wins over its stage", () => {
  const now = stagesNow({ a: null, b: "saved" }, { a: { stage: "saved", at: 20 } }, 10);
  assert.deepEqual(now, { a: "saved", b: "saved" });
});

test("a change made before the list was drawn is already in it", () => {
  // Saved, then unsaved on the tracker: the fresh render says null.
  const now = stagesNow({ a: null }, { a: { stage: "saved", at: 5 } }, 10);
  assert.deepEqual(now, { a: null });
});

test("an undone save brings the job back", () => {
  const now = stagesNow({}, { a: { stage: null, at: 30 } }, 10);
  assert.deepEqual(onFeed([{ id: "a" }], now), [{ id: "a" }]);
});

test("the feed leaves out saved jobs but keeps the open one", () => {
  const jobs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const stages = { a: "saved", b: "queued", c: "applied" } as const;
  assert.deepEqual(onFeed(jobs, stages), [{ id: "b" }]);
  assert.deepEqual(onFeed(jobs, stages, "a"), [{ id: "a" }, { id: "b" }]);
});

test("the tab keeps the newest changes only", () => {
  let changes = null;
  for (let i = 0; i < KEEP_CHANGES + 5; i++) {
    changes = withChange(changes, `job${i}`, { stage: "saved", at: i });
  }
  const ids = Object.keys(changes!);
  assert.equal(ids.length, KEEP_CHANGES);
  assert.equal(ids.includes("job0"), false);
  assert.equal(ids.includes(`job${KEEP_CHANGES + 4}`), true);
});
