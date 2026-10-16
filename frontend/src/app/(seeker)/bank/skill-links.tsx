"use client";

import { Check } from "lucide-react";

import type { Skill } from "@/lib/bank-actions";
import { FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

/**
 * "Skills Used Here" in the entry editor (KAN-216): one toggle per bank
 * skill, pressed when the skill is linked to this entry. It only edits the
 * list of ids; the caller turns the difference into link and unlink calls
 * when the entry saves. A skill with no linked entry is fine (one learned
 * on one's own), so nothing here is required.
 */
export function SkillLinksField({
  skills,
  value,
  onChange,
}: {
  skills: Skill[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  if (skills.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={FIELD_LABEL}>Skills Used Here</legend>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill) => {
          const linked = value.includes(skill.id);
          return (
            <button
              key={skill.id}
              type="button"
              aria-pressed={linked}
              onClick={() =>
                onChange(linked ? value.filter((v) => v !== skill.id) : [...value, skill.id])
              }
              className={cn(
                "text-note focus-visible:ring-brand-ring bg-panel inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 font-medium focus-visible:ring-2 focus-visible:outline-none",
                linked
                  ? "border-brand text-brand"
                  : "border-border-subtle text-ink-meta hover:text-ink",
              )}
            >
              {linked && <Check className="size-3" aria-hidden />}
              {skill.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The link and unlink calls that turn `saved` into `wanted`. */
export function linkChanges(saved: string[], wanted: string[]) {
  return {
    link: wanted.filter((id) => !saved.includes(id)),
    unlink: saved.filter((id) => !wanted.includes(id)),
  };
}
