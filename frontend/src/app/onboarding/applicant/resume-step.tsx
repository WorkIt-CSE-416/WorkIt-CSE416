"use client";

import { XIcon } from "@phosphor-icons/react/ssr";

import { formatDates, SECTIONS } from "@/app/(seeker)/bank/sections";
import { CheckIcon, FileIcon } from "@/components/icons";
import { ResumeUpload } from "@/components/resume-upload";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import type { PreviewEntry, ResumePreview } from "@/lib/resume-actions";

import { Field } from "./role-step";

/**
 * Onboarding's resume step (KAN-372, ADR 0006). The student picks a file and
 * Read Resume shows what the parser found in it, with nothing saved yet
 * (POST .../resumes/preview). Save Resume then uploads the same file with
 * `replace=matching`, so the reading lands in the experience bank and
 * replaces, rather than copies, what an earlier upload holds of the same
 * entries. Each entry and skill that would replace one says so here, before
 * the student agrees. Each skill has a × (KAN-369): a skill taken out is not
 * saved, and no later reading adds it again. The footer's buttons live in
 * ./onboarding-form, which owns the step's state.
 */
export function ResumeStep({
  file,
  onFileChange,
  onRemove,
  reading,
  preview,
  removedSkills,
  onRemoveSkill,
  savedName,
}: {
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
  /** Read Resume is in flight. */
  reading: boolean;
  /** The picked file's reading, once Read Resume answered. */
  preview: ResumePreview | null;
  /** The skills the student took out of the reading (×). */
  removedSkills: readonly string[];
  onRemoveSkill: (name: string) => void;
  /** The file this visit saved, if any. */
  savedName: string | null;
}) {
  if (file && preview)
    return (
      <Reading
        name={file.name}
        preview={preview}
        removedSkills={removedSkills}
        onRemoveSkill={onRemoveSkill}
      />
    );
  return (
    <>
      {savedName && (
        <p className="text-body text-positive-ink bg-positive-tint rounded-control mb-6 flex items-center gap-2 px-3.5 py-2.5">
          <CheckIcon className="size-4 shrink-0" />
          Saved {savedName}. Its entries are in your Experiences.
        </p>
      )}
      <Field
        Icon={FileIcon}
        label="Resume"
        hint={
          savedName
            ? "Have a newer version? Read it the same way."
            : "Nothing is saved until you check what WorkIt read."
        }
      >
        <ResumeUpload file={file} onFileChange={onFileChange} onRemove={onRemove} busy={reading} />
      </Field>
    </>
  );
}

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the parser read, by section, before anything is saved. */
function Reading({
  name,
  preview,
  removedSkills,
  onRemoveSkill,
}: {
  name: string;
  preview: ResumePreview;
  removedSkills: readonly string[];
  onRemoveSkill: (name: string) => void;
}) {
  const { entries, duplicate_of: duplicate } = preview;
  const skills = preview.skills.filter((s) => !removedSkills.includes(s.name));
  const replacing =
    entries.filter((e) => e.replaces.length).length +
    skills.filter((s) => s.replaces.length).length;

  if (duplicate) {
    return (
      <Field Icon={FileIcon} label="Already Uploaded">
        <p className="text-subtitle text-ink font-normal">
          You uploaded this resume before, as {duplicate.name}. Its entries are already in your
          Experiences, so there is nothing new to save.
        </p>
      </Field>
    );
  }

  if (entries.length === 0 && skills.length === 0) {
    return (
      <Field Icon={FileIcon} label="What WorkIt Found">
        <p className="text-subtitle text-ink font-normal">
          WorkIt couldn&apos;t find any entries in {name}. You can still save it, and add your
          experiences later on the Experiences page.
        </p>
      </Field>
    );
  }

  return (
    <Field
      Icon={FileIcon}
      label="What WorkIt Found"
      hint={
        `${count(entries.length, "entry", "entries")} and ${count(skills.length, "skill")} in ${name}. ` +
        (replacing
          ? `${count(replacing, "item")} will replace the copy an earlier upload holds. `
          : "") +
        "Nothing is saved until you press Save Resume. You can edit everything later in Experiences."
      }
    >
      <div className="flex flex-col gap-6">
        {SECTIONS.map((section) => {
          const found = entries.filter((e) => e.section === section.id);
          if (!found.length) return null;
          return (
            <section key={section.id} aria-label={section.label}>
              <h3 className="text-caption text-ink-muted mb-2 uppercase">{section.label}</h3>
              <ul className="flex flex-col gap-3">
                {found.map((entry, i) => (
                  <EntryRow key={i} entry={entry} />
                ))}
              </ul>
            </section>
          );
        })}
        {skills.length > 0 && (
          <section aria-label="Skills">
            <h3 className="text-caption text-ink-muted mb-2 uppercase">Skills</h3>
            <ul className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <li
                  key={skill.name}
                  className="rounded-control text-note text-ink border-border-subtle inline-flex items-center gap-1.5 border px-2 py-1"
                >
                  {skill.name}
                  <IconButton
                    label={`Remove ${skill.name}`}
                    tooltip="Leave this skill out"
                    onClick={() => onRemoveSkill(skill.name)}
                  >
                    <XIcon aria-hidden className="size-3" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Field>
  );
}

function EntryRow({ entry }: { entry: PreviewEntry }) {
  const meta = [entry.organization, formatDates(entry)].filter(Boolean).join(" · ");
  return (
    <li className="border-border-subtle rounded-card border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-subtitle text-ink font-medium">{entry.title}</p>
        {entry.replaces.length > 0 && (
          // Inert, not a status colour: replacing is no stage and owes
          // nothing (frontend/docs/design.md, colour meanings).
          <Badge variant="tag" tone="inert">
            Replaces Earlier Copy
          </Badge>
        )}
      </div>
      {meta && <p className="text-body text-ink-meta">{meta}</p>}
      {entry.bullets.length > 0 && (
        <ul className="text-body text-ink-muted mt-2 list-disc space-y-1 pl-5">
          {entry.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
