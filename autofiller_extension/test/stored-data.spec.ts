// What the extension keeps in chrome.storage.local, across versions
// (KAN-471): a schema version, the migrations an update runs, and the cap on
// the Workday dropdown lists (`workday_trees`). The loaded extension's
// install and update events are install.extension.spec.ts.
import { expect, test } from "@playwright/test";
import { MAX_WORKDAY_TREES, STORAGE_VERSION, STORAGE_VERSION_KEY, migrateStorage, treeStore } from "../src/background/stored-data.js";

/** chrome.storage.local's get and set, in memory. */
function fakeStorage(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(seed);
  return {
    data,
    async get(key: string) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, structuredClone(items));
    },
  };
}

const tree = (n: number) => ({ shown: [`Choice ${n}`], categories: {}, list: true });
const trees = (from: number, to: number) =>
  Object.fromEntries(Array.from({ length: to - from }, (_, i) => [`acme / list / Question ${from + i}`, tree(from + i)]));

test("an update from the unversioned shape caps the Workday lists, as pairs, and records the version", async () => {
  // Before KAN-471: no version, and every list ever read, as an object.
  const storage = fakeStorage({ workday_trees: trees(0, MAX_WORKDAY_TREES + 50), panel_sites: { "boards.greenhouse.io": { top: 40 } } });

  await migrateStorage(storage);

  expect(storage.data[STORAGE_VERSION_KEY]).toBe(STORAGE_VERSION);
  const kept = storage.data.workday_trees as [string, unknown][];
  expect(kept).toHaveLength(MAX_WORKDAY_TREES);
  expect(kept[0]).toEqual(["acme / list / Question 50", tree(50)]);
  expect(Object.keys(await treeStore(storage).load())).toHaveLength(MAX_WORKDAY_TREES);
  // Keys no migration names are left as they were.
  expect(storage.data.panel_sites).toEqual({ "boards.greenhouse.io": { top: 40 } });
});

test("a migration runs once: storage already at the version is not touched", async () => {
  const storage = fakeStorage({ [STORAGE_VERSION_KEY]: STORAGE_VERSION, workday_trees: Object.entries(trees(0, 3)) });
  storage.set = async () => {
    throw new Error("nothing should be written");
  };
  await migrateStorage(storage);
});

test("a fresh install has nothing to migrate and records the version", async () => {
  const storage = fakeStorage();
  await migrateStorage(storage);
  expect(storage.data).toEqual({ [STORAGE_VERSION_KEY]: STORAGE_VERSION });
});

test("saving Workday lists stays under the cap, dropping the longest unsaved first", async () => {
  const storage = fakeStorage({ workday_trees: Object.entries(trees(0, MAX_WORKDAY_TREES)) });
  const store = treeStore(storage);

  // Question 0 is read again on this fill, so it is the newest now; Question 1 is the oldest.
  await store.save({ "acme / list / Question 0": tree(0), ...trees(MAX_WORKDAY_TREES, MAX_WORKDAY_TREES + 2) });

  const kept = (storage.data.workday_trees as [string, unknown][]).map(([key]) => key);
  expect(kept).toHaveLength(MAX_WORKDAY_TREES);
  expect(kept).not.toContain("acme / list / Question 1");
  expect(kept).not.toContain("acme / list / Question 2");
  expect(kept.at(-3)).toBe("acme / list / Question 0");
  expect(Object.keys(await store.load())).toHaveLength(MAX_WORKDAY_TREES);
  expect(kept.at(-1)).toBe(`acme / list / Question ${MAX_WORKDAY_TREES + 1}`);
});
