import assert from "node:assert/strict";
import { test } from "node:test";

import {
  changedAnswers,
  NO_ANSWERS,
  noneOfTheseApply,
  parseList,
  parsePay,
  toggleCommunity,
  screenerChoice,
  upcomingTerms,
} from "./autofill-answers.ts";

test("None of these apply answers only the unanswered screeners", () => {
  const answers = { ...NO_ANSWERS, referred_at: ["Acme Robotics"], non_compete: "yes" as const };
  assert.deepEqual(noneOfTheseApply(answers), {
    relatives_at: [],
    relative_public_official: "no",
    prior_government_work: "no",
    pending_offers: [],
  });
});

test("a screener list reads as yes, no or unanswered", () => {
  assert.equal(screenerChoice({ ...NO_ANSWERS }, "relatives_at"), null);
  assert.equal(screenerChoice({ ...NO_ANSWERS, relatives_at: [] }, "relatives_at"), "no");
  assert.equal(screenerChoice({ ...NO_ANSWERS, relatives_at: ["Globex"] }, "relatives_at"), "yes");
  assert.equal(screenerChoice({ ...NO_ANSWERS, non_compete: "no" }, "non_compete"), "no");
});

test("changed answers compare lists by value", () => {
  const base = { ...NO_ANSWERS, languages: ["English"], onsite_ok: "yes" as const };
  const draft = { ...base, languages: ["English"], onsite_ok: null };
  assert.deepEqual(changedAnswers(draft, base), { onsite_ok: null });
});

test("a typed list splits on commas and drops blanks and repeats", () => {
  assert.deepEqual(parseList(" Acme, , Globex,acme "), ["Acme", "Globex"]);
});

test("upcoming terms start at the next term", () => {
  assert.deepEqual(upcomingTerms(new Date(2026, 9, 26), 3), [
    "winter 2027",
    "spring 2027",
    "summer 2027",
  ]);
});

test("a community picked clears a decline, and a decline clears the rest", () => {
  assert.deepEqual(toggleCommunity(null, "parent"), ["parent"]);
  assert.deepEqual(toggleCommunity(["declined"], "parent"), ["parent"]);
  assert.deepEqual(toggleCommunity(["parent", "veteran"], "declined"), ["declined"]);
  // Unpicking the last one leaves the question unanswered, not "none of these".
  assert.equal(toggleCommunity(["parent"], "parent"), null);
});

test("pay is a positive figure under $1,000 an hour, typed with or without a dollar sign", () => {
  assert.equal(parsePay("32.50"), 32.5);
  assert.equal(parsePay(" $45 "), 45);
  assert.equal(parsePay(""), null);
  assert.equal(parsePay("lots"), undefined);
  assert.equal(parsePay("85000"), undefined);
  assert.equal(parsePay("0"), undefined);
});
