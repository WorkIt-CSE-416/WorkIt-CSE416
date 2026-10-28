"use client";

import { useState, useTransition } from "react";

import { Switch } from "@/components/shadcn/switch";
import { updateProfile } from "@/lib/profile-actions";

/**
 * New Matches' switch, live (KAN-298): one flag gates both the bell and the
 * daily email, since the feature is one "alerts" idea to the student, not
 * two. Optimistic: flips immediately, rolls back only if the save fails.
 */
export function JobAlertsSwitch({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
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
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={enabled}
        disabled={pending}
        onCheckedChange={toggle}
        aria-labelledby="new-matches-label"
        aria-describedby="new-matches-line"
      />
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
