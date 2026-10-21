"use client";

import { useState, useTransition } from "react";

import { updateProfile } from "@/lib/profile-actions";

/**
 * Settings' one control so far (KAN-298): opts into the daily job-match
 * digest, the bell notification and the email alike — one flag gates both,
 * since the feature is one "alerts" idea to the student, not two separate
 * toggles. A native checkbox, visually a switch (peer-checked styles the
 * track and thumb) rather than a new shared Switch component: Settings has
 * exactly one toggle today, and `src/components/ui` is for a second
 * consumer (frontend/CLAUDE.md), not a guess at one.
 *
 * Optimistic: flips immediately, rolls back only if the save fails, so the
 * control never feels like it's waiting on a network round trip for
 * something this low-stakes.
 */
export function JobAlertsToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const { error } = await updateProfile({ job_alerts_enabled: next });
      if (error) {
        setEnabled(!next); // roll back
        setError(error);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor="job-alerts" className="text-body text-ink font-medium">
          Daily Job Match Alerts
        </label>
        <p className="text-meta text-ink-muted mt-0.5">
          Get your best-matching new jobs each day, in Notifications and by email.
        </p>
        {error && (
          <p role="alert" className="text-meta text-danger mt-1">
            {error}
          </p>
        )}
      </div>

      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          id="job-alerts"
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={pending}
          onChange={toggle}
          className="peer sr-only"
        />
        <span
          className="peer-checked:bg-brand bg-border-subtle peer-focus-visible:ring-brand-ring h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-offset-2"
          aria-hidden
        />
        <span
          className="absolute left-0.5 size-5 translate-x-0 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
          aria-hidden
        />
      </label>
    </div>
  );
}
