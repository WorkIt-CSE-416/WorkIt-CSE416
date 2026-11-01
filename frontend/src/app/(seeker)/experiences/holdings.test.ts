import assert from "node:assert/strict";
import { test } from "node:test";

import type { BankEntry, BankResume } from "@/lib/bank-actions";

import {
  ALL,
  openingPick,
  otherVersions,
  rowMatches,
  rowsOf,
  skillMatches,
  skillRows,
} from "./holdings.ts";

const resume = (id: string, primary = false) =>
  ({ id, name: `Resume ${id}`, kind: "uploaded", primary }) as BankResume;

function entry(id: string, fields: Partial<BankEntry> = {}): BankEntry {
  return {
    id,
    title: "Engineer",
    organization: "Acme",
    location: null,
    degree: null,
    field_of_study: null,
    honors: null,
    coursework: [],
    bullets: [],
    resume_ids: [],
    copy_group: id,
    ...fields,
  } as BankEntry;
}

test("the page opens on All Experiences unless the URL names a resume it holds", () => {
  const resumes = [resume("a", true)];
  assert.equal(openingPick(resumes, undefined), ALL);
  assert.equal(openingPick(resumes, "gone"), ALL);
  assert.equal(openingPick(resumes, "a"), "a");
  assert.equal(openingPick(resumes, "none"), ALL);
});

test("All Experiences shows copies once, the primary resume's first", () => {
  const entries = [
    entry("1", { copy_group: "job", resume_ids: ["a"] }),
    entry("2", { copy_group: "job", resume_ids: ["b"] }),
    entry("3"),
  ];
  const rows = rowsOf(ALL, entries, [resume("a"), resume("b", true)]);
  assert.deepEqual(
    rows.map((r) => [r.entry.id, r.copies.map((c) => c.id)]),
    [
      ["2", ["1"]],
      ["3", []],
    ],
  );
});

test("a copy no resume holds, with other bullets, stays a row of its own", () => {
  const entries = [
    entry("1", { copy_group: "job", resume_ids: ["a"] }),
    entry("2", {
      copy_group: "job",
      bullets: [{ id: "x", text: "Led it" }] as BankEntry["bullets"],
    }),
    entry("3", { copy_group: "job" }),
  ];
  assert.deepEqual(
    rowsOf(ALL, entries, [resume("a", true)]).map((r) => [r.entry.id, r.copies.map((c) => c.id)]),
    [
      ["1", ["3"]],
      ["2", []],
    ],
  );
});

test("a resume's view keeps every copy as its own row", () => {
  const entries = [entry("1", { copy_group: "job" }), entry("2", { copy_group: "job" })];
  assert.equal(rowsOf("a", entries, []).length, 2);
});

test("the row is the copy `prefer` asks for, over the primary resume's", () => {
  const entries = [
    entry("1", { copy_group: "job", resume_ids: ["a"] }),
    entry("2", { copy_group: "job" }),
  ];
  const rows = rowsOf(ALL, entries, [resume("a", true)], (e) => e.id === "2");
  assert.equal(rows[0].entry.id, "2");
});

test("All Experiences lists a skill name once", () => {
  const skills = [{ name: "Figma" }, { name: " figma " }, { name: "React" }];
  assert.deepEqual(
    skillRows(ALL, skills).map((s) => s.name),
    ["Figma", "React"],
  );
  assert.equal(skillRows("a", skills).length, 3);
});

test("only a copy with other bullets is named", () => {
  const same = entry("2", { bullets: [{ id: "x", text: "Built it" }] as BankEntry["bullets"] });
  const other = entry("3", {
    bullets: [{ id: "y", text: "Led it" }] as BankEntry["bullets"],
    resume_ids: ["b"],
  });
  const row = {
    entry: entry("1", { bullets: [{ id: "z", text: "Built it " }] as BankEntry["bullets"] }),
    copies: [same, other],
  };
  assert.deepEqual(otherVersions(row, [resume("b")]), [
    { id: "b", name: "Resume b", entryId: "3" },
  ]);
});

test("a search matches every word, in any order and case, bullets and copies included", () => {
  const row = {
    entry: entry("1", { title: "Product Designer" }),
    copies: [
      entry("2", { bullets: [{ id: "x", text: "Shipped React apps" }] as BankEntry["bullets"] }),
    ],
  };
  assert.equal(rowMatches(row, "react DESIGNER"), true);
  assert.equal(rowMatches(row, "   "), true);
  assert.equal(rowMatches(row, "python"), false);
});

test("a skill matches by its name or its group", () => {
  const figma = { name: "Figma", group: "Design" };
  assert.equal(skillMatches(figma, "fig"), true);
  assert.equal(skillMatches(figma, "design"), true);
  assert.equal(skillMatches(figma, "react"), false);
});
