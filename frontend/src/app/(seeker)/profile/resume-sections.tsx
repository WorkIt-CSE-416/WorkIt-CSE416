"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon, PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import type { ParsedResume } from "@/lib/resume-actions";

import { EntryDialog } from "./entry-dialog";
import { ResumeEditDialog, type SectionKey } from "./resume-edit-dialog";

/**
 * The profile's Work Experience and Skills cards, rendered from the newest
 * resume's parsed content. Work Experience edits every role in one modal;
 * each skill opens its own editor. Either way the whole updated section goes
 * through `onChange`, which persists it and resolves to an error message or
 * null.
 */
type SectionProps = {
  /** null when there is no saved resume — nothing to attach edits to. */
  parsed: ParsedResume | null;
  onChange: (section: SectionKey, entries: object[]) => Promise<string | null>;
};

type Role = ParsedResume["experience"][number];

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

/** Roles shown while the section is collapsed. */
const PREVIEW_ROLES = 2;

function RoleItem({ role, expanded }: { role: Role; expanded: boolean }) {
  const meta = [period(role.start_date, role.end_date), role.location].filter(Boolean).join(" • ");

  return (
    <li className="border-border relative border-l-2 pl-5">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1 -left-1.5 size-2.5 rounded-full",
          role.start_date && !role.end_date ? "bg-brand" : "bg-border-strong",
        )}
      />
      <h3 className="text-subtitle text-ink">{role.title}</h3>
      <p className="text-note text-brand mt-0.5 font-medium">{role.company_name}</p>
      {meta && <p className="text-meta text-ink-meta mt-0.5">{meta}</p>}
      {role.description && (
        <p
          data-description
          className={cn(
            "text-label text-ink-muted mt-0.5 leading-5 font-normal whitespace-pre-line",
            !expanded && "line-clamp-2",
          )}
        >
          {role.description}
        </p>
      )}
    </li>
  );
}

/**
 * Collapsed, the card previews the first PREVIEW_ROLES roles with their
 * descriptions cut to two lines; one chevron in the header expands the whole
 * section. The chevron appears only when the preview actually hides
 * something — more roles, or a description longer than two lines — and the
 * second depends on the card's width, so it is measured, and measured again
 * on resize. A ResizeObserver reports once as soon as it starts observing,
 * which takes the first measurement.
 */
export function ExperienceCard({ parsed, onChange }: SectionProps) {
  const roles = parsed?.experience ?? [];
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hidesSome, setHidesSome] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const listId = useId();

  useEffect(() => {
    const list = listRef.current;
    // Expanded, nothing is hidden to measure; keep the last answer so the
    // chevron stays to collapse the section again.
    if (!list || expanded) return;
    const hidesRoles = (parsed?.experience.length ?? 0) > PREVIEW_ROLES;
    const observer = new ResizeObserver(() =>
      setHidesSome(
        hidesRoles ||
          [...list.querySelectorAll("[data-description]")].some(
            (p) => p.scrollHeight - p.clientHeight > 1,
          ),
      ),
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, [parsed, expanded]);

  return (
    <Card as="section" aria-labelledby="experience">
      <SectionHeading
        id="experience"
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" disabled={!parsed} onClick={() => setEditing(true)}>
              <PencilIcon className="size-3" />
              Edit
            </Button>
            {hidesSome && (
              <IconButton
                label={expanded ? "Show less" : "Show all work experience"}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((open) => !open)}
              >
                <ChevronDownIcon
                  className={cn("size-4 transition-transform", expanded && "rotate-180")}
                />
              </IconButton>
            )}
          </div>
        }
      >
        Work Experience
      </SectionHeading>

      {roles.length === 0 ? (
        emptyNote(parsed, "work experience")
      ) : (
        <ol ref={listRef} id={listId} className="mt-4.5 flex flex-col gap-4">
          {(expanded ? roles : roles.slice(0, PREVIEW_ROLES)).map((role, i) => (
            <RoleItem key={i} role={role} expanded={expanded} />
          ))}
        </ol>
      )}

      {editing && parsed && (
        <ResumeEditDialog
          title="Edit work experience"
          description="Add, change or remove experience, then save."
          sections={["experience"]}
          parsed={parsed}
          onSave={async (edited) => {
            const error = await onChange("experience", edited.experience);
            if (!error) setEditing(false);
            return error;
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

export function SkillsCard({ parsed, onChange }: SectionProps) {
  const skills = parsed?.skills ?? [];
  // Which skill is open: its index, "new" while adding, or null.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function commit(next: object[]) {
    const error = await onChange("skills", next);
    if (!error) setEditing(null);
    return error;
  }

  return (
    <Card as="section" aria-labelledby="skills">
      <SectionHeading
        id="skills"
        action={
          <Button variant="ghost" disabled={!parsed} onClick={() => setEditing("new")}>
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
                onClick={() => setEditing(i)}
                className="bg-brand-tint text-ink text-note hover:bg-brand/15 focus-visible:ring-brand-ring rounded-full px-2.5 py-1 focus-visible:ring-2 focus-visible:outline-none"
              >
                {skill.skill_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <EntryDialog
          section="skills"
          entry={editing === "new" ? null : skills[editing]}
          onSave={(entry) =>
            commit(
              editing === "new"
                ? [entry, ...skills]
                : skills.map((s, i) => (i === editing ? entry : s)),
            )
          }
          onDelete={
            editing === "new" ? undefined : () => commit(skills.filter((_, i) => i !== editing))
          }
          onCancel={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
