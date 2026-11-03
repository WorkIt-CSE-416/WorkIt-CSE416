import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApplicationEvent } from "../../tracker";

import { asksFirst, readdEvent, undoStage } from "./undo.ts";

test("a stage pick's Undo goes back to the stage before it", () => {
  assert.equal(undoStage("applied"), "applied");
  assert.equal(undoStage("interviewing"), "interviewing");
  assert.equal(undoStage("offer"), "offer");
  assert.equal(undoStage("rejected"), "rejected");
});

test("a saved job has no Undo, so its pick asks first", () => {
  assert.equal(undoStage("saved"), null);
  assert.equal(asksFirst("saved"), true);
  assert.equal(asksFirst("applied"), false);
  assert.equal(asksFirst("rejected"), false);
});

const event = (fields: Partial<ApplicationEvent>): ApplicationEvent => ({
  id: "e1",
  kind: "interview",
  title: "Technical Interview",
  at: "2026-11-10T15:00:00+00:00",
  source: "manual",
  emailKind: "interview",
  ...fields,
});

test("a timed event comes back at its time, with its end, link and note", () => {
  assert.deepEqual(
    readdEvent(
      event({
        endsAt: "2026-11-10T16:00:00+00:00",
        meetingUrl: "https://zoom.us/j/1",
        note: "Bring the portfolio",
      }),
    ),
    {
      kind: "interview",
      title: "Technical Interview",
      at: "2026-11-10T15:00:00+00:00",
      onDay: null,
      endsAt: "2026-11-10T16:00:00+00:00",
      note: "Bring the portfolio",
      meetingUrl: "https://zoom.us/j/1",
    },
  );
});

test("an event on a day comes back on that day, with no time", () => {
  const back = readdEvent(event({ kind: "assessment", emailKind: "assessment", at: "2026-11-12" }));
  assert.equal(back.kind, "assessment");
  assert.equal(back.at, null);
  assert.equal(back.onDay, "2026-11-12");
  assert.equal(back.endsAt, null);
  assert.equal(back.note, "");
  assert.equal(back.meetingUrl, "");
});

test("a follow-up keeps the API's own kind, never the tracker's folded one", () => {
  assert.equal(readdEvent(event({ kind: "follow-up", emailKind: "other" })).kind, "other");
  assert.equal(readdEvent(event({ kind: "follow-up", emailKind: "confirmation" })).kind, "other");
  assert.equal(readdEvent(event({ kind: "follow-up", emailKind: undefined })).kind, "other");
});
