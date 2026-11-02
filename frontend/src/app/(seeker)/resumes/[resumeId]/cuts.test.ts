import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import { NO_CUTS, addCuts, cutLeft, cutRows, cutSkills, isBack, pickerEntries } from "./model.ts";

const entry = (id: string, bullets: string[]) => ({
  id,
  copy_group: id,
  resume_ids: [],
  section: "experience",
  title: id,
  coursework: id === "edu" ? ["Algorithms"] : [],
  bullets: bullets.map((b, position) => ({ id: b, text: b, position })),
});

const bank = {
  entries: [entry("e1", ["b1", "b2", "b3"]), entry("e2", ["b4"]), entry("edu", [])],
  skills: [
    { id: "go", name: "Go", group: "Languages", resume_ids: [] },
    { id: "rust", name: "Rust", group: "Languages", resume_ids: [] },
  ],
  resumes: [],
} as unknown as Bank;

/** e1 on with b3 off, e2 off, edu on with its coursework off, Go off. */
const choices: Choices = {
  entries: [
    { entry_id: "e1", shown: true, position: 0, show_gpa: false, show_coursework: false },
    { entry_id: "e2", shown: false, position: 1, show_gpa: false, show_coursework: false },
    { entry_id: "edu", shown: true, position: 2, show_gpa: false, show_coursework: false },
  ],
  bullets: ["b1", "b2", "b3", "b4"].map((id, position) => ({
    bullet_id: id,
    shown: id !== "b3",
    position,
    variant_id: null,
    text: null,
  })),
  skills: [
    { skill_id: "go", shown: false, position: 0 },
    { skill_id: "rust", shown: true, position: 1 },
  ],
  variants: [],
};

const cuts = addCuts(NO_CUTS, {
  entries: [
    { entry_id: "e2", shown: true },
    { entry_id: "edu", show_coursework: true },
  ],
  bullets: [{ bullet_id: "b3", shown: true }],
  skills: [{ skill_id: "go", shown: true }],
});

test("a fit's undo body sorts into entries, bullets, coursework and skills", () => {
  assert.deepEqual(cuts, {
    entries: ["e2"],
    bullets: ["b3"],
    coursework: ["edu"],
    skills: ["go"],
  });
});

test("each skill Fit cut is listed, and Cut From Resume stays until it is back", () => {
  assert.deepEqual(
    cutSkills(bank, choices, cuts).map((s) => [s.skill.id, s.on]),
    [["go", false]],
  );
  // Everything else put back, the skill still off: something is left
  const allButSkill: Choices = {
    ...choices,
    entries: choices.entries.map((e) => ({ ...e, shown: true, show_coursework: true })),
    bullets: choices.bullets.map((b) => ({ ...b, shown: true })),
  };
  assert.equal(cutLeft(bank, allButSkill, cuts), true);
  const all: Choices = {
    ...allButSkill,
    skills: allButSkill.skills.map((s) => ({ ...s, shown: true })),
  };
  assert.equal(cutLeft(bank, all, cuts), false);
  // It stays listed once back, ticked
  assert.deepEqual(
    cutSkills(bank, all, cuts).map((s) => [s.skill.id, s.on]),
    [["go", true]],
  );
});

test("a second fit adds to the first, each id once", () => {
  const more = addCuts(cuts, {
    bullets: [
      { bullet_id: "b3", shown: true },
      { bullet_id: "b2", shown: true },
    ],
  });
  assert.deepEqual(more.bullets, ["b3", "b2"]);
});

test("each entry Fit cut from is a row with only its cut bullets", () => {
  const rows = cutRows(bank, choices, cuts);
  assert.deepEqual(
    rows.map((r) => [r.entry.id, r.cutIds, r.bullets.map((b) => b.id), r.coursework]),
    [
      ["e1", [], ["b3"], null],
      ["e2", ["e2"], [], null],
      ["edu", [], [], { entry_id: "edu", on: false }],
    ],
  );
  assert.equal(rows.some(isBack), false);
});

test("a row put back stays, ticked", () => {
  const back: Choices = {
    ...choices,
    entries: choices.entries.map((e) => ({ ...e, shown: true, show_coursework: true })),
    bullets: choices.bullets.map((b) => ({ ...b, shown: true })),
  };
  const rows = cutRows(bank, back, cuts);
  assert.equal(rows.length, 3);
  assert.equal(rows.every(isBack), true);
});

test("a bullet keeps its place in the picker when it is ticked off", () => {
  const order = (c: Choices) =>
    pickerEntries(bank, c)
      .find((r) => r.entry.id === "e1")!
      .bullets.map((b) => b.id);
  const allOn: Choices = {
    ...choices,
    bullets: choices.bullets.map((b) => ({ ...b, shown: true })),
  };
  const firstOff: Choices = {
    ...allOn,
    bullets: allOn.bullets.map((b) => (b.bullet_id === "b1" ? { ...b, shown: false } : b)),
  };
  assert.deepEqual(order(allOn), ["b1", "b2", "b3"]);
  assert.deepEqual(order(firstOff), ["b1", "b2", "b3"]);
});
