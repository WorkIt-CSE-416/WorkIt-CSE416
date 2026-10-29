import assert from "node:assert/strict";
import { test } from "node:test";

import { schoolYear } from "./school-year.ts";

const school = (end_month: string | null) => ({ section: "education", end_month });
const job = { section: "experience", end_month: "2030-05" };
const today = new Date(2026, 9, 26);

test("class year counts the school years left to graduation", () => {
  assert.equal(schoolYear([school("2027-05")], today, {}).classYear, "Senior");
  assert.equal(schoolYear([school("2028-05")], today, {}).classYear, "Junior");
  assert.equal(schoolYear([school("2028-12")], today, {}).classYear, "Junior");
  assert.equal(schoolYear([school("2030-05")], today, {}).classYear, "Freshman");
  assert.equal(schoolYear([school("2026-05")], today, {}).classYear, "Graduate");
});

test("the latest education entry decides, and other sections are ignored", () => {
  const year = schoolYear([school("2024-05"), job, school("2028-05")], today, {});
  assert.equal(year.graduation, "2028-05");
  assert.equal(schoolYear([job], today, {}).graduation, null);
});

test("returns to school when graduation is after the latest end date", () => {
  assert.equal(
    schoolYear([school("2028-05")], today, { latest_end: "2027-08-15" }).returnsToSchool,
    true,
  );
  assert.equal(
    schoolYear([school("2027-05")], today, { latest_end: "2027-08-15" }).returnsToSchool,
    false,
  );
});

test("without an end date the latest term's end decides", () => {
  const terms = { available_terms: ["summer 2027", "fall 2027"] };
  assert.equal(schoolYear([school("2028-05")], today, terms).returnsToSchool, true);
  assert.equal(schoolYear([school("2027-12")], today, terms).returnsToSchool, false);
  assert.equal(schoolYear([school("2028-05")], today, {}).returnsToSchool, null);
});
