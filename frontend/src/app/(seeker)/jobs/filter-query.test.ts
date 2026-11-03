import assert from "node:assert/strict";
import { test } from "node:test";

import { facetsOn, NO_FILTERS } from "./filter-query.ts";

test("no picks count none", () => {
  assert.equal(facetsOn(NO_FILTERS), 0);
});

test("a facet counts once, whatever it holds", () => {
  assert.equal(facetsOn({ ...NO_FILTERS, places: ["US-CA", "US-NY"], roles: ["designer"] }), 2);
});

test("salary is one facet, either end of it", () => {
  assert.equal(facetsOn({ ...NO_FILTERS, minPay: 30 }), 1);
  assert.equal(facetsOn({ ...NO_FILTERS, minPay: 30, maxPay: 50 }), 1);
});

test("the panel's own facets count too", () => {
  assert.equal(
    facetsOn({
      ...NO_FILTERS,
      postedWithin: 7,
      startTerms: ["summer-2027"],
      visa: "sponsors",
      autoApply: true,
    }),
    4,
  );
});
