"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";

import { PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import type { ParsedResume } from "@/lib/resume-actions";

import { EntryDialog } from "./entry-dialog";
import type { SectionKey } from "./resume-review-dialog";

/**
 * The profile's Work Experience and Skills cards, rendered from the newest
 * resume's parsed content. Each entry opens its own editor; saving one sends
 * the whole updated list through `onChange`, which persists it and resolves
 * to an error message or null.
 */
type SectionProps = {
  /** null when there is no saved resume — nothing to attach edits to. */
  parsed: ParsedResume | null;
  onChange: (section: SectionKey, entries: object[]) => Promise<string | null>;
};

/** Which entry is open: its index, "new" while adding, or null. */
function useEntryEditor(
  section: SectionKey,
  entries: object[],
  onChange: SectionProps["onChange"],
) {
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function commit(next: object[]) {
    const error = await onChange(section, next);
    if (!error) setEditing(null);
    return error;
  }

  const dialog =
    editing === null ? null : (
      <EntryDialog
        section={section}
        entry={editing === "new" ? null : entries[editing]}
        // New entries go first: the most recent role is usually the one being added.
        onSave={(entry) =>
          commit(
            editing === "new"
              ? [entry, ...entries]
              : entries.map((e, i) => (i === editing ? entry : e)),
          )
        }
        onDelete={
          editing === "new" ? undefined : () => commit(entries.filter((_, i) => i !== editing))
        }
        onCancel={() => setEditing(null)}
      />
    );

  return { edit: setEditing, dialog };
}

function emptyNote(parsed: ParsedResume | null, what: string) {
  return (
    <p className="text-label text-ink-meta mt-2 font-normal">
      {parsed ? `No ${what} yet.` : "Upload a resume to fill this in."}
    </p>
  );
}

const month = (iso: string) => format(parseISO(iso), "MMM yyyy");

/** "Jan 2021 - Present"; an open end reads as current only when a start exists. */
function period(start: string | null, end: string | null) {
  return [start && month(start), end ? month(end) : start && "Present"].filter(Boolean).join(" - ");
}

export function ExperienceCard({ parsed, onChange }: SectionProps) {
  const roles = parsed?.experience ?? [];
  const { edit, dialog } = useEntryEditor("experience", roles, onChange);

  return (
    <Card as="section" aria-labelledby="experience">
      <SectionHeading
        id="experience"
        action={
          <Button variant="ghost" disabled={!parsed} onClick={() => edit("new")}>
            + Add
          </Button>
        }
      >
        Work Experience
      </SectionHeading>

      {roles.length === 0 ? (
        emptyNote(parsed, "work experience")
      ) : (
        <ol className="mt-4.5 flex flex-col gap-4">
          {roles.map((role, i) => {
            const meta = [period(role.start_date, role.end_date), role.location]
              .filter(Boolean)
              .join(" • ");
            return (
              <li key={i} className="border-border relative border-l-2 pr-8 pl-5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-1 -left-1.5 size-2.5 rounded-full",
                    role.start_date && !role.end_date ? "bg-brand" : "bg-border-strong",
                  )}
                />
                <IconButton
                  label={`Edit ${role.title} at ${role.company_name}`}
                  className="absolute top-0 right-0"
                  onClick={() => edit(i)}
                >
                  <PencilIcon className="size-3" />
                </IconButton>
                <h3 className="text-subtitle text-ink">{role.title}</h3>
                <p className="text-note text-brand mt-0.5 font-medium">{role.company_name}</p>
                {meta && <p className="text-meta text-ink-meta mt-0.5">{meta}</p>}
                {role.description && (
                  <p className="text-label text-ink-muted mt-0.5 leading-5 font-normal whitespace-pre-line">
                    {role.description}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {dialog}
    </Card>
  );
}

export function SkillsCard({ parsed, onChange }: SectionProps) {
  const skills = parsed?.skills ?? [];
  const { edit, dialog } = useEntryEditor("skills", skills, onChange);

  return (
    <Card as="section" aria-labelledby="skills">
      <SectionHeading
        id="skills"
        action={
          <Button variant="ghost" disabled={!parsed} onClick={() => edit("new")}>
            + Add
          </Button>
        }
      >
        Skills
      </SectionHeading>

      {skills.length === 0 ? (
        emptyNote(parsed, "skills")
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((skill, i) => (
            <li key={i}>
              <button
                type="button"
                aria-label={`Edit skill ${skill.skill_name}`}
                title={skill.category ?? undefined}
                onClick={() => edit(i)}
                className="bg-brand-tint text-ink text-note hover:bg-brand/15 focus-visible:ring-brand-ring rounded-full px-2.5 py-1 focus-visible:ring-2 focus-visible:outline-none"
              >
                {skill.skill_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Card>
  );
}
