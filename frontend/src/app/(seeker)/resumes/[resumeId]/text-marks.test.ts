import assert from "node:assert/strict";
import { test } from "node:test";

import { markedOf, runs, unmarked } from "./text-marks.ts";

const plain = (text: string) => ({ text, bold: false, italic: false });
const bold = (text: string) => ({ text, bold: true, italic: false });
const italic = (text: string) => ({ text, bold: false, italic: true });
const both = (text: string) => ({ text, bold: true, italic: true });

test("runs reads bold, italic, both and one inside the other", () => {
  assert.deepEqual(runs("a **b** *c* ***d***"), [
    plain("a "),
    bold("b"),
    plain(" "),
    italic("c"),
    plain(" "),
    both("d"),
  ]);
  assert.equal(unmarked("**a *b* c**"), "a b c");
});

test("stars that mark nothing stay in the words", () => {
  assert.equal(unmarked("5 * 3 and a lone * here"), "5 * 3 and a lone * here");
});

test("a field's pieces come back as a marked wording", () => {
  assert.equal(markedOf([plain("Built a "), bold("REST"), plain(" API")]), "Built a **REST** API");
  assert.equal(markedOf([plain("Built "), both("APIs")]), "Built ***APIs***");
  assert.equal(markedOf([plain("no marks at all")]), "no marks at all");
  assert.equal(markedOf([]), "");
});

test("pieces of one look join, as the browser splits them", () => {
  assert.equal(markedOf([bold("Bu"), bold("ilt"), plain(" it")]), "**Built** it");
});

test("spaces stay outside the markers", () => {
  assert.equal(markedOf([plain("one"), bold(" two "), plain("three")]), "one **two** three");
  assert.equal(markedOf([bold("   ")]), "   ");
});

test("every marked wording reads back the same", () => {
  for (const text of ["**a** *b* ***c***", "**a*****b***", "*a***b**", "**a** b", "plain"]) {
    assert.equal(markedOf(runs(text)), text);
  }
});
