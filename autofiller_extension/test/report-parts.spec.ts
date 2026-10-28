// What takes the student's values out of a fill report (shared/report-parts.js,
// KAN-369 fix reports), run in Node: the redactor, a reason's quotes, an
// answer's shape, and finalize, which the preview and Send share.
import { expect, test } from "@playwright/test";
import "../src/shared/report-parts.js";
import { STUDENT } from "./extension";

const { redactor, quoted, shapeOf, finalize } = (globalThis as any).WIA.reportParts;

test("the redactor takes out the profile's values, whole words only, and anything like an email, a phone or a file name", () => {
  const redact = redactor([STUDENT.full_name, STUDENT.email, STUDENT.phone_number, STUDENT.linkedin_url]);
  expect(redact("Test Person · test.person@example.com · +1 555 010 0199")).toBe("«redacted» · «email» · «redacted»");
  expect(redact("Hi Person, your Testing team")).toBe("Hi «redacted», your Testing team");
  expect(redact("linkedin.com/in/test-person and 5550100199")).toBe("«redacted» and «redacted»");
  expect(redact("Call (631) 555-0123 or mail pat@school.edu; attached Pat_Lee_Resume.pdf")).toBe("Call «phone» or mail «email»; attached «file»");
  expect(redactor([])("First Name")).toBe("First Name");
});

test("a reason's planned answer, shown value and quotes come out", () => {
  const redact = redactor([STUDENT.full_name]);
  expect(quoted("meant 'Test', page shows 'Pat'", { planned: "Test", shows: "Pat", redact })).toBe("meant '«planned»', page shows '«shown»'");
  expect(quoted('Expected “Quinn” to be picked', { redact })).toBe("Expected “«redacted»” to be picked");
  expect(quoted("Arc's form didn't take Test Person", { planned: "Test Person", redact })).toBe("Arc's form didn't take «planned»");
});

test("an answer's shape says its kind and size, never the answer", () => {
  expect(shapeOf("Test", "text")).toBe("text:4");
  expect(shapeOf("Yes", "select")).toBe("option");
  expect(shapeOf(["A", "B"], "multi_select")).toBe("options:2");
  expect(shapeOf({ file: "resume.pdf", type: "application/pdf", base64: "" }, "file")).toBe("file");
  expect(shapeOf("", "text")).toBe("none");
});

test("finalize marks the fields the student picked and keeps their note, trimmed and cut", () => {
  const report = { job_system: "greenhouse", fields: [{ name: "first_name" }, { name: "email" }] };
  expect(finalize(report, { marked: ["email"], note: "  wrong box  " })).toEqual({
    job_system: "greenhouse", fields: [{ name: "first_name" }, { name: "email", marked: true }], note: "wrong box",
  });
  expect(finalize(report, { note: "x".repeat(1200) }).note).toHaveLength(1000);
  expect(finalize(report).note).toBeNull();
});
