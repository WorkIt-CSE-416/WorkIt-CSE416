import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bank } from "@/lib/bank-actions";
import type { Choices } from "@/lib/built-resume-actions";

import { bulletPlaced } from "./add-bullet.ts";
import { reverseChoices } from "./history.ts";

const order = (update: ReturnType<typeof bulletPlaced>) => update.bullets?.map((b) => b.bullet_id);

test("a new bullet lands after the open one", () => {
  assert.deepEqual(order(bulletPlaced(["a", "b", "c"], "new", "b")), ["a", "b", "new", "c"]);
});

test("with no bullet open it goes last, or first in an empty entry", () => {
  assert.deepEqual(order(bulletPlaced(["a", "b"], "new", null)), ["a", "b", "new"]);
  assert.deepEqual(order(bulletPlaced([], "new", null)), ["new"]);
});

test("every shown sibling takes its new number", () => {
  const { bullets } = bulletPlaced(["a", "b"], "new", "a");
  assert.deepEqual(
    bullets?.map((b) => b.position),
    [0, 1, 2],
  );
});

test("a marked wording goes with the new bullet alone", () => {
  const { bullets } = bulletPlaced(["a"], "new", "a", "**Built** it");
  assert.deepEqual(bullets?.[1], {
    bullet_id: "new",
    position: 1,
    shown: true,
    text: "**Built** it",
  });
  assert.equal("text" in (bullets?.find((b) => b.bullet_id === "a") ?? {}), false);
});

test("Undo hides the new bullet and puts its siblings back, and Redo shows it", () => {
  const choices = {
    entries: [],
    skills: [],
    variants: [],
    bullets: [
      { bullet_id: "a", shown: true, position: 0, variant_id: null, text: null },
      { bullet_id: "b", shown: true, position: 1, variant_id: null, text: null },
    ],
  } as unknown as Choices;
  const change = bulletPlaced(["a", "b"], "new", "a");
  const undo = reverseChoices({ entries: [] } as unknown as Bank, choices, change);
  assert.deepEqual(undo.bullets, [
    { bullet_id: "a", position: 0 },
    { bullet_id: "new", shown: false },
    { bullet_id: "b", position: 1 },
  ]);
  assert.equal(change.bullets?.find((b) => b.bullet_id === "new")?.shown, true);
});
