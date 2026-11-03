import assert from "node:assert/strict";
import { test } from "node:test";

import { phoneText } from "./profile-links.ts";

test("a U.S. number prints with its country code and dashes", () => {
  assert.equal(phoneText("16467368801"), "+1 646-736-8801");
  assert.equal(phoneText("6467368801"), "+1 646-736-8801");
  assert.equal(phoneText("(646) 736-8801"), "+1 646-736-8801");
  assert.equal(phoneText("+1 646.736.8801"), "+1 646-736-8801");
});

test("any other number prints as typed", () => {
  assert.equal(phoneText("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(phoneText("646-736-8801 ext 2"), "646-736-8801 ext 2");
  assert.equal(phoneText("736-8801"), "736-8801");
});
