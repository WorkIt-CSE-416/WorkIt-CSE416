import assert from "node:assert/strict";
import { test } from "node:test";

import type { BankEntry } from "@/lib/bank-actions";

import { changesOf, draftOf } from "./sections.ts";

// The fields the entry PATCH declares (backend/app/schemas/bank.py,
// EntryUpdate). It forbids any other key: one more and the whole edit is a
// 422, "Extra inputs are not permitted" (KAN-505).
const PATCH_FIELDS = [
  "title",
  "organization",
  "location",
  "start_month",
  "end_month",
  "end_kind",
  "degree",
  "field_of_study",
  "gpa",
  "gpa_scale",
  "coursework",
  "honors",
  "link",
  "issuer",
  "award_date",
];

// An entry as GET /bank sends it: its fields, plus the id, bullets,
// `resume_ids` and `copy_group` that only the page reads.
const saved: BankEntry = {
  id: "e1",
  section: "experience",
  title: "Software Engineer Intern",
  organization: "Initech",
  location: "Austin, TX",
  start_month: "2025-06",
  end_month: "2025-08",
  end_kind: "month",
  degree: null,
  field_of_study: null,
  gpa: null,
  gpa_scale: null,
  coursework: [],
  honors: null,
  link: null,
  issuer: null,
  award_date: null,
  bullets: [{ id: "b1", position: 0, text: "Built the billing service" }],
  resume_ids: ["r1"],
  copy_group: "experience|software engineer intern|initech|2025-06-01|2025-08-01",
};

test("an edit's PATCH body holds only the fields the PATCH declares", () => {
  assert.deepEqual(Object.keys(changesOf(draftOf(saved))).sort(), [...PATCH_FIELDS].sort());
});

test("a draft that still holds the page's keys saves only the PATCH's fields", () => {
  // Intake keeps its card in localStorage, so a card kept before KAN-505
  // still holds them.
  const kept = { ...saved, bullets: [{ id: "b1", text: "Built the billing service" }] };
  assert.deepEqual(Object.keys(changesOf(kept)).sort(), [...PATCH_FIELDS].sort());
});

test("a draft keeps the entry's fields and bullets, and nothing the page reads", () => {
  const draft = draftOf(saved);
  assert.equal(draft.section, "experience");
  assert.equal(draft.title, "Software Engineer Intern");
  assert.equal(draft.start_month, "2025-06");
  assert.deepEqual(draft.bullets, [{ id: "b1", text: "Built the billing service" }]);
  for (const key of ["id", "resume_ids", "copy_group"]) assert.equal(key in draft, false, key);
});
