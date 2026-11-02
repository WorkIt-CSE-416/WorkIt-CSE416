"use client";

import { useState, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/icons";
import type { BankEntry } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { degreeLine, entryDetails, formatDates } from "./sections";

/** A bullet as a row shows it: the bank's, or this resume's own wording. */
type RowBullet = { id: string; text: string };

/**
 * One entry as every bank surface draws it (KAN-440): the Experiences page
 * and the resume editor's panel, so the two cannot drift apart. Closed, it
 * is the entry's title, place, dates, a school's degree and how many bullets
 * it holds; a press on it opens the other details and the bullets. It opens
 * closed: every entry fully open made a bank of six entries a long page, and
 * the student reads a bank by its titles.
 *
 * An entry with nothing more to show has no chevron and no press. Bullets
 * stop at a readable measure, since a page 1440px wide ran them past 130
 * characters a line.
 *
 * The slots are the surface's own: `lead` and `actions` sit beside the
 * heading, outside the press, so a control in them never opens the row, and
 * `note` shows open or closed, for what must not hide (a missing date).
 * `bullets` gives the row its own words, `bulletLead` a control before each
 * bullet, `summary` the closed row's count and `muted` a quieter title, for
 * an entry not on the resume. `open` holds the row open, for Scout working
 * on the entry.
 */
export function EntryRow({
  entry,
  lead,
  actions,
  note,
  open = false,
  muted = false,
  summary,
  bullets = entry.bullets,
  bulletLead,
}: {
  entry: BankEntry;
  lead?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  open?: boolean;
  muted?: boolean;
  /** In place of "3 bullets". */
  summary?: string;
  bullets?: RowBullet[];
  bulletLead?: (bullet: RowBullet) => ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const dates = formatDates(entry);
  const place = [entry.organization, entry.location].filter(Boolean).join(" · ");
  const degree = degreeLine(entry);
  const more = entryDetails(entry).filter((line) => line !== degree);
  const opens = !open && (more.length > 0 || bullets.length > 0);
  const shown = open || opened;

  const heading = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "text-body block font-medium break-words",
            muted ? "text-ink-muted" : "text-ink",
          )}
        >
          {entry.title}
        </span>
        {/* A narrow column puts the dates under the title: beside it, they
            never shrink and left the title a few letters wide on a phone. */}
        {dates && <span className="text-note text-ink-meta block @xl/main:hidden">{dates}</span>}
        {place && <span className="text-note text-ink-muted block break-words">{place}</span>}
        {degree && <span className="text-note text-ink-meta block break-words">{degree}</span>}
        {!shown && bullets.length > 0 && (
          <span className="text-note text-brand-ink block">
            {summary ?? `${bullets.length} ${bullets.length === 1 ? "bullet" : "bullets"}`}
          </span>
        )}
      </span>
      {dates && (
        <span className="text-note text-ink-meta hidden shrink-0 @xl/main:inline">{dates}</span>
      )}
    </>
  );

  return (
    <div>
      <div className="flex items-start gap-2">
        {lead}
        {opens ? (
          <button
            type="button"
            aria-expanded={shown}
            onClick={() => setOpened((was) => !was)}
            className="focus-visible:ring-brand-ring flex min-w-0 flex-1 items-start gap-2 rounded-xs text-left outline-none focus-visible:ring-2"
          >
            <ChevronDownIcon
              className={cn(
                "text-brand mt-1 size-4 shrink-0 transition-transform",
                !shown && "-rotate-90",
              )}
            />
            {heading}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2">{heading}</div>
        )}
        {actions}
      </div>

      {shown && (more.length > 0 || bullets.length > 0) && (
        <div className={cn("mt-1 max-w-[75ch]", opens && "pl-6")}>
          {more.map((line) => (
            <p key={line} className="text-note text-ink-meta break-words">
              {line}
            </p>
          ))}
          {bullets.length > 0 && (
            <ul
              className={cn(
                "text-body text-ink-muted mt-1.5 flex flex-col gap-1",
                !bulletLead && "marker:text-brand list-disc pl-5",
              )}
            >
              {bullets.map((bullet) => (
                <li key={bullet.id} className="break-words">
                  {bulletLead ? (
                    <span className="flex items-start gap-2">
                      {bulletLead(bullet)}
                      <span className="min-w-0 flex-1">{bullet.text}</span>
                    </span>
                  ) : (
                    bullet.text
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {note}
    </div>
  );
}
