import assert from "node:assert/strict";
import { test } from "node:test";

import type { BankEntry } from "@/lib/bank-actions";

import { changesOf, draftOf, emptyDraft, isFixed } from "./sections.ts";

const saved = {
  ...emptyDraft("custom", "sec-1"),
  id: "e1",
  title: "Tutor",
  bullets: [{ id: "b1", position: 0, text: "Taught math" }],
  resume_ids: ["r1"],
  copy_group: "custom|tutor||None|None",
} as BankEntry<"custom">;

test("an edit's PATCH holds only the fields the API takes", () => {
  // The API refuses any other key (EntryUpdate), so the holdings stay out,
  // and the section and its custom section are fixed once saved
  const changes = changesOf(draftOf(saved));
  for (const key of ["id", "bullets", "resume_ids", "copy_group", "section", "custom_section_id"]) {
    assert.ok(!(key in changes), key);
  }
  assert.equal(changes.title, "Tutor");
});

test("a new custom entry names its section; a fixed one names none", () => {
  assert.equal(emptyDraft("custom", "sec-1").custom_section_id, "sec-1");
  assert.equal(emptyDraft("projects").custom_section_id, null);
  assert.equal(isFixed(saved), false);
  assert.equal(isFixed({ ...saved, section: "projects" } as BankEntry), true);
});
