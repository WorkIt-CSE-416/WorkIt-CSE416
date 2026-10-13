"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { TextField } from "@/components/ui/text-field";
import {
  addBullet,
  addSkill,
  createEntry,
  deleteBullet,
  deleteEntry,
  deleteSkill,
  getBank,
  linkSkill,
  unlinkSkill,
  updateBullet,
  updateEntry,
  updateSkill,
  type Bank,
  type BankEntry,
  type Section,
  type Skill,
} from "@/lib/bank-actions";

import { EntryEditor } from "./entry-editor";
import { ImportCard } from "./import-card";
import { Intake } from "./intake";
import { changesOf, draftOf, emptyDraft, formatDates, SECTIONS, type EntryDraft } from "./sections";
import { linkChanges } from "./skill-links";

/**
 * The bank page's live screen: one card per section, each entry with its
 * bullets, and the skills list. Every change goes to the API and the bank is
 * read back afterwards, so the order shown is always the API's (ongoing
 * first, then newest). A failed call shows its message beside the control
 * and leaves the screen as it was.
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

  /** The fields go in one PATCH; the bullets as the adds, edits and
   *  deletes that turn the saved list into the draft's. */
  async function saveEdit(entry: BankEntry, draft: EntryDraft, skillIds: string[]) {
    const { bullets } = draft;
    const { link, unlink } = linkChanges(linkedTo(entry.id), skillIds);
    const steps: (() => Promise<{ error: string | null }>)[] = [
      () => updateEntry(entry.id, changesOf(draft)),
      ...link.map((skillId) => () => linkSkill(skillId, entry.id)),
      ...unlink.map((skillId) => () => unlinkSkill(skillId, entry.id)),
      ...entry.bullets
        .filter((saved) => !bullets.some((b) => b.id === saved.id))
        .map((saved) => () => deleteBullet(saved.id)),
      ...bullets.flatMap((b) => {
        if (!b.id) return [() => addBullet(entry.id, b.text)];
        const saved = entry.bullets.find((s) => s.id === b.id);
        return saved && saved.text !== b.text ? [() => updateBullet(b.id!, { text: b.text })] : [];
      }),
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
      <ImportCard onSaved={reload} autoStart={autoImport} />
      <Intake
        filled={bank.entries.map((e) => e.section)}
        walk={initial.entries.length === 0}
        onSaved={reload}
      />
      {pageError && (
        <p role="alert" className="text-note text-danger">
          {pageError}
        </p>
      )}
      {SECTIONS.map((section) => {
        const entries = bank.entries.filter((e) => e.section === section.id);
        const adding = editing?.kind === "new" && editing.section === section.id;
        return (
          <Card as="section" key={section.id} aria-labelledby={`bank-${section.id}`}>
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

            {entries.length === 0 && !adding && (
              <p className="text-body text-ink-meta mt-2">Nothing here yet.</p>
            )}

            <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="py-3">
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
                </li>
              ))}
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

function EntryView({
  entry,
  onEdit,
  onDeleted,
}: {
  entry: BankEntry;
  onEdit: () => void;
  onDeleted: () => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dates = formatDates(entry);
  const place = [entry.organization, entry.location].filter(Boolean).join(" · ");
  const degree = [entry.degree, entry.field_of_study].filter(Boolean).join(" in ");
  const gpa =
    entry.gpa != null ? `GPA ${entry.gpa}${entry.gpa_scale ? `/${entry.gpa_scale}` : ""}` : null;
  const details = [
    [degree, gpa].filter(Boolean).join(" · "),
    entry.coursework.length ? `Coursework: ${entry.coursework.join(", ")}` : null,
    entry.honors && `Honors: ${entry.honors}`,
    entry.issuer && `Issued by ${entry.issuer}`,
    entry.link,
  ].filter(Boolean);

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
          {place && <p className="text-note text-ink-muted break-words">{place}</p>}
          {details.map((line) => (
            <p key={line} className="text-note text-ink-meta break-words">
              {line}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dates && <span className="text-note text-ink-meta">{dates}</span>}
          <IconButton label="Edit Entry" tooltip="Edit this entry" onClick={onEdit}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            label="Delete Entry"
            tooltip="Delete this entry"
            onClick={() => setConfirming(true)}
          >
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

      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-note text-ink-muted">Delete this entry and its bullets?</span>
          <Button size="sm" variant="destructive" onClick={remove}>
            Delete Entry
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
            Keep It
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

function SkillsCard({ skills, reload }: { skills: Skill[]; reload: () => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    const key = skill.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), skill]);
  }

  function reset() {
    setName("");
    setGroup("");
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
    reset();
    const reloadError = await reload();
    if (reloadError) setError(reloadError);
  }

  async function remove(skill: Skill) {
    const res = await deleteSkill(skill.id);
    if (res.error) return setError(res.error);
    setError(null);
    if (editingId === skill.id) reset();
    const reloadError = await reload();
    if (reloadError) setError(reloadError);
  }

  return (
    <Card as="section" aria-labelledby="bank-skills">
      <h2 id="bank-skills" className="text-subtitle text-ink">
        Skills
      </h2>
      {skills.length === 0 && <p className="text-body text-ink-meta mt-2">Nothing here yet.</p>}
      <div className="mt-2 flex flex-col gap-2">
        {[...groups].map(([groupName, members]) => (
          <div key={groupName} className="flex flex-wrap items-center gap-2">
            <span className="text-label text-ink-muted">{groupName || "Other"}:</span>
            {members.map((skill) => (
              <span
                key={skill.id}
                className="rounded-control border-border-subtle text-note text-ink inline-flex items-center gap-1.5 border px-2 py-1"
              >
                {skill.name}
                <IconButton
                  label={`Edit ${skill.name}`}
                  tooltip="Edit this skill"
                  onClick={() => {
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
          </div>
        ))}
      </div>

      <form
        onSubmit={submit}
        className="mt-3 grid items-end gap-3 @lg/main:grid-cols-[1fr_1fr_auto]"
      >
        <TextField
          id="skill-name"
          label="Skill"
          required
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
          {editingId && (
            <Button type="button" variant="secondary" onClick={reset}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {editingId ? "Save Skill" : "Add Skill"}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}
