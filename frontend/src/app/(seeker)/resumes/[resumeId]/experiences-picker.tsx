"use client";

import { CheckIcon, FileTextIcon, FunnelIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { useState, type ReactNode } from "react";

import { FieldFacet } from "@/components/field-facet";
import { ChevronDownIcon, CloseIcon } from "@/components/icons";
import { Checkbox } from "@/components/shadcn/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Bank, Section } from "@/lib/bank-actions";
import type { Choices, ChoicesUpdate } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { EntryRow } from "../../experiences/entry-row";
import { ALL, otherVersions, shows, type Pick } from "../../experiences/holdings";
import { ChooseResume } from "../../experiences/resume-bar";
import { SECTION_ICONS, SectionMark } from "../../experiences/section-icons";
import { SECTIONS, sectionOf } from "../../experiences/sections";
import {
  pickBullet,
  pickEntry,
  pickerEntries,
  pickerSkills,
  pickSkill,
  type PickedEntry,
  type PickedSkill,
} from "./model";

/** The checkbox's own edge all but vanishes on white, and an empty box says
 *  as much as a ticked one here. */
const PICK = "border-ink-meta mt-1";

/**
 * The Experiences picker (KAN-440), in Scout's panel on the desktop and in a
 * sheet on a phone: the whole bank beside the PDF, where a student chooses
 * what the resume shows. The resume is the part of the bank that is on, so
 * each entry, bullet and skill has one control, and adding and hiding are one
 * act. It only picks: typing stays on the PDF.
 *
 * It opens as one line for each group, with how much of it is on: a bank's
 * every entry at once was too much to read. Two controls narrow it. A resume
 * button opens the shared resume dialog (`ChooseResume`, as the Experiences
 * page's card does), never a dropdown: a dropdown of resumes has no search,
 * cuts long names short and grows with every tailored resume, which is why
 * KAN-361 retired one. Filters, at the row's right, takes groups only: a menu
 * that also held a "Not on This Resume" tick and every resume read as a
 * settings page, when the job is picking experiences. A narrowed list opens
 * its groups, since it is already short.
 *
 * It was "Not on This Resume", a wall of buttons under the page, then a
 * Hidden panel that listed only what was missing. Students could not see
 * their bank beside the resume, and the name was false for an item they had
 * never hidden. A bullet has a control only while its entry is on: an entry
 * that is off brings its bullets back with it. An entry with every bullet off
 * stays on as a heading, as a line's Hide leaves it, so nothing goes that the
 * student did not take.
 */
export function ExperiencesPicker({
  bank,
  choices,
  onApply,
}: {
  bank: Bank;
  choices: Choices;
  onApply: (changes: ChoicesUpdate) => void;
}) {
  const [resume, setResume] = useState<Pick>(ALL);
  const [groups, setGroups] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  // The groups the student pressed: open, or closed where narrowing opened them
  const [pressed, setPressed] = useState<string[]>([]);
  const narrowed = resume !== ALL || groups.length > 0;

  const allEntries = pickerEntries(bank, choices);
  const allSkills = pickerSkills(bank, choices);
  const picked = (id: string) => groups.length === 0 || groups.includes(id);
  const entries = allEntries.filter(
    (row) => picked(row.entry.section) && [row.entry, ...row.copies].some((e) => shows(resume, e)),
  );
  const skills = allSkills.filter(
    (row) => picked("skills") && [row.skill, ...row.copies].some((s) => shows(resume, s)),
  );

  const isOpen = (id: string) => pressed.includes(id) !== narrowed;
  const press = (id: string) =>
    setPressed((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const groupOptions = [
    ...SECTIONS.filter((s) => allEntries.some((row) => row.entry.section === s.id)).map((s) => ({
      value: s.id as string,
      label: s.label,
      Icon: SECTION_ICONS[s.id],
      iconClassName: "text-brand",
    })),
    ...(allSkills.length > 0
      ? [
          {
            value: "skills",
            label: "Skills",
            Icon: SECTION_ICONS.skills,
            iconClassName: "text-brand",
          },
        ]
      : []),
  ];
  const resumeName = bank.resumes.find((r) => r.id === resume)?.name ?? "All Experiences";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="min-w-0 flex-1 justify-start"
          title={resumeName}
          onClick={() => setChoosing(true)}
        >
          <FileTextIcon aria-hidden className="text-brand" />
          <span className="truncate">{resumeName}</span>
        </Button>
        {resume !== ALL && (
          <IconButton
            label="Show All Experiences"
            className="size-8 shrink-0"
            onClick={() => setResume(ALL)}
          >
            <CloseIcon className="size-4" />
          </IconButton>
        )}
        <FieldFacet
          label="Filters"
          Icon={FunnelIcon}
          options={groupOptions}
          values={groups}
          onChange={setGroups}
          className="shrink-0"
        />
      </div>

      {choosing && (
        <ChooseResume
          resumes={bank.resumes}
          value={resume}
          onShow={(pick) => {
            setChoosing(false);
            setResume(pick);
          }}
          onCancel={() => setChoosing(false)}
        />
      )}

      {entries.length === 0 && skills.length === 0 && (
        <p className="text-body text-ink-meta">Nothing here matches your filters.</p>
      )}

      {SECTIONS.map((section) => {
        const rows = entries.filter((row) => row.entry.section === section.id);
        if (rows.length === 0) return null;
        return (
          <PickerGroup
            key={section.id}
            id={section.id}
            label={sectionOf(section.id).label}
            on={rows.filter((row) => row.on).length}
            total={rows.length}
            open={isOpen(section.id)}
            onPress={() => press(section.id)}
          >
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li
                  key={row.entry.id}
                  className="ring-border-subtle bg-panel rounded-xl px-3 py-2.5 ring-1"
                >
                  <PickerRow row={row} bank={bank} onApply={onApply} />
                </li>
              ))}
            </ul>
          </PickerGroup>
        );
      })}

      {skills.length > 0 && (
        <PickerGroup
          id="skills"
          label="Skills"
          on={skills.filter((row) => row.on).length}
          total={skills.length}
          open={isOpen("skills")}
          onPress={() => press("skills")}
        >
          <SkillGroups skills={skills} onApply={onApply} />
        </PickerGroup>
      )}
    </div>
  );
}

/** A group as one line, its mark, name and how much of it is on the resume
 *  ("1 of 2 added"), that opens on its rows. */
function PickerGroup({
  id,
  label,
  on,
  total,
  open,
  onPress,
  children,
}: {
  id: Section | "skills";
  label: string;
  on: number;
  total: number;
  open: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onPress}
          className="hover:bg-well focus-visible:ring-brand-ring rounded-control flex w-full items-center gap-2 px-1.5 py-1.5 text-left outline-none focus-visible:ring-2"
        >
          <SectionMark id={id} className="size-7" />
          <span className="text-label text-brand-ink min-w-0 flex-1 truncate font-semibold">
            {label}
          </span>
          <span className="text-note text-ink-meta shrink-0 tabular-nums">
            {on} of {total} added
          </span>
          <ChevronDownIcon
            className={cn("text-brand size-4 shrink-0 transition-transform", !open && "-rotate-90")}
          />
        </button>
      </h3>
      {open && <div className="mt-1 mb-2">{children}</div>}
    </section>
  );
}

/** An entry in the bank's own row, with its control before the title and one
 *  on each bullet while it is on. */
function PickerRow({
  row,
  bank,
  onApply,
}: {
  row: PickedEntry;
  bank: Bank;
  onApply: (changes: ChoicesUpdate) => void;
}) {
  const { entry, on } = row;
  const printed = row.bullets.filter((b) => b.on).length;
  const versions = otherVersions(row, bank.resumes);
  return (
    <EntryRow
      entry={entry}
      muted={!on}
      bullets={row.bullets}
      summary={
        on && printed < row.bullets.length
          ? `${printed} of ${row.bullets.length} bullets`
          : undefined
      }
      lead={
        <Checkbox
          checked={on}
          onCheckedChange={(next) => onApply(pickEntry(row, next))}
          aria-label={`${entry.title} on this resume`}
          className={PICK}
        />
      }
      bulletLead={
        on
          ? (bullet) => (
              <Checkbox
                checked={row.bullets.find((b) => b.id === bullet.id)?.on ?? false}
                onCheckedChange={(next) => onApply(pickBullet(bullet.id, next))}
                aria-label={`Bullet on this resume: ${bullet.text}`}
                className={PICK}
              />
            )
          : undefined
      }
      note={
        versions.length > 0 && (
          <p className="text-note text-ink-meta mt-1 pl-6">
            Other bullets on {versions.map((v) => v.name).join(", ")}
          </p>
        )
      }
    />
  );
}

/** The skills by their group, as a resume prints them: a chip on the brand
 *  tint is on the resume, and an outline with a plus is not. */
function SkillGroups({
  skills,
  onApply,
}: {
  skills: PickedSkill[];
  onApply: (changes: ChoicesUpdate) => void;
}) {
  const groups = new Map<string, PickedSkill[]>();
  for (const row of skills) {
    const key = row.skill.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    // Indented to the "Skills" title: past its mark and gap, as the group's
    // own heading sets them (PickerGroup)
    <div className="flex flex-col gap-2 pl-10.5">
      {[...groups].map(([group, rows]) => (
        <div key={group}>
          {group && <p className="text-note text-ink-muted mb-1">{group}</p>}
          <ul className="flex flex-wrap gap-1.5">
            {rows.map((row) => (
              <li key={row.skill.id}>
                <button
                  type="button"
                  aria-pressed={row.on}
                  onClick={() => onApply(pickSkill(row, !row.on))}
                  className={cn(
                    "rounded-control text-note focus-visible:ring-brand-ring inline-flex items-center gap-1 border px-2 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    row.on
                      ? "bg-brand-tint text-brand-ink border-transparent"
                      : "border-border-subtle text-ink-muted hover:text-ink bg-panel",
                  )}
                >
                  {row.on ? (
                    <CheckIcon aria-hidden className="size-3.5" />
                  ) : (
                    <PlusIcon aria-hidden className="size-3.5" />
                  )}
                  {row.skill.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
