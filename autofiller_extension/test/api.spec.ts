// The API's error answers as the overlay shows them (background/api.js).
import { expect, test } from "@playwright/test";
import { errorMessage } from "../src/background/api.js";

test("a validation error shows its message, not [object Object]", () => {
  // FastAPI's 422 for a body it refuses: a list of errors (Workable's cover letter, live, 2026-10-24).
  const body = { detail: [{ type: "less_than_equal", loc: ["body", "max_length"], msg: "Input should be less than or equal to 5000" }] };

  expect(errorMessage(422, body)).toBe("Input should be less than or equal to 5000");
});

test("a route's own error shows as it says it, and one with no words is a plain sentence, never its status", () => {
  expect(errorMessage(422, { detail: "Couldn't draft an answer." })).toBe("Couldn't draft an answer.");
  expect(errorMessage(404, {})).toBe("WorkIt's server couldn't do that just now.");
});

test("an API that is down says so in one plain sentence (KAN-466)", () => {
  // Cloudflare's 502 or a crash's 500 has no JSON body, so no words of the route's.
  expect(errorMessage(502, {})).toBe("WorkIt didn't answer. Try again in a minute.");
  expect(errorMessage(500, {})).toBe("WorkIt didn't answer. Try again in a minute.");
});
