"use client";

import { useSyncExternalStore } from "react";

import { readEvents, type ScoutMessage } from "./stream";

/**
 * Scout's conversation: one per tab, shared by the panel and every button
 * that opens it.
 *
 * A module-level store rather than a React context, because there is only
 * ever one Scout and nothing needs a provider to say which: any component
 * imports useScout() and the actions below. It survives moving between the
 * feed and a job's own page, and a reload starts a fresh chat — the trade for
 * having no conversation table yet.
 *
 * The browser holds the history and sends it whole each turn; the API keeps
 * nothing between requests and accepts at most 40 messages.
 */

type ScoutState = {
  open: boolean;
  /** Finished turns only. */
  messages: ScoutMessage[];
  /** The reply streaming in now, or null when Scout is not answering. */
  reply: string | null;
  /** The job last asked about from its card. Sent with every message after it,
   *  so follow-ups ("what should I learn first?") keep that job in view. */
  jobId: string | null;
  error: string | null;
};

const MAX_HISTORY = 40;
const INITIAL: ScoutState = {
  open: false,
  messages: [],
  reply: null,
  jobId: null,
  error: null,
};

let state = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<ScoutState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server snapshot is INITIAL, so the panel renders closed and empty
 *  there, and the client hydrates to the same. */
export function useScout(): ScoutState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
}

export function setScoutOpen(open: boolean) {
  update({ open });
}

export async function sendToScout(text: string) {
  const content = text.trim();
  if (!content || state.reply !== null) return;

  const messages: ScoutMessage[] = [...state.messages, { role: "user", content }];
  update({ messages, reply: "", error: null });

  let reply = "";
  let error: string | null = null;
  try {
    const res = await fetch("/api/scout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages.slice(-MAX_HISTORY), job_id: state.jobId }),
    });
    if (!res.ok || !res.body) {
      const body: unknown = await res.json().catch(() => null);
      const detail = (body as { detail?: unknown } | null)?.detail;
      error = typeof detail === "string" ? detail : "Scout couldn't answer. Try again.";
    } else {
      for await (const event of readEvents(res.body)) {
        if (event.type === "error") {
          error = event.message;
        } else {
          reply += event.delta;
          update({ reply });
        }
      }
    }
  } catch {
    error = "Scout couldn't be reached. Check your connection and try again.";
  }

  // Whatever arrived becomes a turn, even if an error cut it short.
  update({
    messages: reply ? [...state.messages, { role: "assistant", content: reply }] : state.messages,
    reply: null,
    error,
  });
}

export function askScoutAbout(job: { id: string; title: string; company: string }) {
  update({ open: true, jobId: job.id });
  void sendToScout(
    `What do you think of the ${job.title} role at ${job.company}? Is it a good fit for me?`,
  );
}
