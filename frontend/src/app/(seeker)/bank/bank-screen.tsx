"use client";

import { PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

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
  deleteEntries,
  deleteEntry,
  deleteSkill,
  deleteSkills,
  entryResumeCount,
  getBank,
  importResume,
  updateSkill,
  type Bank,
  type BankEntry,
  type BankResume,
  type Section,
  type Skill,
} from "@/lib/bank-actions";

import { DeleteConfirm } from "../resumes/delete-confirm";
import { ClearAll } from "./clear-all";
import { EntryEditor } from "./entry-editor";
import { editSteps } from "./entry-save";
import { holderOf, NONE, openingPick, shows, uploadIds, usedIn, type Pick } from "./holdings";
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
import { ResumePicker } from "./resume-picker";

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
 *
 * The resume dropdown (KAN-343, docs/bank_by_resume.md) shows one resume's
 * entries and skills at a time: it opens on the URL's `?resume=`, else the
 * starred resume, else the newest. An upload's entries are its own (ADR
 * 0005); a built resume's are the ones it shows, which an entry's "Also used
 * in" line names. Not From an Upload shows what no upload owns, so nothing
 * in the bank is out of reach. Add saves into the picked resume (or into no
 * upload, under Not From an Upload), so the new item stays in view. A
 * student with no resume sees the whole bank and no dropdown. Intake always
 * sees the whole bank.
 */

type Editing = { kind: "new"; section: Section } | { kind: "edit"; entry: BankEntry } | null;

export function BankScreen({
  initial,
  autoImport = false,
  resumeParam,
}: {
  initial: Bank;
  autoImport?: boolean;
  /** The URL's `?resume=`: a resume id or "none". */
  resumeParam?: string;
}) {
  const [bank, setBank] = useState(initial);
  const [pick, setPick] = useState<Pick>(() => openingPick(initial.resumes, resumeParam));
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BankEntry | null>(null);
  // The section whose Clear All confirm is open (KAN-352).
  const [clearing, setClearing] = useState<Section | null>(null);
  // An error that outlives the editor: a bullet that failed after the
  // entry's fields saved, or a failed read-back.
  const [pageError, setPageError] = useState<string | null>(null);
  // What Scout is working on, marked on the page while its panel is open,
  // as Gemini in Docs and Grammarly mark the text their panel acts on.
  const [focus, setFocus] = useState<IntakeFocus | null>(null);
  const scoutOpen = useScout().open;
  const marked = scoutOpen ? focus : null;

  const uploads = useMemo(() => uploadIds(bank.resumes), [bank.resumes]);
  // A resume deleted since the pick reads as the page's opening pick.
  const current =
    (pick === NONE && bank.resumes.length > 0) || bank.resumes.some((r) => r.id === pick)
      ? pick
      : openingPick(bank.resumes, undefined);
  const picked = bank.resumes.find((r) => r.id === current) ?? null;
  const anyUnowned =
    bank.entries.some((e) => shows(NONE, e, uploads)) ||
    bank.skills.some((s) => shows(NONE, s, uploads));
  const ownsNothing =
    picked?.kind === "uploaded" &&
    !bank.entries.some((e) => e.resume_ids.includes(picked.id)) &&
    !bank.skills.some((s) => s.resume_ids.includes(picked.id));

  // The pick goes in the URL, so a reload or a shared link keeps it; the
  // opening pick is left out, so arriving rewrites nothing.
  const urlPick = useRef(pick);
  useEffect(() => {
    if (pick === urlPick.current) return;
    urlPick.current = pick;
    const url = new URL(window.location.href);
    url.searchParams.set("resume", pick);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [pick]);

  // Scout works on the whole bank: an entry it visits that the pick hides
  // switches the page to a resume that holds it, or to Not From an Upload,
  // so the mark and the scroll land.
  const markedEntryRow = bank.entries.find((e) => e.id === marked?.entryId);
  const holder =
    markedEntryRow && !shows(current, markedEntryRow, uploads)
      ? holderOf(markedEntryRow, bank.resumes)
      : null;
  // Set during render, as React's "adjusting state when a prop changes"
  // does: the next render's pick holds the entry, so this runs once.
  if (holder) setPick(holder);

  // Scout moving to another section (a step chip, or a save or Skip moving
  // on) brings that section's top into view, its heading first (KAN-257).
  // The marked row used to scroll itself to the nearest edge, which landed
  // the page on a section's foot or middle. Within one section, the next
  // entry Scout visits scrolls only as far as it needs to be seen.
  const markedSection = marked?.section;
  const markedEntry = marked?.entryId;
  const lastSection = useRef<Section | undefined>(undefined);
  useEffect(() => {
    const moved = markedSection !== lastSection.current;
    lastSection.current = markedSection;
    if (!markedSection) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    const target = moved
      ? document.getElementById(`section-${markedSection}`)
      : markedEntry
        ? document.getElementById(`entry-${markedEntry}`)
        : null;
    target?.scrollIntoView({ block: moved ? "start" : "nearest", behavior });
  }, [markedSection, markedEntry]);

  useEffect(() => {
    if (!autoImport) return;
    setScoutOpen(true);
    // Drop ?import=1 only, keeping a ?resume= pick.
    const url = new URL(window.location.href);
    url.searchParams.delete("import");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
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

  async function save(draft: EntryDraft, allowDuplicate = false) {
    setSaving(true);
    setError(null);
    const failed =
      editing?.kind === "edit"
        ? await saveEdit(editing.entry, draft)
        : await saveNew(draft, allowDuplicate);
    setSaving(false);
    if (failed === "duplicate" || failed === "closed") return;
    if (failed) return setError(failed);
    open(null);
    const reloadError = await reload();
    if (reloadError) setPageError(reloadError);
  }

  async function saveNew(draft: EntryDraft, allowDuplicate: boolean) {
    const { bullets, ...fields } = draft;
    // Into the picked resume, so the new entry shows under it (ADR 0005).
    const res = await createEntry(
      fields,
      bullets.map((b) => b.text),
      allowDuplicate,
      picked?.id,
    );
    if (res.duplicate) {
      setDuplicate(res.duplicate);
      return "duplicate" as const;
    }
    if (!res.entry) return res.error;
    return null;
  }

  /** The fields, then the bullets, as `editSteps` gives them. */
  async function saveEdit(entry: BankEntry, draft: EntryDraft) {
    for (const [i, step] of editSteps(entry, draft).entries()) {
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
      {bank.resumes.length > 0 && (
        <ResumePicker
          resumes={bank.resumes}
          value={current}
          showNone={anyUnowned}
          onChange={setPick}
        />
      )}
      {pageError && (
        <p role="alert" className="text-note text-danger">
          {pageError}
        </p>
      )}
      {picked && ownsNothing && <LinkUpload resumeId={picked.id} reload={reload} />}
      {SECTIONS.map((section) => {
        const entries = bank.entries.filter(
          (e) => e.section === section.id && shows(current, e, uploads),
        );
        const adding = editing?.kind === "new" && editing.section === section.id;
        const here = marked?.section === section.id ? marked : null;
        return (
          <Card
            as="section"
            key={section.id}
            id={`section-${section.id}`}
            aria-labelledby={`bank-${section.id}`}
            selected={here !== null}
            // 16px of room above the heading when Scout scrolls it to the top.
            className="scroll-mt-4 transition-colors duration-200"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`bank-${section.id}`} className="text-subtitle text-ink">
                {section.label}
              </h2>
              <div className="flex items-baseline gap-4">
                {entries.length > 0 && !adding && clearing !== section.id && (
                  <Button variant="section" onClick={() => setClearing(section.id)}>
                    <TrashIcon aria-hidden /> Clear All
                  </Button>
                )}
                {!adding && (
                  <Button
                    variant="section"
                    onClick={() => open({ kind: "new", section: section.id })}
                  >
                    <PlusIcon aria-hidden /> Add
                  </Button>
                )}
              </div>
            </div>

            {clearing === section.id && entries.length > 0 && (
              <ClearAll
                items={entries}
                resumes={bank.resumes}
                noun={[`${section.label} entry`, `${section.label} entries`]}
                bullets
                pick={current}
                remove={deleteEntries}
                onCleared={async () => {
                  setClearing(null);
                  const reloadError = await reload();
                  if (reloadError) setPageError(reloadError);
                }}
                onKeep={() => setClearing(null)}
              />
            )}

            {entries.length === 0 && !adding && (
              <p className="text-body text-ink-meta mt-2">
                {picked ? "Nothing from this resume." : "Nothing here yet."}
              </p>
            )}

            <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
              {entries.map((entry) => (
                <ScoutMarked
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  active={here?.entryId === entry.id}
                >
                  {editing?.kind === "edit" && editing.entry.id === entry.id ? (
                    <EntryEditor
                      initial={draftOf(entry)}
                      onSave={(draft) => save(draft)}
                      onCancel={() => open(null)}
                      saving={saving}
                      error={error}
                    />
                  ) : (
                    <EntryView
                      entry={entry}
                      usedIn={usedIn(current, entry, bank.resumes)}
                      onEdit={() => open({ kind: "edit", entry })}
                      onDeleted={reload}
                    />
                  )}
                </ScoutMarked>
              ))}
            </ul>

            {adding && (
              <div className="mt-2">
                <EntryEditor
                  initial={emptyDraft(section.id)}
                  onSave={(draft) => save(draft)}
                  onCancel={() => open(null)}
                  saving={saving}
                  error={error}
                  duplicate={duplicate}
                  onSaveAsNew={(draft) => save(draft, true)}
                />
              </div>
            )}
          </Card>
        );
      })}

      <SkillsCard
        skills={bank.skills.filter((s) => shows(current, s, uploads))}
        resumeId={picked?.id}
        resumes={bank.resumes}
        pick={current}
        reload={reload}
      />
    </div>
  );
}

/**
 * An upload that owns nothing: one from before ADR 0005 whose entries came
 * from several uploads, or one whose entries the student deleted. Import
 * Again reads it once more into entries of its own.
 */
function LinkUpload({
  resumeId,
  reload,
}: {
  resumeId: string;
  reload: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setError(null);
    const res = await importResume({ resumeId });
    const reloadError = res.error ?? (await reload());
    setBusy(false);
    if (reloadError) setError(reloadError);
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-body text-ink-muted">This resume has no entries in your bank yet.</p>
      <Button variant="secondary" onClick={link} disabled={busy}>
        Import Again
      </Button>
      {error && (
        <p role="alert" className="text-note text-danger w-full">
          {error}
        </p>
      )}
    </Card>
  );
}

/**
 * A bank row, marked while Scout visits it: a brand tint with a band of
 * light crossing it (`animate-shimmer`), so the student sees which entry the
 * panel's questions are about and that Scout is at work on it. The page
 * scrolls it into view (BankScreen). The shimmer replaced a "With Scout" tag
 * (KAN-249), which read as one more line of the entry rather than as Scout
 * acting on it; a screen reader still hears it. Reduced motion keeps the
 * tint, still. A new entry gets no row: the section card's brand outline
 * says where Scout is (KAN-257), and a "New Education entry, Filling in as
 * you talk to Scout" row only repeated it.
 */
function ScoutMarked({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <li
      id={id}
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
  usedIn,
  onEdit,
  onDeleted,
}: {
  entry: BankEntry;
  /** "Also used in …": the built resumes an edit here changes too. */
  usedIn: string | null;
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
          {usedIn && <p className="text-note text-ink-meta break-words">{usedIn}</p>}
          {details.map((line) => (
            <p key={line} className="text-note text-ink-meta break-words">
              {line}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dates && <span className="text-note text-ink-meta hidden @xl/main:inline">{dates}</span>}
          <IconButton label="Edit Entry" tooltip="Edit this entry" onClick={onEdit}>
            <PencilSimpleIcon aria-hidden className="size-4" />
          </IconButton>
          <IconButton label="Delete Entry" tooltip="Delete this entry" onClick={confirm}>
            <TrashIcon aria-hidden className="size-4" />
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
function SkillsCard({
  skills,
  resumeId,
  resumes,
  pick,
  reload,
}: {
  skills: Skill[];
  /** The picked resume: a skill added here goes into it. */
  resumeId: string | undefined;
  /** For Clear All's confirm. */
  resumes: BankResume[];
  pick: Pick;
  reload: () => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
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
      : await addSkill(name, groupValue, resumeId);
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
        <div className="flex items-baseline gap-4">
          {skills.length > 0 && !formOpen && !clearing && (
            <Button variant="section" onClick={() => setClearing(true)}>
              <TrashIcon aria-hidden /> Clear All
            </Button>
          )}
          {!formOpen && (
            <Button
              variant="section"
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden /> Add
            </Button>
          )}
        </div>
      </div>
      {clearing && skills.length > 0 && (
        <ClearAll
          items={skills}
          resumes={resumes}
          noun={["skill", "skills"]}
          pick={pick}
          remove={deleteSkills}
          onCleared={async () => {
            setClearing(false);
            const reloadError = await reload();
            if (reloadError) setError(reloadError);
          }}
          onKeep={() => setClearing(false)}
        />
      )}
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
                      <PencilSimpleIcon aria-hidden className="size-3" />
                    </IconButton>
                    <IconButton
                      label={`Remove ${skill.name}`}
                      tooltip="Remove this skill"
                      onClick={() => remove(skill)}
                    >
                      <XIcon aria-hidden className="size-3" />
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
