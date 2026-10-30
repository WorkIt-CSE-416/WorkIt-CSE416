import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import {
  HISTORY_STEPS,
  PDF_STEPS,
  hideAgain,
  push,
  reverseChoices,
  reverseLine,
  type Step,
} from "./history.ts";

const bank = {
  entries: [
    {
      id: "e1",
      bullets: [
        { id: "b1", text: "Cut load time by 30%", position: 0 },
        { id: "b2", text: "Wrote tests", position: 1 },
      ],
    },
  ],
  skills: [],
} as unknown as Bank;

const choices: Choices = {
  entries: [{ entry_id: "e1", shown: true, position: 0, show_gpa: true, show_coursework: true }],
  bullets: [
    { bullet_id: "b1", shown: true, position: 0, variant_id: null, text: null },
    { bullet_id: "b2", shown: true, position: 1, variant_id: "t1", text: "Wrote the tests" },
  ],
  skills: [{ skill_id: "s1", shown: true, position: 0 }],
  variants: [
    { id: "t1", bullet_id: "b2", text: "Wrote the tests", job_posting_id: "p1", local: false },
  ],
};

test("a move's reverse puts both positions back", () => {
  const move = {
    bullets: [
      { bullet_id: "b2", position: 0 },
      { bullet_id: "b1", position: 1 },
    ],
  };
  assert.deepEqual(reverseChoices(bank, choices, move), {
    bullets: [
      { bullet_id: "b2", position: 1 },
      { bullet_id: "b1", position: 0 },
    ],
  });
});

test("a hide's reverse shows, and an item with no row hides again", () => {
  assert.deepEqual(
    reverseChoices(bank, choices, {
      skills: [
        { skill_id: "s1", shown: false },
        { skill_id: "s9", shown: true },
      ],
    }),
    {
      skills: [
        { skill_id: "s1", shown: true },
        { skill_id: "s9", shown: false },
      ],
    },
  );
});

test("a wording switch's reverse goes back to Tailor's variant or the original", () => {
  assert.deepEqual(
    reverseChoices(bank, choices, { bullets: [{ bullet_id: "b2", variant_id: null }] }),
    { bullets: [{ bullet_id: "b2", variant_id: "t1" }] },
  );
  assert.deepEqual(
    reverseChoices(bank, choices, { bullets: [{ bullet_id: "b1", variant_id: "t1" }] }),
    { bullets: [{ bullet_id: "b1", text: "Cut load time by 30%" }] },
  );
});

test("a typed bullet's reverse types its old wording back", () => {
  assert.deepEqual(reverseLine(bank, choices, { item_id: "b1", kind: "bullet" }, "x", undefined), {
    line: { item_id: "b1", kind: "bullet", text: "Cut load time by 30%" },
  });
  // Tailor's wording comes back as a switch, so no local copy of it is made
  assert.deepEqual(reverseLine(bank, choices, { item_id: "b2", kind: "bullet" }, "x", undefined), {
    changes: { bullets: [{ bullet_id: "b2", variant_id: "t1" }] },
  });
});

test("a header link's reverse is its stored URL, not its printed text", () => {
  const line = { item_id: "header", kind: "linkedin_url" };
  assert.deepEqual(
    reverseLine(bank, choices, line, "linkedin.com/in/sam", "https://www.linkedin.com/in/sam/"),
    { line: { ...line, text: "https://www.linkedin.com/in/sam/" } },
  );
  assert.deepEqual(reverseLine(bank, choices, line, undefined, null), {
    line: { ...line, text: "" },
  });
  const gpa = { item_id: "e1", kind: "gpa" };
  assert.deepEqual(reverseLine(bank, choices, gpa, "GPA: 3.8/4.0", undefined), {
    line: { ...gpa, text: "GPA: 3.8/4.0" },
  });
});

test("Fit's redo hides again what its undo shows", () => {
  assert.deepEqual(
    hideAgain({
      entries: [{ entry_id: "e1", show_coursework: true }],
      bullets: [{ bullet_id: "b1", shown: true }],
    }),
    {
      entries: [{ entry_id: "e1", show_coursework: false }],
      bullets: [{ bullet_id: "b1", shown: false }],
    },
  );
});

test("the stack keeps the newest steps, and PDFs only on the newest few", () => {
  const stack: Step<number, string>[] = [];
  for (let i = 0; i < HISTORY_STEPS + 5; i++) {
    push(stack, {
      undo: null,
      redo: { changes: {} },
      before: i,
      after: i + 1,
      pdfBefore: `pdf${i}`,
      pdfAfter: `pdf${i + 1}`,
    });
  }
  assert.equal(stack.length, HISTORY_STEPS);
  assert.equal(stack[0].before, 5);
  assert.equal(stack.filter((s) => s.pdfAfter).length, PDF_STEPS);
  assert.equal(stack.at(-1)!.pdfAfter, `pdf${HISTORY_STEPS + 5}`);
});
