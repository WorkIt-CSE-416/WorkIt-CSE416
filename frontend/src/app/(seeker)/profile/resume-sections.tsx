"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon, PencilIcon, PlusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";
import type { ParsedResume } from "@/lib/resume-actions";

import { EntryDialog } from "./entry-dialog";
import { ResumeEditDialog, type SectionKey } from "./resume-edit-dialog";
import { SectionAction } from "./section-action";

/**
 * The profile's Work Experience and Skills: open sections, as the rest of the
 * page below the Resume card is, rendered from the primary (else newest)
 * resume's parsed content. Work Experience edits every role in one modal;
 * each skill opens its own editor. Either way the whole updated section goes
 * through `onChange`, which persists it and resolves to an error message or
 * null.
 */
type SectionProps = {
  /** null when there is no saved resume — nothing to attach edits to. */
  parsed: ParsedResume | null;
  /** The sections' content is loading: the editors stay shut, since one
   *  opened on the outgoing resume would save onto the incoming one, and an
   *  empty section means "not yet" rather than "none". */
  loading?: boolean;
  onChange: (section: SectionKey, entries: object[]) => Promise<string | null>;
};

type Role = ParsedResume["experience"][number];

function emptyNote(parsed: ParsedResume | null, loading: boolean | undefined, what: string) {
  let note = "Upload a resume to fill this in.";
  if (loading) note = "Loading…";
  else if (parsed) note = `No ${what} yet.`;
  return <p className="text-body text-ink-meta mt-4">{note}</p>;
}

const month = (iso: string) => format(parseISO(iso), "MMM yyyy");

/** "Jan 2021 - Present"; an open end reads as current only when a start exists. */
function period(start: string | null, end: string | null) {
  return [start && month(start), end ? month(end) : start && "Present"].filter(Boolean).join(" - ");
}

/** Roles shown while the section is collapsed. */
const PREVIEW_ROLES = 2;

/** One role on the rail. Its meta line wraps between its parts, and a part
 *  too long for the column (parsed text can be) truncates rather than
 *  widening the page. */
function RoleItem({ role, expanded }: { role: Role; expanded: boolean }) {
  const meta = [
    role.company_name && <span className="text-ink-muted font-medium">{role.company_name}</span>,
    period(role.start_date, role.end_date),
    role.location,
  ].filter(Boolean);

  return (
    <li className="relative pl-5">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 -left-1 size-2.5 rounded-full",
          role.start_date && !role.end_date ? "bg-brand" : "bg-ink-faint",
        )}
      />
      <h3 className="text-subtitle text-ink wrap-break-word">{role.title}</h3>
      {meta.length > 0 && (
        <p className="text-note text-ink-meta mt-0.5 flex flex-wrap gap-x-1.5">
          {meta.map((part, i) => (
            <span key={i} className="max-w-full truncate">
              {part}
              {i < meta.length - 1 && (
                <span aria-hidden="true" className="text-ink-faint ml-1.5">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>
      )}
      {role.description && (
        <p
          data-description
          className={cn(
            "text-body text-ink-muted mt-1.5 wrap-break-word whitespace-pre-line",
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
 * Collapsed, the section previews the first PREVIEW_ROLES roles with their
 * descriptions cut to two lines; one chevron in the heading expands the whole
 * section. The chevron appears only when the preview actually hides
 * something — more roles, or a description longer than two lines — and the
 * second depends on the column's width, so it is measured, and measured again
 * on resize. A ResizeObserver reports once as soon as it starts observing,
 * which takes the first measurement.
 */
export function ExperienceSection({ parsed, loading, onChange }: SectionProps) {
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
    <section aria-labelledby="experience">
      <SectionHeading
        id="experience"
        action={
          <div className="flex items-center gap-3">
            <SectionAction
              aria-label="Edit Work Experience"
              disabled={!parsed || loading}
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
              Edit
            </SectionAction>
            {/* hidesSome keeps its last answer once no list is left to measure. */}
            {hidesSome && roles.length > 0 && (
              <IconButton
                label={expanded ? "Show less" : "Show all work experience"}
                aria-expanded={expanded}
                aria-controls={listId}
                className="text-ink-muted"
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

      {/* One rail for the whole list, drawn by the <ol> from under the first
          dot (top-3) so no stub shows above it. */}
      {roles.length === 0 ? (
        emptyNote(parsed, loading, "work experience")
      ) : (
        <ol
          ref={listRef}
          id={listId}
          className="before:bg-border relative mt-4 flex flex-col gap-5 before:absolute before:top-3 before:bottom-1 before:left-0 before:w-0.5 before:content-['']"
        >
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
    </section>
  );
}

export function SkillsSection({ parsed, loading, onChange }: SectionProps) {
  const skills = parsed?.skills ?? [];
  // Which skill is open: its index, "new" while adding, or null.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function commit(next: object[]) {
    const error = await onChange("skills", next);
    if (!error) setEditing(null);
    return error;
  }

  return (
    <section aria-labelledby="skills">
      <SectionHeading
        id="skills"
        action={
          <SectionAction
            aria-label="Add Skill"
            disabled={!parsed || loading}
            onClick={() => setEditing("new")}
          >
            <PlusIcon />
            Add
          </SectionAction>
        }
      >
        Skills
      </SectionHeading>

      {/* The design kit's skill pill: a fact about the seeker, so a tag, not
          a status. Each one is a button that opens its editor. */}
      {skills.length === 0 ? (
        emptyNote(parsed, loading, "skills")
      ) : (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {skills.map((skill, i) => (
            <li key={i} className="flex max-w-full">
              <button
                type="button"
                disabled={loading}
                aria-label={`Edit skill ${skill.skill_name}`}
                title={skill.category ?? undefined}
                onClick={() => setEditing(i)}
                className="focus-visible:ring-brand-ring hover:*:bg-brand/15 max-w-full rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
              >
                <Badge variant="tag">{skill.skill_name}</Badge>
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
    </section>
  );
}
