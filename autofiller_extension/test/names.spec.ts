// The student's name as the fill gives it: WorkIt keeps it in parts (first,
// middle, last), so a middle name is never read as part of the last name.
// Dummy data only.
import { expect, test } from "@playwright/test";
import { engineProfile } from "../src/background/engine.js";
import { STUDENT } from "./extension";

test("a middle name stays out of the last name", () => {
  const student = { ...STUDENT, full_name: "Test Middle Person", first_name: "Test", middle_name: "Middle", last_name: "Person" };

  expect(engineProfile(student).identity).toMatchObject({ legal_first_name: "Test", legal_middle_name: "Middle", legal_last_name: "Person" });
});

test("a name with no parts saved is split from the full name", () => {
  expect(engineProfile(STUDENT).identity).toMatchObject({ legal_first_name: "Test", legal_last_name: "Person" });
});
