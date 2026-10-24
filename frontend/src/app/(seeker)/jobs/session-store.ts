/**
 * One value kept for the tab's session: held in memory and mirrored to
 * sessionStorage, so it survives a reload, and read by components through
 * useSyncExternalStore. ./feed-pages (the feed's Load More pages) and
 * ./shown-list (the list the job page's rail draws) are both built on it,
 * so the two lists keep their records the same way.
 *
 * `read` returns the same object until the next `write`, as
 * useSyncExternalStore needs; it reads storage once, on first use, in the
 * browser only (call it from a client snapshot, never the server's).
 * sessionStorage can be off (a private window) or full: then the value
 * lives in memory for the visit and nothing breaks.
 */
export function sessionStore<T>(key: string) {
  let value: T | null | undefined;
  const listeners = new Set<() => void>();

  return {
    read(): T | null {
      if (value === undefined) {
        try {
          value = JSON.parse(sessionStorage.getItem(key) ?? "null") as T | null;
        } catch {
          value = null;
        }
      }
      return value;
    },

    /** Replaces the value, or drops it with null, and tells every reader. */
    write(next: T | null) {
      value = next;
      try {
        if (next === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage off or full: kept in memory for this visit */
      }
      for (const listener of listeners) listener();
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
