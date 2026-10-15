"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * The job postings the seeker queued with Auto Apply, from a job card or a
 * job posting page, for the Auto Apply page's Live Activity to show.
 *
 * IT LIVES IN THE BROWSER UNTIL THE WEBAPP CALLS THE API'S QUEUE. The API
 * holds it now (job_applications.stage, auto-apply/architecture.md, "API
 * routes"); once Auto Apply POSTs to /applicants/{id}/applications and Live
 * Activity reads it back, this file goes. Until then it is
 * kept in localStorage, so a reload and a return the next day still find it.
 *
 * ONE QUEUE PER ACCOUNT: the key carries the account id, which the seeker
 * layout passes to the provider, so the next person to sign in on this
 * browser never sees the last one's queue. A store rather than state, so the
 * buttons and the page share one copy (useSyncExternalStore); the server
 * snapshot is empty, so the page hydrates without it and the queue arrives
 * just after.
 */
export type QueuedJob = {
  id: string;
  title: string;
  company: string;
  logoUrl: string | null;
  /** The card's place line, "San Francisco, CA"; null when it names none. */
  location: string | null;
  /** When it was queued: an ISO instant. */
  queuedAt: string;
};

const PREFIX = "workit:auto-apply-queue:";
const EMPTY: QueuedJob[] = [];

let kept: { key: string; jobs: QueuedJob[] } | null = null;
const listeners = new Set<() => void>();

/** The same array until it changes, as useSyncExternalStore needs. */
function read(key: string): QueuedJob[] {
  if (kept?.key !== key) {
    let jobs = EMPTY;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(saved)) jobs = saved as QueuedJob[];
    } catch {
      // Storage blocked (a private window) or a value that isn't JSON: start empty.
    }
    kept = { key, jobs };
  }
  return kept.jobs;
}

function write(key: string, jobs: QueuedJob[]) {
  kept = { key, jobs };
  try {
    localStorage.setItem(key, JSON.stringify(jobs));
  } catch {
    // Storage blocked: the queue still lasts until the tab closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed a queue: read it again.
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(PREFIX)) {
      kept = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const QueueKey = createContext<string | null>(null);

/** In the seeker layout, around the pages, with the signed-in account's id. */
export function AutoApplyQueueProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  return <QueueKey value={PREFIX + accountId}>{children}</QueueKey>;
}

/** The queue, newest first, and `add`, which ignores a job already in it. */
export function useAutoApplyQueue() {
  const key = useContext(QueueKey);
  if (!key)
    throw new Error("useAutoApplyQueue needs the AutoApplyQueueProvider in (seeker)/layout.tsx");

  const jobs = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );

  const add = useCallback(
    (job: Omit<QueuedJob, "queuedAt">) => {
      const queue = read(key);
      if (queue.some((queued) => queued.id === job.id)) return;
      write(key, [{ ...job, queuedAt: new Date().toISOString() }, ...queue]);
    },
    [key],
  );

  return { jobs, add };
}
