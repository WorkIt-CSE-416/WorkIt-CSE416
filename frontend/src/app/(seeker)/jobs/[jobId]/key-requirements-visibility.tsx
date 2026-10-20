"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";

const PREFERENCE_KEY = "workit:key-requirements-hidden";
const CHANGE_EVENT = "workit:key-requirements-visibility";
let fallbackHidden: boolean | null = null;

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== PREFERENCE_KEY) return;
    fallbackHidden = null;
    onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function getSnapshot() {
  if (fallbackHidden !== null) return fallbackHidden;
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot() {
  return false;
}

export function KeyRequirementsVisibility({ children }: { children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const contentId = useId();
  const titleId = useId();

  function toggle() {
    fallbackHidden = !hidden;
    try {
      window.localStorage.setItem(PREFERENCE_KEY, String(!hidden));
    } catch {
      // Keep the control usable when the browser blocks persistent storage.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <section aria-labelledby={titleId} className="border-border mt-6 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-subtitle text-ink font-semibold">
          Key Requirements
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!hidden}
          aria-controls={contentId}
          aria-label={hidden ? "Show Key Requirements" : "Hide Key Requirements"}
          className="text-brand rounded px-2 py-1 text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {hidden ? "Show" : "Hide"}
        </button>
      </div>
      <div id={contentId} hidden={hidden}>
        {children}
      </div>
    </section>
  );
}
