"use client";

import {
  FileTextIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import {
  Fragment,
  startTransition,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { setScoutOpen, useScout } from "@/components/scout/scout-store";
import { ScoutTakeover } from "@/components/scout/scout-takeover";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
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
import { EntryRow } from "./entry-row";
import { editSteps } from "./entry-save";
import {
  ALL,
  holderOf,
  openingPick,
  otherVersions,
  rowMatches,
  rowsOf,
  shows,
  skillMatches,
  skillRows,
  usedIn,
  type BankRow,
  type Pick,
} from "./holdings";
import { Intake, type IntakeFocus } from "./intake";
import { draftOf, emptyDraft, missingFacts, SECTIONS, type EntryDraft } from "./sections";
import { ResumeBar } from "./resume-bar";
import { SECTION_ICONS, SectionMark } from "./section-icons";
import { SectionNav } from "./section-nav";

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
 * no card of its own: the title's Fill With Scout and each section's +
 * already say where to start.
 *
 * It opens on All Experiences, the whole bank with copies shown once, so
 * nothing is out of reach (KAN-440). The Showing card (KAN-343, KAN-361,
 * docs/bank_by_resume.md) narrows it to one resume, picked from the shared
 * resume table (`resume-bar.tsx`), or the URL's `?resume=`. An upload's entries
 * are its own (ADR 0005); a built resume's are the ones it shows. Add saves
 * into the picked resume, or into no upload under All Experiences, so the new
 * item stays in view. A student with no resume sees no card. Intake always
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
  const [saved, setBank] = useState(initial);
  // What the page draws: the bank less any skill whose delete is still on
  // its way, so a removed skill leaves at once (KAN-388).
  const [bank, hideSkill] = useOptimistic(saved, (b, id: string) => ({
    ...b,
    skills: b.skills.filter((s) => s.id !== id),
  }));
  const [pick, setPick] = useState<Pick>(() => openingPick(initial.resumes, resumeParam));
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<BankEntry | null>(null);
  // The search box's words (KAN-440). It narrows what the page shows and
  // opens what it finds, since a word may be in a bullet.
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  // The section whose Clear All confirm is open (KAN-352).
  const [clearing, setClearing] = useState<Section | null>(null);
  // The section in edit mode (KAN-363): its entries show their pencils and
  // its heading holds Clear All. One at a time, as LinkedIn's details page.
  const [editMode, setEditMode] = useState<Section | null>(null);
  // An error that outlives the editor: a bullet that failed after the
  // entry's fields saved, or a failed read-back.
  const [pageError, setPageError] = useState<string | null>(null);
  // What Scout is working on, marked on the page while its panel is open,
  // as Gemini in Docs and Grammarly mark the text their panel acts on.
  const [focus, setFocus] = useState<IntakeFocus | null>(null);
  const scoutOpen = useScout().open;
  const marked = scoutOpen ? focus : null;

  // A resume deleted since the pick reads as the page's opening pick.
  const current = openingPick(bank.resumes, pick);
  const picked = bank.resumes.find((r) => r.id === current) ?? null;
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
  // switches the page to a resume that holds it, or to All Experiences, so
  // the mark and the scroll land.
  const markedEntryRow = bank.entries.find((e) => e.id === marked?.entryId);
  const holder =
    markedEntryRow && !shows(current, markedEntryRow)
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

  // What the page draws now: a group's entries under the pick, its rows, and
  // the skills, each narrowed by the search box.
  const entriesIn = (id: Section) =>
    bank.entries.filter((e) => e.section === id && shows(current, e));
  const rowsIn = (id: Section, prefer?: string) =>
    rowsOf(current, entriesIn(id), bank.resumes, (e) => e.id === prefer).filter(
      (row) => !searching || rowMatches(row, query),
    );
  const skillsNow = skillRows(
    current,
    bank.skills.filter((s) => shows(current, s)),
  ).filter((s) => !searching || skillMatches(s, query));
  // A group draws a card while it has rows, is being added to, or Scout is on it
  const drawn = (id: Section) =>
    rowsIn(id).length > 0 ||
    (editing?.kind === "new" && editing.section === id) ||
    marked?.section === id;
  const rowsFound = SECTIONS.reduce((n, s) => n + rowsIn(s.id).length, 0);
  const emptySections = SECTIONS.filter((s) => !drawn(s.id));
  const navSections = [
    ...SECTIONS.filter((s) => drawn(s.id)).map((s) => ({
      id: s.id,
      label: s.label,
      count: rowsIn(s.id).length,
    })),
    ...(searching && skillsNow.length === 0
      ? []
      : [{ id: "skills" as const, label: "Skills", count: skillsNow.length }]),
  ];

  async function reload(): Promise<string | null> {
    const { data, error } = await getBank();
    if (data) setBank(data);
    return error;
  }

  // The skill leaves the page first and the delete runs behind it
  // (KAN-388). A failed delete ends the transition with the skill still in
  // the bank, so it comes back, with the error. A delete changes nothing
  // else in the bank, so the page drops the skill itself and reads nothing
  // back.
  function removeSkill(id: string, onError: (error: string) => void) {
    startTransition(async () => {
      hideSkill(id);
      const { error } = await deleteSkill(id);
      if (error) return onError(error);
      setBank((b) => ({ ...b, skills: b.skills.filter((s) => s.id !== id) }));
    });
  }

  // An "Also on" name shows that resume (KAN-363). The entry it sat on is
  // on that resume too, so the page keeps it in view, not wherever the
  // swap of every card's content left the scroll.
  function showResume(id: string, entryId: string) {
    setPick(id);
    requestAnimationFrame(() =>
      document.getElementById(`entry-${entryId}`)?.scrollIntoView({ block: "nearest" }),
    );
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
        <ResumeBar resumes={bank.resumes} value={current} onChange={setPick} />
      )}
      {pageError && (
        <p role="alert" className="text-note text-danger">
          {pageError}
        </p>
      )}
      {picked && ownsNothing && <LinkUpload resumeId={picked.id} reload={reload} />}
      {(bank.entries.length > 0 || bank.skills.length > 0) && (
        <SearchField
          id="experiences-search"
          label="Search your experiences"
          placeholder="Search your experiences"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <SectionNav sections={navSections} />
      {SECTIONS.map((section) => {
        const entries = entriesIn(section.id);
        const adding = editing?.kind === "new" && editing.section === section.id;
        const here = marked?.section === section.id ? marked : null;
        const rows = rowsIn(section.id, here?.entryId);
        // A group with nothing in it is a word on the quiet line below
        if (!drawn(section.id)) return null;
        // An empty card has nothing to edit, so its last delete ends the mode.
        const editable = editMode === section.id && entries.length > 0;
        return (
          <Card
            as="section"
            key={section.id}
            id={`section-${section.id}`}
            aria-labelledby={`bank-${section.id}`}
            selected={here !== null}
            // Room for the section nav and 16px above the heading when Scout
            // or the nav scrolls it to the top.
            className="scroll-mt-16 transition-colors duration-200"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id={`bank-${section.id}`}
                className="text-subtitle text-ink flex min-w-0 items-center gap-2.5"
              >
                <SectionMark id={section.id} />
                {section.label}
              </h2>
              {!adding && (
                <SectionActions
                  name={section.label}
                  addLabel={`Add an Entry to ${section.label}`}
                  addTooltip="Add an entry"
                  hasItems={entries.length > 0}
                  editable={editable}
                  // A row in All Experiences stands for its copies, on
                  // several resumes, and a search hides rows the bulk delete
                  // would still take: Clear All belongs to one resume's view
                  clearable={current !== ALL && !searching}
                  clearing={clearing === section.id}
                  onAdd={() => open({ kind: "new", section: section.id })}
                  onEdit={() => setEditMode(section.id)}
                  onDone={() => {
                    setEditMode(null);
                    setClearing(null);
                  }}
                  onClear={() => setClearing(section.id)}
                />
              )}
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
                  setEditMode(null);
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
              {rows.map((row) => {
                const { entry } = row;
                return (
                  <ScoutMarked
                    key={entry.id}
                    id={`entry-${entry.id}`}
                    active={here?.entryId === entry.id}
                  >
                    {editing?.kind === "edit" && editing.entry.id === entry.id ? (
                      <EditEntry
                        entry={entry}
                        usedIn={usedIn(current, entry, bank.resumes)}
                        onShowResume={(id) => showResume(id, entry.id)}
                        saving={saving}
                        error={error}
                        onSave={(draft) => save(draft)}
                        onCancel={() => open(null)}
                        onDeleted={async () => {
                          open(null);
                          const reloadError = await reload();
                          if (reloadError) setPageError(reloadError);
                        }}
                      />
                    ) : (
                      <EntryView
                        row={row}
                        resumes={bank.resumes}
                        open={searching || here?.entryId === entry.id}
                        onEdit={editable ? () => open({ kind: "edit", entry }) : undefined}
                        onShowResume={showResume}
                      />
                    )}
                  </ScoutMarked>
                );
              })}
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

      {searching && rowsFound === 0 && skillsNow.length === 0 && (
        <p className="text-body text-ink-meta px-1">
          No experiences match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {/* Kept mounted while a search hides it: its form holds what is typed */}
      <div className={cn(searching && skillsNow.length === 0 && "hidden")}>
        <SkillsCard
          skills={skillsNow}
          resumeId={picked?.id}
          resumes={bank.resumes}
          pick={current}
          reload={reload}
          removeSkill={removeSkill}
        />
      </div>

      {!searching && emptySections.length > 0 && (
        <EmptySections
          sections={emptySections}
          picked={picked !== null}
          onAdd={(id) => {
            open({ kind: "new", section: id });
            requestAnimationFrame(() =>
              document.getElementById(`section-${id}`)?.scrollIntoView({ block: "start" }),
            );
          }}
        />
      )}
    </div>
  );
}

/**
 * The groups with nothing in them, as one quiet line under the page (KAN-440):
 * each took a full card that said "Nothing here yet", and three of them pushed
 * Skills off the screen. Each word adds to its group, which opens its card.
 */
function EmptySections({
  sections,
  picked,
  onAdd,
}: {
  sections: readonly { id: Section; label: string }[];
  /** A resume is picked, so the line says "from this resume". */
  picked: boolean;
  onAdd: (id: Section) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1">
      <span className="text-note text-ink-meta mr-1">
        {picked ? "Nothing from this resume in" : "Nothing yet in"}
      </span>
      {sections.map(({ id, label }) => {
        const Glyph = SECTION_ICONS[id];
        return (
          <Button
            key={id}
            variant="ghost"
            size="xs"
            aria-label={`Add an Entry to ${label}`}
            onClick={() => onAdd(id)}
          >
            <Glyph aria-hidden className="text-brand" />
            {label}
            <PlusIcon aria-hidden className="text-ink-meta" />
          </Button>
        );
      })}
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

/** A card heading's icon action: a 32px round target, as LinkedIn's. */
const HEADING_ACTION = "hover:bg-hover size-8 rounded-full";

/**
 * A card's heading actions, as LinkedIn's profile draws them (KAN-363): a
 * plus that adds, and a pencil that opens the card's edit mode, where each
 * item shows its own pencil and the pencil gives way to Clear All and Done.
 * An empty card shows the plus alone. Every card has the plus, Skills too.
 *
 * Until then each heading held Clear All and Add as words and every entry
 * its own pencil, so a card read as a row of controls before its content.
 * Clear All lives in edit mode because it is a bulk delete: LinkedIn's
 * profile shows none, and in view mode it sat one slip from Add.
 */
function SectionActions({
  name,
  addLabel,
  addTooltip,
  hasItems,
  editable,
  clearable = true,
  clearing,
  onAdd,
  onEdit,
  onDone,
  onClear,
}: {
  /** The card's name, for the pencil's label. */
  name: string;
  addLabel: string;
  addTooltip: string;
  hasItems: boolean;
  /** In edit mode. */
  editable: boolean;
  /** False leaves Clear All out of edit mode. */
  clearable?: boolean;
  /** Clear All's confirm is open, so the button gives way to it. */
  clearing: boolean;
  onAdd: () => void;
  onEdit: () => void;
  onDone: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {editable && clearable && !clearing && (
        <Button variant="section" onClick={onClear}>
          <TrashIcon aria-hidden /> Clear All
        </Button>
      )}
      <IconButton label={addLabel} tooltip={addTooltip} className={HEADING_ACTION} onClick={onAdd}>
        <PlusIcon aria-hidden className="size-5" />
      </IconButton>
      {editable ? (
        <Button variant="section" onClick={onDone}>
          Done
        </Button>
      ) : (
        hasItems && (
          <IconButton
            label={`Edit ${name}`}
            tooltip="Edit this section"
            className={HEADING_ACTION}
            onClick={onEdit}
          >
            <PencilSimpleIcon aria-hidden className="size-5" />
          </IconButton>
        )
      )}
    </div>
  );
}

/**
 * An entry open in the editor, with Delete Entry at the editor's foot
 * (KAN-363). It confirms with how many built resumes show the entry (story
 * 18), read when Delete Entry is pressed. A delete closes the editor and
 * reads the bank again (`onDeleted`). Over the buttons, a note names the
 * other built resumes a save changes too (`AlsoChanges`).
 */
function EditEntry({
  entry,
  usedIn,
  onShowResume,
  saving,
  error,
  onSave,
  onCancel,
  onDeleted,
}: {
  entry: BankEntry;
  /** The built resumes, other than the pick, that a save changes too. */
  usedIn: { id: string; name: string }[];
  /** Shows one of them in place of the pick. */
  onShowResume: (id: string) => void;
  saving: boolean;
  error: string | null;
  onSave: (draft: EntryDraft) => void;
  onCancel: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<{ resumes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirm() {
    setDeleteError(null);
    const { data, error } = await entryResumeCount(entry.id);
    if (data == null) return setDeleteError(error);
    setConfirming({ resumes: data });
  }

  async function remove() {
    setBusy(true);
    const res = await deleteEntry(entry.id);
    if (res.error) {
      setBusy(false);
      return setDeleteError(res.error);
    }
    await onDeleted();
  }

  return (
    <>
      <EntryEditor
        initial={draftOf(entry)}
        onSave={onSave}
        onCancel={onCancel}
        saving={saving || busy}
        error={error}
        onDelete={confirm}
        note={usedIn.length > 0 && <AlsoChanges resumes={usedIn} onShow={onShowResume} />}
      />
      {confirming && (
        <DeleteConfirm
          label="Delete Entry"
          busy={busy}
          onDelete={remove}
          onKeep={() => setConfirming(null)}
        >
          Delete this entry and its bullets?{" "}
          {confirming.resumes === 0
            ? "No built resume shows it."
            : confirming.resumes === 1
              ? "It comes off the 1 built resume that shows it."
              : `It comes off all ${confirming.resumes} built resumes that show it.`}
        </DeleteConfirm>
      )}
      {deleteError && (
        <p role="alert" className="text-note text-danger mt-1">
          {deleteError}
        </p>
      )}
    </>
  );
}

/** An entry as the bank shows it (`EntryRow`), and in its section's edit
 *  mode one pencil (KAN-363). Delete Entry is in the editor the pencil
 *  opens, with the other resumes a save changes. What the entry lacks stays
 *  in view while it is closed: it stops a Generate. So does a copy with
 *  other bullets: All Experiences shows one copy, so the note is the way to
 *  the others. */
function EntryView({
  row,
  resumes,
  open,
  onEdit,
  onShowResume,
}: {
  row: BankRow<BankEntry>;
  resumes: BankResume[];
  /** Scout is working on it, or a search found it: a bullet may be why. */
  open: boolean;
  /** Set in the section's edit mode, which shows the pencil. */
  onEdit?: () => void;
  onShowResume: (id: Pick, entryId: string) => void;
}) {
  const { entry } = row;
  const missing = missingFacts(entry);
  const versions = otherVersions(row, resumes);
  return (
    <EntryRow
      entry={entry}
      open={open}
      actions={
        onEdit && (
          <IconButton label="Edit Entry" tooltip="Edit this entry" onClick={onEdit}>
            <PencilSimpleIcon aria-hidden className="size-4" />
          </IconButton>
        )
      }
      note={
        <>
          {versions.length > 0 && (
            <p className="text-note text-ink-meta mt-1 pl-6">
              Other bullets on{" "}
              <ResumeLinks
                resumes={versions}
                onShow={(id) =>
                  onShowResume(id, versions.find((v) => v.id === id)?.entryId ?? entry.id)
                }
              />
            </p>
          )}
          {missing.length > 0 && (
            <p className="text-note text-warning mt-1">
              No {missing.join(" or ")} yet. Add {missing.length > 1 ? "them" : "it"} before you
              Generate a resume.
            </p>
          )}
        </>
      }
    />
  );
}

/** How many resumes the editor's note names before "and N more". */
const ALSO_SHOWN = 2;

/**
 * The editor's note on the other built resumes that show the entry
 * (KAN-363): "Saving also changes this entry on [file] Resume #3 and [file]
 * The Allen Institute…", with no full stop, which sat apart from a name cut
 * short. Each name, with its document mark, is a link that
 * shows that resume here (`?resume=`), as Change Resume would, and the
 * editor stays open; a Cmd or Ctrl click opens it in a new tab. A long name
 * cuts short, with the whole name in its tooltip.
 *
 * It sat in the entry's view first, as "Also used in …" under the title and
 * then an "Also on" pill at its foot. Every entry Generate put on more than
 * one resume carried it, and it said nothing of why it mattered until the
 * student edited, which is when it shows now.
 */
function AlsoChanges({
  resumes,
  onShow,
}: {
  resumes: { id: string; name: string }[];
  onShow: (id: string) => void;
}) {
  return (
    <p className="rounded-control bg-well text-note text-ink-muted px-3 py-2">
      Saving also changes this entry on <ResumeLinks resumes={resumes} onShow={onShow} />
    </p>
  );
}

/** Resumes named as links, "A, B and 2 more": each shows that resume here
 *  (`?resume=`), and a Cmd or Ctrl click opens it in a new tab. */
function ResumeLinks({
  resumes,
  onShow,
}: {
  resumes: { id: string; name: string }[];
  onShow: (id: string) => void;
}) {
  const rest = resumes.slice(ALSO_SHOWN);
  const shown = resumes.slice(0, ALSO_SHOWN);

  function show(event: MouseEvent, id: string) {
    // A new tab, or a download, is the browser's to handle.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onShow(id);
  }

  return (
    <>
      {shown.map((r, i) => (
        // Two resumes can share a name, but never an id.
        <Fragment key={r.id}>
          {i > 0 && (rest.length > 0 ? ", " : " and ")}
          <a
            href={`?resume=${encodeURIComponent(r.id)}`}
            title={`Show ${r.name}`}
            onClick={(e) => show(e, r.id)}
            className="text-ink hover:text-brand focus-visible:ring-brand-ring inline-flex max-w-full items-baseline gap-1 rounded-xs align-bottom underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            <FileTextIcon aria-hidden className="size-3.5 shrink-0 self-center" />
            <span className="max-w-40 truncate @xl/main:max-w-72">{r.name}</span>
          </a>
        </Fragment>
      ))}
      {rest.length > 0 && (
        <>
          {" and "}
          <span title={rest.map((r) => r.name).join(", ")}>{rest.length} more</span>
        </>
      )}
    </>
  );
}

/**
 * The skills, one row per group. Drawn as the section cards are: the plus at
 * the top right opens the form, so the card is a list until the student adds
 * or edits a skill; a form always open under the list made Skills the only
 * card that never looked finished. The pencil opens edit mode, where each
 * skill shows its pencil and × (KAN-363). The form stays open after an add,
 * for the next skill, and closes after an edit.
 */
function SkillsCard({
  skills,
  resumeId,
  resumes,
  pick,
  reload,
  removeSkill,
}: {
  skills: Skill[];
  /** The picked resume: a skill added here goes into it. */
  resumeId: string | undefined;
  /** For Clear All's confirm. */
  resumes: BankResume[];
  pick: Pick;
  reload: () => Promise<string | null>;
  /** Takes the skill off the page at once, then deletes it; a failed
   *  delete puts it back and hands over the error. */
  removeSkill: (id: string, onError: (error: string) => void) => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const formOpen = adding || editingId !== null;
  const editable = editMode && skills.length > 0;

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

  function remove(skill: Skill) {
    setError(null);
    if (editingId === skill.id) close();
    removeSkill(skill.id, setError);
  }

  return (
    <Card as="section" id="section-skills" aria-labelledby="bank-skills" className="scroll-mt-16">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bank-skills" className="text-subtitle text-ink flex min-w-0 items-center gap-2.5">
          <SectionMark id="skills" />
          Skills
        </h2>
        {!formOpen && (
          <SectionActions
            name="Skills"
            addLabel="Add Skill"
            addTooltip="Add a skill"
            hasItems={skills.length > 0}
            // A chip in All Experiences stands for every copy of its name:
            // Clear All belongs to one resume's view. Its pencil and × act on
            // the one copy, so a skill no resume holds can still be edited
            clearable={pick !== ALL}
            editable={editable}
            clearing={clearing}
            onAdd={() => {
              setError(null);
              setAdding(true);
            }}
            onEdit={() => setEditMode(true)}
            onDone={() => {
              setEditMode(false);
              setClearing(false);
            }}
            onClear={() => setClearing(true)}
          />
        )}
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
            setEditMode(false);
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
                      "rounded-control bg-brand-tint text-note text-brand-ink inline-flex items-center gap-1.5 border px-2 py-1",
                      editingId === skill.id ? "border-brand" : "border-transparent",
                    )}
                  >
                    {skill.name}
                    {editable && (
                      <>
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
                      </>
                    )}
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
