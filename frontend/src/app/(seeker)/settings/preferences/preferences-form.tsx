"use client";

import { useState } from "react";

import { statesNarrowCountries, type FeedFilters } from "@/app/(seeker)/jobs/filter-query";
import { savePreferences } from "@/app/onboarding/applicant/actions";
import { RoleStep } from "@/app/onboarding/applicant/role-step";
import type { PickOption } from "@/components/filter-controls";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

import { useUnsavedChanges } from "../unsaved-changes";

/**
 * The saved job preferences, edited in place with onboarding's own Role step
 * (`dense`), and saved the way onboarding saves them (PUT, a picked state
 * narrowing its country). Save is on only when something changed and the
 * three answers onboarding requires (role, job type, workplace) are given.
 * Unsaved edits hold a leave guard (../unsaved-changes).
 * The visa filter, which the Jobs page sets and onboarding no longer asks,
 * rides along unchanged.
 */
export function PreferencesForm({
  initial,
  roles,
  places,
  seasons,
}: {
  initial: FeedFilters;
  roles: PickOption[];
  places: PickOption[];
  seasons: PickOption[];
}) {
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [answers, setAnswers] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = JSON.stringify(answers) !== JSON.stringify(saved);
  const complete =
    answers.roles.length > 0 && answers.jobTypes.length > 0 && answers.workStyles.length > 0;
  useUnsavedChanges(changed);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const next = statesNarrowCountries(answers);
      const { error: saveError } = await savePreferences(next);
      if (saveError) {
        setError(saveError);
        return;
      }
      setSaved(next);
      setAnswers(next);
      toast.show({ message: "Your job preferences are saved." });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      <RoleStep
        dense
        answers={answers}
        set={(change) => setAnswers((a) => ({ ...a, ...change }))}
        roles={roles}
        places={places}
        seasons={seasons}
      />

      {/* Pinned to the foot of what scrolls (the modal's section, or the
          page), so Save is in view however far down the student is: at the
          end of seven fields it sat below the fold (KAN-364). */}
      <div className="bg-panel border-border-subtle sticky bottom-0 z-10 flex flex-col gap-3 border-t py-4">
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        {changed && !complete && (
          <p className="text-meta text-ink-meta">
            Pick a role, a job type and a workplace to save.
          </p>
        )}
        <div className="flex gap-3">
          <Button onClick={save} disabled={!changed || !complete || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {changed && !saving && (
            <Button
              variant="secondary"
              onClick={() => {
                setAnswers(saved);
                setError(null);
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
