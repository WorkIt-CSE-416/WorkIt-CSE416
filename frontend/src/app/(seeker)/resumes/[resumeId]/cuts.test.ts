import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import { NO_CUTS, addCuts, cutRows, isBack } from "./model.ts";

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
  skills: [],
  resumes: [],
} as unknown as Bank;

/** e1 on with b3 off, e2 off, edu on with its coursework off. */
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
  skills: [],
  variants: [],
};

const cuts = addCuts(NO_CUTS, {
  entries: [
    { entry_id: "e2", shown: true },
    { entry_id: "edu", show_coursework: true },
  ],
  bullets: [{ bullet_id: "b3", shown: true }],
});

test("a fit's undo body sorts into entries, bullets and coursework", () => {
  assert.deepEqual(cuts, { entries: ["e2"], bullets: ["b3"], coursework: ["edu"] });
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
