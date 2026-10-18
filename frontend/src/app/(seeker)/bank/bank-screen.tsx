"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { setScoutOpen, useScout } from "@/components/scout/scout-store";
import { ScoutTakeover } from "@/components/scout/scout-takeover";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import {
  addSkill,
  createEntry,
  deleteEntry,
  deleteSkill,
  entryResumeCount,
  getBank,
  linkSkill,
  unlinkSkill,
  updateSkill,
  type Bank,
  type BankEntry,
  type Section,
  type Skill,
} from "@/lib/bank-actions";

import { DeleteConfirm } from "../resumes/delete-confirm";
import { EntryEditor } from "./entry-editor";
import { editSteps, type SaveStep } from "./entry-save";
import { Intake, type IntakeFocus } from "./intake";
import {
  draftOf,
  emptyDraft,
  entryDetails,
  formatDates,
  missingFacts,
  SECTIONS,
  type EntryDraft,
} from "./sections";
import { linkChanges } from "./skill-links";

/**
 * The bank page's live screen: one card per section, each entry with its
 * bullets, and the skills list. Every change goes to the API and the bank is
 * read back afterwards, so the order shown is always the API's (ongoing
 * first, then newest). A failed call shows its message beside the control
 * and leaves the screen as it was.
 *
 * Intake is not on the page: it takes over Scout's panel (docked), opened
 * from the bar's launcher or the title's Fill With Scout, so the page is the
 * bank itself. `autoImport` (the Jobs page's Import Your Resume) opens the
 * panel on arrival, since the student clicked to get there, and drops
 * ?import=1 so a reload or Back does not open it again. An empty bank gets
 * no card of its own: the title's Fill With Scout and each section's Add
 * already say where to start.
 */

type Editing = { kind: "new"; section: Section } | { kind: "edit"; entry: BankEntry } | null;

export function BankScreen({
  initial,
  autoImport = false,
}: {
  initial: Bank;
  autoImport?: boolean;
}) {
  const [bank, setBank] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BankEntry | null>(null);
  // An error that outlives the editor: a bullet that failed after the
  // entry's fields saved, or a failed read-back.
  const [pageError, setPageError] = useState<string | null>(null);
  // What Scout is working on, marked on the page while its panel is open,
  // as Gemini in Docs and Grammarly mark the text their panel acts on.
  const [focus, setFocus] = useState<IntakeFocus | null>(null);
  const scoutOpen = useScout().open;
  const marked = scoutOpen ? focus : null;

  useEffect(() => {
    if (!autoImport) return;
    setScoutOpen(true);
    window.history.replaceState(null, "", "/bank");
  }, [autoImport]);

  async function reload(): Promise<string | null> {
    const { data, error } = await getBank();
    if (data) setBank(data);
    return error;
  }

  function open(next: Editing) {
    setEditing(next);
    setError(null);
    setDuplicate(null);
    setPageError(null);
  }

  /** The skill ids linked to an entry, from the skills' `entry_ids`. */
  const linkedTo = (entryId: string) =>
    bank.skills.filter((s) => s.entry_ids.includes(entryId)).map((s) => s.id);

  async function save(draft: EntryDraft, skillIds: string[], allowDuplicate = false) {
    setSaving(true);
    setError(null);
    const failed =
      editing?.kind === "edit"
        ? await saveEdit(editing.entry, draft, skillIds)
        : await saveNew(draft, skillIds, allowDuplicate);
    setSaving(false);
    if (failed === "duplicate" || failed === "closed") return;
    if (failed) return setError(failed);
    open(null);
    const reloadError = await reload();
    if (reloadError) setPageError(reloadError);
  }

  async function saveNew(draft: EntryDraft, skillIds: string[], allowDuplicate: boolean) {
    const { bullets, ...fields } = draft;
    const res = await createEntry(
      fields,
      bullets.map((b) => b.text),
      allowDuplicate,
    );
    if (res.duplicate) {
      setDuplicate(res.duplicate);
      return "duplicate" as const;
    }
    if (!res.entry) return res.error;
    const entryId = res.entry.id;
    // The entry is saved: a failed link closes the editor (a retry would
    // make the entry twice) and says so on the page.
    return runAfterSave(skillIds.map((skillId) => () => linkSkill(skillId, entryId)));
  }

  /** Steps that run once the entry itself has saved. On a failure the
   *  editor closes on the bank as it now is, since retrying from it would
   *  repeat the steps that worked. */
  async function runAfterSave(steps: (() => Promise<{ error: string | null }>)[]) {
    for (const step of steps) {
      const { error } = await step();
      if (!error) continue;
      open(null);
      await reload();
      setPageError(`Some changes did not save: ${error}`);
      return "closed" as const;
    }
    return null;
  }

  /** The fields and bullets as `editSteps` gives them, with the skill links
   *  and unlinks after the fields. */
  async function saveEdit(entry: BankEntry, draft: EntryDraft, skillIds: string[]) {
    const { link, unlink } = linkChanges(linkedTo(entry.id), skillIds);
    const [fields, ...bulletSteps] = editSteps(entry, draft);
    const steps: SaveStep[] = [
      fields,
      ...link.map((skillId) => () => linkSkill(skillId, entry.id)),
      ...unlink.map((skillId) => () => unlinkSkill(skillId, entry.id)),
      ...bulletSteps,
    ];
    for (const [i, step] of steps.entries()) {
      const { error } = await step();
      if (!error) continue;
      if (i === 0) return error; // Nothing saved yet: the editor stays open to fix it.
      // Some changes saved. Retrying from this editor would repeat them, so
      // it closes on the bank as it now is.
      open(null);
      await reload();
      setPageError(`Some changes did not save: ${error}`);
      return "closed" as const;
    }
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <ScoutTakeover title="Scout" subtitle="Fills your experience bank as you talk">
        <Intake
          filled={bank.entries.map((e) => e.section)}
          entries={bank.entries}
          walk
          importable
          autoImport={autoImport}
          onSaved={reload}
          docked
          onFocus={setFocus}
        />
      </ScoutTakeover>
      {pageError && (
        <p role="alert" className="text-note text-danger">
          {pageError}
        </p>
      )}
      {SECTIONS.map((section) => {
        const entries = bank.entries.filter((e) => e.section === section.id);
        const adding = editing?.kind === "new" && editing.section === section.id;
        const here = marked?.section === section.id ? marked : null;
        const scoutAdding = here !== null && !here.entryId;
        return (
          <Card
            as="section"
            key={section.id}
            aria-labelledby={`bank-${section.id}`}
            selected={here !== null}
            className="transition-colors duration-200"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`bank-${section.id}`} className="text-subtitle text-ink">
                {section.label}
              </h2>
              {!adding && (
                <Button
                  variant="section"
                  onClick={() => open({ kind: "new", section: section.id })}
                >
                  <Plus /> Add
                </Button>
              )}
            </div>

            {entries.length === 0 && !adding && !scoutAdding && (
              <p className="text-body text-ink-meta mt-2">Nothing here yet.</p>
            )}

            <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
              {entries.map((entry) => (
                <ScoutMarked key={entry.id} active={here?.entryId === entry.id}>
                  {editing?.kind === "edit" && editing.entry.id === entry.id ? (
                    <EntryEditor
                      initial={draftOf(entry)}
                      skills={bank.skills}
                      linkedSkillIds={linkedTo(entry.id)}
                      onSave={(draft, skillIds) => save(draft, skillIds)}
                      onCancel={() => open(null)}
                      saving={saving}
                      error={error}
                    />
                  ) : (
                    <EntryView
                      entry={entry}
                      onEdit={() => open({ kind: "edit", entry })}
                      onDeleted={reload}
                    />
                  )}
                </ScoutMarked>
              ))}
              {scoutAdding && (
                <ScoutMarked active>
                  <p className="text-body text-ink font-medium break-words">
                    {here.title || `New ${section.label} entry`}
                  </p>
                  <p className="text-note text-ink-meta">Filling in as you talk to Scout</p>
                </ScoutMarked>
              )}
            </ul>

            {adding && (
              <div className="mt-2">
                <EntryEditor
                  initial={emptyDraft(section.id)}
                  skills={bank.skills}
                  onSave={(draft, skillIds) => save(draft, skillIds)}
                  onCancel={() => open(null)}
                  saving={saving}
                  error={error}
                  duplicate={duplicate}
                  onSaveAsNew={(draft, skillIds) => save(draft, skillIds, true)}
                />
              </div>
            )}
          </Card>
        );
      })}

      <SkillsCard skills={bank.skills} reload={reload} />
    </div>
  );
}

/**
 * A bank row, marked while Scout works on it: a brand tint with a band of
 * light crossing it (`animate-shimmer`), and a scroll into view, so the
 * student sees which entry the panel's questions are about and that Scout
 * is at work on it. The shimmer replaced a "With Scout" tag (KAN-249), which
 * read as one more line of the entry rather than as Scout acting on it; a
 * screen reader still hears it. Reduced motion keeps the tint, still.
 */
function ScoutMarked({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, [active]);
  return (
    <li
      ref={ref}
      aria-current={active ? "true" : undefined}
      className={cn(
        // isolate: the band paints over the tint and under the text.
        "relative isolate -mx-3 scroll-my-24 overflow-hidden rounded-xl px-3 py-3 transition-colors duration-200",
        active && "bg-brand-tint/70",
      )}
    >
      {active && (
        <>
          <span
            aria-hidden
            className="animate-shimmer via-panel/80 pointer-events-none absolute inset-0 -z-10 bg-linear-[110deg] from-transparent from-35% via-50% to-transparent to-65% bg-[length:200%_100%]"
          />
          <span className="sr-only">Scout is working on this entry.</span>
        </>
      )}
      {children}
    </li>
  );
}

function EntryView({
  entry,
  onEdit,
  onDeleted,
}: {
  entry: BankEntry;
  onEdit: () => void;
  onDeleted: () => Promise<string | null>;
}) {
  // The delete confirm, with how many built resumes show the entry (story 18).
  const [confirming, setConfirming] = useState<{ resumes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dates = formatDates(entry);
  const missing = missingFacts(entry);
  const place = [entry.organization, entry.location].filter(Boolean).join(" · ");
  const details = entryDetails(entry);

  async function confirm() {
    setError(null);
    const { data, error } = await entryResumeCount(entry.id);
    if (data == null) return setError(error);
    setConfirming({ resumes: data });
  }

  async function remove() {
    const res = await deleteEntry(entry.id);
    if (res.error) return setError(res.error);
    const reloadError = await onDeleted();
    if (reloadError) setError(reloadError);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-ink font-medium break-words">{entry.title}</p>
          {/* A narrow column puts the dates under the title: beside it, they
              never shrink and left the title a few letters wide on a phone. */}
          {dates && <p className="text-note text-ink-meta @xl/main:hidden">{dates}</p>}
          {place && <p className="text-note text-ink-muted break-words">{place}</p>}
          {details.map((line) => (
            <p key={line} className="text-note text-ink-meta break-words">
              {line}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dates && <span className="text-note text-ink-meta hidden @xl/main:inline">{dates}</span>}
          <IconButton label="Edit Entry" tooltip="Edit this entry" onClick={onEdit}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label="Delete Entry" tooltip="Delete this entry" onClick={confirm}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>

      {entry.bullets.length > 0 && (
        <ul className="text-body text-ink-muted mt-1.5 flex list-disc flex-col gap-1 pl-5">
          {entry.bullets.map((b) => (
            <li key={b.id} className="break-words">
              {b.text}
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="text-note text-warning mt-1">
          No {missing.join(" or ")} yet. Add {missing.length > 1 ? "them" : "it"} before you
          Generate a resume.
        </p>
      )}

      {confirming && (
        <DeleteConfirm label="Delete Entry" onDelete={remove} onKeep={() => setConfirming(null)}>
          Delete this entry and its bullets?{" "}
          {confirming.resumes === 0
            ? "No built resume shows it."
            : confirming.resumes === 1
              ? "It comes off the 1 built resume that shows it."
              : `It comes off all ${confirming.resumes} built resumes that show it.`}
        </DeleteConfirm>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The skills, one row per group. Drawn as the section cards are: Add at the
 * top right opens the form, so the card is a list until the student adds or
 * edits a skill; a form always open under the list made Skills the only card
 * that never looked finished. The form stays open after an add, for the next
 * skill, and closes after an edit.
 */
function SkillsCard({ skills, reload }: { skills: Skill[]; reload: () => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const formOpen = adding || editingId !== null;

  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const key = skill.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), skill]);
  }

  function close() {
    setName("");
    setGroup("");
    setAdding(false);
    setEditingId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const groupValue = group.trim() || null;
    const res = editingId
      ? await updateSkill(editingId, { name, group: groupValue })
      : await addSkill(name, groupValue);
    setBusy(false);
    if (res.error) return setError(res.error);
    setError(null);
    if (editingId) {
      close();
    } else {
      // Ready for the next one, in the same group.
      setName("");
      nameField.current?.focus();
    }
    const reloadError = await reload();
    if (reloadError) setError(reloadError);
  }

  async function remove(skill: Skill) {
    const res = await deleteSkill(skill.id);
    if (res.error) return setError(res.error);
    setError(null);
    if (editingId === skill.id) close();
    const reloadError = await reload();
    if (reloadError) setError(reloadError);
  }

  return (
    <Card as="section" aria-labelledby="bank-skills">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bank-skills" className="text-subtitle text-ink">
          Skills
        </h2>
        {!formOpen && (
          <Button
            variant="section"
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
          >
            <Plus /> Add
          </Button>
        )}
      </div>
      {skills.length === 0 && !formOpen && (
        <p className="text-body text-ink-meta mt-2">Nothing here yet.</p>
      )}
      {/* The group names make one column where there is room, so every
          group's skills start at the same edge; on a phone each name sits
          over its skills. */}
      {skills.length > 0 && (
        <dl className="mt-2 grid gap-x-4 gap-y-2 @md/main:grid-cols-[max-content_minmax(0,1fr)]">
          {[...groups].map(([groupName, members]) => (
            <div key={groupName} className="contents">
              <dt className="text-label text-ink-muted @md/main:pt-1">{groupName || "Other"}</dt>
              <dd className="flex flex-wrap gap-2">
                {members.map((skill) => (
                  <span
                    key={skill.id}
                    className={cn(
                      "rounded-control text-note text-ink inline-flex items-center gap-1.5 border px-2 py-1",
                      editingId === skill.id ? "border-brand" : "border-border-subtle",
                    )}
                  >
                    {skill.name}
                    <IconButton
                      label={`Edit ${skill.name}`}
                      tooltip="Edit this skill"
                      onClick={() => {
                        setError(null);
                        setAdding(false);
                        setEditingId(skill.id);
                        setName(skill.name);
                        setGroup(skill.group ?? "");
                      }}
                    >
                      <Pencil className="size-3" />
                    </IconButton>
                    <IconButton
                      label={`Remove ${skill.name}`}
                      tooltip="Remove this skill"
                      onClick={() => remove(skill)}
                    >
                      <X className="size-3" />
                    </IconButton>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {formOpen && (
        <form
          onSubmit={submit}
          className="mt-3 grid items-end gap-3 @lg/main:grid-cols-[1fr_1fr_auto]"
        >
          <TextField
            ref={nameField}
            id="skill-name"
            label="Skill"
            required
            autoFocus
            maxLength={60}
            placeholder="Python"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="skill-group"
            label="Group"
            maxLength={60}
            placeholder="Languages"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {editingId ? "Cancel" : "Done"}
            </Button>
            <Button type="submit" disabled={busy}>
              {editingId ? "Save Skill" : "Add Skill"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}
