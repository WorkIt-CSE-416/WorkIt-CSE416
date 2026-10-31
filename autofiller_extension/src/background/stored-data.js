// What the extension keeps in chrome.storage.local across versions (KAN-471).
// Storage carries a schema version, and an update runs each migration from
// the stored version up to STORAGE_VERSION, in order, once. A change to what
// a stored key holds adds a migration here and bumps the version; without
// one, an update leaves the old shape for code that reads the new one.
//
// Each function takes the storage area (chrome.storage.local's get and set)
// as an argument, so a test runs it on a fake one, and nothing here touches
// chrome.* at import time.

export const STORAGE_VERSION_KEY = "workit_storage_version";
export const STORAGE_VERSION = 1;

// The nested prompts and dropdown lists the engine read on each Workday
// tenant (fill/plan, fill/page), kept for its next fill. One entry per
// tenant and question, so it grew with every tenant a student ever opened;
// past the cap the entries saved longest ago go first. A dropped one is only
// read again from the page on that tenant's next fill.
//
// Stored as [key, tree] pairs, oldest saved first, not as an object:
// chrome.storage gives an object's keys back sorted, so an object can't
// say which entry is oldest (seen in the loaded extension, 2026-10-31).
export const WORKDAY_TREES_KEY = "workday_trees";
export const MAX_WORKDAY_TREES = 300;

/**
 * `kept` with `saved` written over it as the newest entries, and the oldest
 * dropped past MAX_WORKDAY_TREES.
 * @param {[string, object][]} kept
 * @param {Record<string, object>} [saved]
 * @returns {[string, object][]}
 */
export function cappedTrees(kept, saved = {}) {
  const all = [...kept.filter(([key]) => !Object.hasOwn(saved, key)), ...Object.entries(saved)];
  return all.slice(Math.max(0, all.length - MAX_WORKDAY_TREES));
}

/**
 * The Workday trees in `storage`, as the engine's host loads and saves them
 * (engine.js handleFill's `trees`): load gives an object by key.
 * @param {{ get(key: string): Promise<object>, set(items: object): Promise<void> }} storage
 */
export function treeStore(storage) {
  // An object is the shape before version 1, read as it is until the update's migration has run.
  const entries = async () => {
    const stored = (await storage.get(WORKDAY_TREES_KEY))[WORKDAY_TREES_KEY] ?? [];
    return Array.isArray(stored) ? stored : Object.entries(stored);
  };
  return {
    async load() {
      return Object.fromEntries(await entries());
    },
    async save(saved) {
      await storage.set({ [WORKDAY_TREES_KEY]: cappedTrees(await entries(), saved) });
    },
  };
}

// Each migration takes storage from the version before it to its own.
const MIGRATIONS = {
  // 0 (no version, before KAN-471) to 1: the Workday trees go from an object to capped [key, tree] pairs. The
  // object kept no save order, so which entries past the cap are dropped is arbitrary.
  1: async (storage) => {
    const trees = (await storage.get(WORKDAY_TREES_KEY))[WORKDAY_TREES_KEY];
    if (trees && !Array.isArray(trees)) await storage.set({ [WORKDAY_TREES_KEY]: cappedTrees(Object.entries(trees)) });
  },
};

/**
 * Brings `storage` up to STORAGE_VERSION: every migration after the stored
 * version, in order, each recording its version once done, so one that
 * fails is run again on the next update or start. Storage already at the
 * version is not written.
 * @param {{ get(key: string): Promise<object>, set(items: object): Promise<void> }} storage
 */
export async function migrateStorage(storage) {
  let version = (await storage.get(STORAGE_VERSION_KEY))[STORAGE_VERSION_KEY] ?? 0;
  while (version < STORAGE_VERSION) {
    version += 1;
    await MIGRATIONS[version](storage);
    await storage.set({ [STORAGE_VERSION_KEY]: version });
  }
}
