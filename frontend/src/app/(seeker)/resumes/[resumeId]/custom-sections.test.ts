import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import { customKey, groupOf, groupsOf, move, printedOrder, printedSections } from "./model.ts";

/** Sections the student named (KAN-498), as the editor groups and orders
 *  them: the same rules as the API's view and `printed_order`. */

const ORDER = [
  "education",
  "experience",
  "projects",
  "leadership",
  "awards",
  "certifications",
  "skills",
];

const entry = (id: string, section: string, custom_section_id: string | null = null) => ({
  id,
  section,
  custom_section_id,
  title: id,
  organization: null,
  copy_group: id,
  resume_ids: [],
  bullets: [{ id: `${id}.b`, text: `${id} line`, position: 0 }],
});

const bank = {
  entries: [
    entry("job", "experience"),
    entry("tutor", "custom", "vol"),
    entry("coach", "custom", "vol"),
    entry("spanish", "custom", "lang-a"),
    entry("french", "custom", "lang-b"),
    entry("me", "custom", "sum"),
  ],
  skills: [],
  resumes: [],
  sections: [
    { id: "vol", name: "Volunteering", layout: "entries", resume_ids: [] },
    { id: "lang-a", name: "Languages", layout: "lines", resume_ids: [] },
    { id: "lang-b", name: " languages ", layout: "lines", resume_ids: [] },
    { id: "sum", name: "Professional Summary", layout: "lines", resume_ids: [] },
  ],
} as unknown as Bank;

const choices = {
  entries: bank.entries.map((e, position) => ({
    entry_id: e.id,
    shown: true,
    position,
    show_gpa: false,
    show_coursework: false,
  })),
  bullets: bank.entries.map((e, position) => ({
    bullet_id: `${e.id}.b`,
    shown: true,
    position,
    variant_id: null,
    text: null,
  })),
  skills: [],
  variants: [],
} as unknown as Choices;

test("a custom section's key ignores case and spacing, as the API's", () => {
  assert.equal(customKey("  Community   Service "), "custom:community service");
  assert.equal(groupOf(bank, bank.entries[3]), groupOf(bank, bank.entries[4]));
  assert.equal(groupOf(bank, bank.entries[0]), "experience");
});

test("the groups are the fixed sections, then each custom name once", () => {
  const custom = groupsOf(bank).filter((g) => g.custom);
  assert.deepEqual(
    custom.map((g) => [g.id, g.label, g.layout]),
    [
      ["custom:volunteering", "Volunteering", "entries"],
      ["custom:languages", "Languages", "lines"],
      ["custom:professional summary", "Professional Summary", "lines"],
    ],
  );
});

test("a summary prints first and any other custom section last, unless the order names it", () => {
  const custom = groupsOf(bank).filter((g) => g.custom);
  assert.deepEqual(printedOrder(ORDER, custom), [
    "custom:professional summary",
    ...ORDER,
    "custom:volunteering",
    "custom:languages",
  ]);
  const dragged = ["custom:languages", ...ORDER];
  assert.deepEqual(printedOrder(dragged, custom), [
    "custom:professional summary",
    ...dragged,
    "custom:volunteering",
  ]);
});

test("the Sections panel lists custom sections by name where they print", () => {
  const sections = printedSections(bank, choices, ORDER);
  assert.deepEqual(
    sections.map((s) => [s.label, s.entries.map((e) => e.id)]),
    [
      ["Professional Summary", ["me"]],
      ["Experience", ["job"]],
      ["Volunteering", ["tutor", "coach"]],
      ["Languages", ["spanish", "french"]],
    ],
  );
});

test("an entry moves within its own custom section only", () => {
  const coach = { kind: "entry" as const, entry: bank.entries[2], field: "title" };
  assert.deepEqual(move(bank, choices, coach, -1), {
    entries: [
      { entry_id: "coach", position: 0 },
      { entry_id: "tutor", position: 1 },
    ],
  });
  // First in its section: nothing above it, though another section's entry is
  const tutor = { kind: "entry" as const, entry: bank.entries[1], field: "title" };
  assert.equal(move(bank, choices, tutor, -1), null);
});
