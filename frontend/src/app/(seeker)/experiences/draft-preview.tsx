"use client";

import {
  CheckCircleIcon,
  CheckIcon,
  PencilSimpleIcon,
  SkipForwardIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/ssr";

import { Button } from "@/components/ui/button";
import type { BankEntry } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { degreeLine, formatDates, neededFacts, type EntryDraft } from "./sections";

/**
 * Intake's draft as Scout's panel shows it (KAN-202): a read-only preview
 * of the entry as the bank will list it, with what to do about it. It is not
 * a form. The form opens over the panel on Edit, so the chat keeps the
 * panel's height.
 *
 * IN THE CHAT (KAN-257), under Scout's latest line, the way an assistant's
 * answer carries what it made: the draft card, and in its foot Skip Section
 * (or "Leave As Is" on a visit), Edit and Save Entry. The card follows
 * Scout's newest line, so there is one, near the composer, and it never
 * goes stale higher up the chat. Before Scout has a title there is nothing
 * to preview, so the chat offers the same actions as suggestion chips under
 * its question (`intake.tsx`). The draft and those buttons used to sit in
 * the stage card above the chat, which crowded a card whose job is finding
 * your way, and parted the actions from the conversation they answer.
 *
 * After Cloudscape's split of inline previews (quick to read, one or two
 * actions in the card) from canvas previews (opened to edit): what Scout
 * has understood so far, in plain view. Each line is keyed by its text, so
 * a line Scout fills in or changes fades in, and the student sees the
 * answer land.
 *
 * THE DRAFT'S LINES (KAN-257) run from what matters most to least: the
 * title; what the entry is with, darker (a school's degree, a job's
 * company, a certification's issuer); when and where, in the meta grey; the
 * rest (a school's college, coursework, honors, a project's link); then two
 * bullets, two lines each. Every line under the title used to be the same
 * small grey, so a school's degree read like its coursework, and the dates
 * floated right on the organization's line: alone at the edge of an empty
 * row when there was none, as an import's school always has.
 * Under the title, `DraftStatus` says what the draft still needs, or that
 * it is ready. It replaced a pulsing dot and "Filling in as you talk",
 * which said nothing the chat did not, and a row of dashed "Still needed"
 * chips at the foot of the card.
 */

const SHOWN_BULLETS = 2;

export function DraftPreview({
  draft,
  done,
  saving,
  busy,
  error,
  duplicate,
  skipLabel,
  onEdit,
  onSave,
  onSkip,
}: {
  draft: EntryDraft;
  done: boolean;
  saving: boolean;
  /** While Scout answers or a save runs: a late reply must not land on the
   *  next section, so Skip waits. Disabled rather than hidden, so the card
   *  holds still. */
  busy: boolean;
  error: string | null;
  duplicate: BankEntry | null;
  /** "Skip Section" for a new entry, "Leave As Is" for a visit. */
  skipLabel: string;
  onEdit: () => void;
  onSave: () => void;
  /** Moves on without saving. */
  onSkip: () => void;
}) {
  const lead = leadLine(draft);
  const when = [formatDates(draft), draft.location].filter(Boolean).join(" · ");
  const extras = extraLines(draft);
  const bullets = draft.bullets.map((b) => b.text.trim()).filter(Boolean);

  return (
    <section
      aria-label={`Draft entry: ${draft.title}`}
      className="bg-panel shadow-card ring-brand-tint animate-rise overflow-hidden rounded-2xl ring-1"
    >
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p key={draft.title} className="text-body text-ink animate-fade truncate font-semibold">
            {draft.title}
          </p>
          <DraftStatus needed={neededFacts(draft)} done={done} />
        </div>

        <div className="flex min-w-0 flex-col gap-0.5 empty:hidden">
          {lead && (
            <p key={lead} className="text-label text-ink-muted animate-fade break-words">
              {lead}
            </p>
          )}
          {when && (
            <p key={when} className="text-note text-ink-meta animate-fade break-words">
              {when}
            </p>
          )}
          {extras.map(({ label, text }) => (
            <p
              key={`${label}|${text}`}
              className="text-note text-ink-muted animate-fade line-clamp-2 break-words"
            >
              {label && <span className="text-ink-meta">{label}: </span>}
              {text}
            </p>
          ))}
          {bullets.length > 0 && (
            <ul className="text-note text-ink-muted mt-1 flex list-disc flex-col gap-1 pl-4">
              {bullets.slice(0, SHOWN_BULLETS).map((text) => (
                // The text clamps, not the <li>: clamping the <li> hides its marker.
                <li key={text} className="animate-fade">
                  <span className="line-clamp-2">{text}</span>
                </li>
              ))}
              {bullets.length > SHOWN_BULLETS && (
                <li className="text-ink-meta list-none">+{bullets.length - SHOWN_BULLETS} more</li>
              )}
            </ul>
          )}
        </div>

        {(error || duplicate) && (
          <p role="alert" className="text-note text-danger">
            {duplicate ? "This looks like an entry already in your bank. Edit to compare." : error}
          </p>
        )}
      </div>

      {/* The actions under the preview: moving on at the left, keeping it at
          the right, Save Entry last as the step most people take. */}
      <div className="border-border-subtle flex items-center gap-2 border-t px-2 py-2">
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={onSkip} disabled={busy}>
          <SkipForwardIcon aria-hidden /> {skipLabel}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={onEdit}>
          <PencilSimpleIcon aria-hidden /> Edit
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <CheckIcon aria-hidden /> {saving ? "Saving…" : "Save Entry"}
        </Button>
      </div>
    </section>
  );
}

/** The line under the title: who or what the entry is with. A school's
 *  degree, a certification's issuer, anyone else's organization. */
function leadLine(draft: EntryDraft): string | null {
  if (draft.section === "education") return degreeLine(draft);
  if (draft.section === "certifications" && draft.issuer) return `Issued by ${draft.issuer}`;
  return draft.organization;
}

/** Whatever else the bank lists, under the dates: a school's college, an
 *  organization the lead line left out, coursework, honors, a link. */
function extraLines(draft: EntryDraft): { label?: string; text: string }[] {
  const lead = leadLine(draft);
  const lines: { label?: string; text: string }[] = [];
  if (draft.organization && draft.organization !== lead) lines.push({ text: draft.organization });
  if (draft.issuer && draft.section !== "certifications") {
    lines.push({ text: `Issued by ${draft.issuer}` });
  }
  if (draft.coursework.length) {
    lines.push({ label: "Coursework", text: draft.coursework.join(", ") });
  }
  if (draft.honors) lines.push({ label: "Honors", text: draft.honors });
  if (draft.link) lines.push({ text: linkLabel(draft.link) });
  return lines;
}

/** "https://www.github.com/a/b/" → "github.com/a/b": the address a person
 *  would type, not the protocol. */
function linkLabel(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/**
 * What a draft still needs, in the bank's warning amber, the names the form
 * gives those fields (`neededFacts`, never an optional field); or, once
 * Scout has no questions left and nothing is missing, that it is ready, in
 * the positive green. Nothing while Scout is still asking about optional
 * facts. The stage card and the form over the panel both show it.
 */
export function DraftStatus({ needed, done }: { needed: readonly string[]; done: boolean }) {
  if (needed.length > 0) {
    return (
      <span className="text-note text-warning flex items-start gap-1.5">
        {/* On the first line's centre: 12px type on a 16px line. */}
        <WarningCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Still needed: {needed.join(", ")}
      </span>
    );
  }
  if (!done) return null;
  return (
    <span className="text-note text-positive-ink flex items-center gap-1.5">
      <CheckCircleIcon aria-hidden className="size-3.5 shrink-0" />
      Ready to save
    </span>
  );
}

/** Whether Scout has more to ask: a pulsing brand dot, or a still green
 *  one once the draft is ready, in the step bar's done green (KAN-257).
 *  The one-line draft that opens the form on a narrow onboarding page
 *  shows it. */
export function Dot({ ready }: { ready: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2.5 shrink-0">
      {!ready && (
        <span className="bg-brand absolute inset-0 animate-ping rounded-full opacity-40" />
      )}
      <span className={cn("relative size-2.5 rounded-full", ready ? "bg-step-done" : "bg-brand")} />
    </span>
  );
}
