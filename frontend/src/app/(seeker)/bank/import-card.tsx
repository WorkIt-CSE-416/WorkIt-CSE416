"use client";

import { Pencil, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import {
  addSkill,
  createEntry,
  importResume,
  type DraftEntry,
  type DraftSkill,
} from "@/lib/bank-actions";

import { EntryEditor } from "./entry-editor";
import { entryDetails, formatDates, sectionOf, type EntryDraft } from "./sections";

/**
 * "Import Your Resume" (KAN-211): reads the student's uploaded resume (the
 * default one, else the newest) into draft entries and skills. Nothing is in
 * the bank until the student saves a draft, one by one or with Save All. A
 * draft that matches a bank entry says "Already in Your Bank"; Save All skips
 * it, and its own button saves it as a new entry. Edit opens the shared entry
 * editor on the draft. Each save reads the bank again through `onSaved`.
 *
 * Model parsing (KAN-222): the API reads the resume with AI when the parser
 * finds no entries, and "Read It Again with AI" asks for that reading on
 * purpose while the student has an AI reading left today. The AI drafts
 * replace the shown ones; a failed AI reading keeps them and shows why.
 *
 * It opens inside intake's chat (`onClose` given): Close is always there,
 * and a Save All that leaves nothing to check closes it, so the walk goes
 * on to ask about what the resume did not say.
 */

type Row = DraftEntry & { key: number; error?: string | null };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the draft
const toEditor = ({ bullets, key, error, duplicate_of, ...fields }: Row): EntryDraft => ({
  ...fields,
  bullets: bullets.map((text) => ({ text })),
});

export function ImportCard({
  onSaved,
  autoStart = false,
  onClose,
  resumeId,
}: {
  onSaved: () => Promise<string | null>;
  /** Hands the space back to intake's chat. */
  onClose?: () => void;
  /** Read this upload, not the default one: the file just uploaded. */
  resumeId?: string;
  /** Start the import on mount: the Jobs page's one-click "Import Your Resume". */
  autoStart?: boolean;
}) {
  const [filename, setFilename] = useState<string | null>(null);
  const [readBy, setReadBy] = useState<"parser" | "model">("parser");
  const [usesLeft, setUsesLeft] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skills, setSkills] = useState<DraftSkill[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drafts Save All left for the student to check (a duplicate, a failure).
  const rowsLeft = useRef(0);

  async function runImport(readWithAi = false) {
    setBusy(true);
    setError(null);
    const { data, error } = await importResume({ resumeId, readWithAi });
    setBusy(false);
    if (!data) return setError(error);
    setFilename(data.filename);
    setReadBy(data.read_by);
    setUsesLeft(data.uses_left);
    setRows(data.entries.map((entry, key) => ({ ...entry, key })));
    setSkills(data.skills);
    setEditing(null);
  }

  // Once, even under Strict Mode's double mount.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void runImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);

  function close() {
    if (onClose) return onClose();
    setRows(null);
    setSkills([]);
    setEditing(null);
    setError(null);
  }

  const patch = (key: number, changes: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...changes } : r)) ?? null);

  /** Saves one draft. True when it is in the bank now. */
  async function saveRow(row: Row, draft: EntryDraft, allowDuplicate: boolean): Promise<boolean> {
    const { bullets, ...fields } = draft;
    const res = await createEntry(
      fields,
      bullets.map((b) => b.text),
      allowDuplicate,
    );
    if (res.duplicate) {
      patch(row.key, { duplicate_of: res.duplicate.id, error: null });
      return false;
    }
    if (res.error) {
      patch(row.key, { error: res.error });
      return false;
    }
    setRows((prev) => prev?.filter((r) => r.key !== row.key) ?? null);
    return true;
  }

  async function saveOne(row: Row, draft: EntryDraft = toEditor(row)) {
    setBusy(true);
    const saved = await saveRow(row, draft, row.duplicate_of !== null);
    if (saved) setEditing(null);
    setBusy(false);
    if (saved) await reload();
  }

  async function saveSkill(skill: DraftSkill): Promise<boolean> {
    const res = await addSkill(skill.name, skill.group);
    // A 409 means it is in the bank already, which is what was asked.
    if (res.error && !res.error.toLowerCase().includes("already")) {
      setError(res.error);
      return false;
    }
    setSkills((prev) => prev.map((s) => (s.name === skill.name ? { ...s, in_bank: true } : s)));
    return true;
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setEditing(null);
    let any = false;
    let left = 0;
    for (const row of rows ?? []) {
      if (row.duplicate_of === null && (await saveRow(row, toEditor(row), false))) any = true;
      else left++;
    }
    rowsLeft.current = left;
    for (const skill of skills) {
      if (!skill.in_bank) any = (await saveSkill(skill)) || any;
    }
    setBusy(false);
    if (any) await reload();
    if (onClose && !rowsLeft.current) onClose();
  }

  async function reload() {
    const reloadError = await onSaved();
    if (reloadError) setError(reloadError);
  }

  const newSkills = skills.filter((s) => !s.in_bank);
  const savable = (rows ?? []).filter((r) => r.duplicate_of === null).length + newSkills.length;

  return (
    <Card as="section" aria-labelledby="bank-import">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bank-import" className="text-subtitle text-ink">
          Import Your Resume
        </h2>
        {(rows || onClose) && (
          <Button variant="section" onClick={close}>
            <X /> Close
          </Button>
        )}
      </div>

      {!rows && (
        <>
          <p className="text-body text-ink-meta mt-1">
            Turn your uploaded resume into draft entries. You check each one, and nothing is saved
            until you do. No resume yet?{" "}
            <Link href="/profile" className="text-brand hover:text-brand-hover underline">
              Upload one on My Profile.
            </Link>
          </p>
          <Button className="mt-3" onClick={() => runImport()} disabled={busy}>
            {busy ? "Reading…" : "Import"}
          </Button>
        </>
      )}

      {rows && (
        <p className="text-body text-ink-meta mt-1">
          {rows.length + skills.length === 0
            ? `We couldn't find any entries in ${filename ?? "your resume"}. Add them by hand below.`
            : `From ${filename ?? "your resume"}${readBy === "model" ? ", read with AI" : ""}. Check each draft, then save it.`}
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
          {rows.map((row) => (
            <li key={row.key} className="py-3">
              {editing === row.key ? (
                <EntryEditor
                  initial={toEditor(row)}
                  onSave={(draft) => saveOne(row, draft)}
                  onCancel={() => setEditing(null)}
                  saving={busy}
                  error={row.error}
                  duplicate={row.duplicate_of ? row : null}
                  onSaveAsNew={(draft) => saveOne(row, draft)}
                />
              ) : (
                <DraftView
                  row={row}
                  busy={busy}
                  onSave={() => saveOne(row)}
                  onEdit={() => setEditing(row.key)}
                  onSkip={() => setRows((prev) => prev?.filter((r) => r.key !== row.key) ?? null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {skills.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-label text-ink-muted">Skills:</span>
          {skills.map((skill) => (
            <span
              key={skill.name}
              className="rounded-control border-border-subtle text-note text-ink inline-flex items-center gap-1.5 border px-2 py-1"
            >
              {skill.name}
              {skill.in_bank ? (
                <span className="text-ink-meta">(in your bank)</span>
              ) : (
                <IconButton
                  label={`Add ${skill.name}`}
                  tooltip="Add this skill to your bank"
                  disabled={busy}
                  onClick={async () => {
                    if (await saveSkill(skill)) await reload();
                  }}
                >
                  <Plus className="size-3" />
                </IconButton>
              )}
            </span>
          ))}
        </div>
      )}

      {rows && (savable > 0 || usesLeft > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {savable > 0 && (
            <Button onClick={saveAll} disabled={busy}>
              Save All
            </Button>
          )}
          {usesLeft > 0 && (
            <Button variant="secondary" onClick={() => runImport(true)} disabled={busy}>
              <Sparkles /> {busy ? "Reading…" : "Read It Again with AI"}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}

function DraftView({
  row,
  busy,
  onSave,
  onEdit,
  onSkip,
}: {
  row: Row;
  busy: boolean;
  onSave: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  const dates = formatDates(row);
  const place = [row.organization, row.location].filter(Boolean).join(" · ");
  return (
    <div className="@container">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-note text-ink-meta">{sectionOf(row.section).label}</span>
            {row.duplicate_of && (
              <Badge variant="tag" tone="warning">
                Already in Your Bank
              </Badge>
            )}
          </div>
          <p className="text-body text-ink font-medium break-words">{row.title}</p>
          {/* Under the title in a phone-wide panel, as on the bank page. */}
          {dates && <p className="text-note text-ink-meta @sm:hidden">{dates}</p>}
          {place && <p className="text-note text-ink-muted break-words">{place}</p>}
          {entryDetails(row).map((line) => (
            <p key={line} className="text-note text-ink-meta break-words">
              {line}
            </p>
          ))}
        </div>
        {dates && (
          <span className="text-note text-ink-meta hidden shrink-0 @sm:inline">{dates}</span>
        )}
      </div>

      {row.bullets.length > 0 && (
        <ul className="text-body text-ink-muted mt-1.5 flex list-disc flex-col gap-1 pl-5">
          {row.bullets.map((text, i) => (
            <li key={i} className="break-words">
              {text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={row.duplicate_of ? "secondary" : "default"}
          onClick={onSave}
          disabled={busy}
        >
          {row.duplicate_of ? "Save as New" : "Save"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy}>
          <Pencil /> Edit
        </Button>
        <Button size="sm" variant="secondary" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
      </div>
      {row.error && (
        <p role="alert" className="text-note text-danger mt-1">
          {row.error}
        </p>
      )}
    </div>
  );
}
