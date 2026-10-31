import assert from "node:assert/strict";
import { test } from "node:test";

import { answerBody, REASONS } from "./answer.ts";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

test("the picked reason, the student's line and the version go to the API, nothing else", () => {
  assert.deepEqual(
    answerBody(form({ reason: "bad_fills", detail: " Workday stayed blank. ", version: "0.1.0" })),
    {
      reason: "bad_fills",
      detail: "Workday stayed blank.",
      version: "0.1.0",
    },
  );
  assert.deepEqual(answerBody(form({ reason: "other", detail: "  ", version: "" })), {
    reason: "other",
  });
});

test("no reason, or one the page doesn't offer, sends nothing", () => {
  assert.equal(answerBody(form({ detail: "hi" })), null);
  assert.equal(answerBody(form({ reason: "not_a_reason" })), null);
});

test("a version that isn't the extension's is dropped, and a long line cut to the API's limit", () => {
  const body = answerBody(form({ reason: "other", detail: "x".repeat(600), version: "<script>" }));
  assert.deepEqual(body, { reason: "other", detail: "x".repeat(500) });
});

test("the page offers six reasons, Something Else last", () => {
  assert.equal(REASONS.length, 6);
  assert.deepEqual(REASONS.at(-1), { value: "other", label: "Something Else" });
});
