// KAN-468: the live canary (canary/run.mjs) reads a live form and compares it with the saved ones.
import { expect, test } from "@playwright/test";
import { kindDiff } from "./canary/canary.mjs";

const q = (name: string, kind: string) => ({ name, label: name, kind, required: false, options: [] });

test("a live form with every field the saved forms share, of the same kind, shows no difference", () => {
  const saved = [[q("email", "text"), q("resume", "file"), q("why_us", "textarea")], [q("email", "text"), q("resume", "file")]];
  expect(kindDiff(saved, [q("resume", "file"), q("email", "text"), q("cover_letter", "textarea")])).toEqual([]);
});

test("names a shared field the live form lacks, or reads as another kind", () => {
  const saved = [[q("email", "text"), q("resume", "file"), q("phone", "text")], [q("email", "text"), q("resume", "file"), q("phone", "text")]];
  expect(kindDiff(saved, [q("email", "text"), q("resume", "text")])).toEqual([
    "resume: read as text, saved as file",
    "phone: missing (saved as text)",
  ]);
});

test("names a kind the saved forms never had", () => {
  expect(kindDiff([[q("email", "text")]], [q("email", "text"), q("when", "date")])).toEqual(["when: kind date, which no saved form has"]);
});

test("a form read with no fields says so", () => {
  expect(kindDiff([[q("email", "text")]], [])).toEqual(["no fields read"]);
});
