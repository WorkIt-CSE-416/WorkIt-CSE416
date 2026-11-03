import assert from "node:assert/strict";
import { test } from "node:test";

import { clickIsNotRows } from "./row-click.ts";

/** A node in a tiny tree: `closest` matches by tag or role, as the real one does. */
type FakeNode = {
  tag: string;
  role?: string;
  parent: FakeNode | null;
  closest(selectors: string): FakeNode | null;
};

function node(tag: string, parent: FakeNode | null = null, role?: string): FakeNode {
  const self: FakeNode = {
    tag,
    role,
    parent,
    closest(selectors) {
      const wanted = selectors.split(",").map((part) => part.trim());
      for (let at: FakeNode | null = self; at; at = at.parent) {
        if (wanted.includes(at.tag)) return at;
        if (at.role && wanted.includes(`[role="${at.role}"]`)) return at;
      }
      return null;
    },
  };
  return self;
}

function rowOf(row: FakeNode) {
  return {
    contains(target: never) {
      for (let at: FakeNode | null = target as FakeNode; at; at = at.parent) {
        if (at === row) return true;
      }
      return false;
    },
  };
}

const row = node("tr");
const cell = node("td", row);

test("a click on the row's own text opens the row", () => {
  assert.equal(clickIsNotRows(rowOf(row), node("span", cell)), false);
});

test("a click on a link or a button in the row is left to it", () => {
  assert.equal(clickIsNotRows(rowOf(row), node("svg", node("a", cell))), true);
  assert.equal(clickIsNotRows(rowOf(row), node("span", node("button", cell))), true);
});

test("a click on a ⋯ menu item drawn in a portal never opens the row", () => {
  // The menu's portal hangs off the body, not the row: React still bubbles its clicks to the row.
  const portal = node("div", node("body"));
  const item = node("div", portal, "menuitem");
  assert.equal(clickIsNotRows(rowOf(row), node("span", item)), true);
});

test("a click from a portal outside the row is not the row's, menu item or not", () => {
  const dialog = node("div", node("body"), "dialog");
  assert.equal(clickIsNotRows(rowOf(row), node("p", dialog)), true);
});

test("a menu item inside the row is left to it too", () => {
  assert.equal(clickIsNotRows(rowOf(row), node("div", cell, "menuitem")), true);
});

test("a click with no target is not the row's", () => {
  assert.equal(clickIsNotRows(rowOf(row), null), true);
});
