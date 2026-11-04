import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import { swapsOf, type Swap } from "./model.ts";

const bank = {
  entries: [
    {
      id: "e1",
      section: "experience",
      bullets: ["b1", "b2", "b3", "b4"].map((id, position) => ({ id, text: id, position })),
    },
  ],
  skills: [],
  resumes: [],
} as unknown as Bank;

const choices = {
  entries: [{ entry_id: "e1", shown: true, position: 0 }],
  bullets: ["b1", "b2", "b3", "b4"].map((bullet_id, position) => ({
    bullet_id,
    shown: true,
    position,
  })),
  skills: [],
  variants: [],
} as unknown as Choices;

const reorder = (order: string[]) => ({
  bullets: order.map((bullet_id, position) => ({ bullet_id, position })),
});

/** The order the swaps leave, applied one after another. */
const play = (start: string[], swaps: Swap[]) => {
  const now = [...start];
  for (const { a, b } of swaps) {
    const i = now.indexOf(a);
    assert.equal(now[i + 1], b, `${a} sits right above ${b}`);
    [now[i], now[i + 1]] = [b, a];
  }
  return now;
};

test("a move of two neighbours is one swap", () => {
  assert.deepEqual(swapsOf(bank, choices, reorder(["b2", "b1", "b3", "b4"])), [
    { kind: "bullet", a: "b1", b: "b2" },
  ]);
});

test("any reorder is neighbour swaps that reach the new order", () => {
  for (const order of [
    ["b4", "b3", "b2", "b1"],
    ["b3", "b1", "b4", "b2"],
    ["b2", "b3", "b4", "b1"],
  ]) {
    assert.deepEqual(play(["b1", "b2", "b3", "b4"], swapsOf(bank, choices, reorder(order))), order);
  }
});

test("no move, or a change that is not a reorder, is no swap", () => {
  assert.deepEqual(swapsOf(bank, choices, reorder(["b1", "b2", "b3", "b4"])), []);
  assert.deepEqual(swapsOf(bank, choices, reorder(["b2", "b1"])), []);
  assert.deepEqual(swapsOf(bank, choices, { bullets: [{ bullet_id: "b1", shown: false }] }), []);
});
