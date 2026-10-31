"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { differenceInCalendarDays, parseISO } from "date-fns";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  ArrowRightIcon,
  BriefcaseIcon,
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  FileIcon,
} from "@/components/icons";
import { buttonClasses } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

import { localDay, type EventKind, type TrackerEvent } from "../tracker";
import { dayKey, KIND_LABEL, longDay, lookOf, whenOf } from "./entries";

/**
 * A calendar entry, and THE CARD ITS CLICK OPENS (KAN-429), as Google
 * Calendar's event card. View Application opens the application's detail
 * panel from there. A click went straight to that panel until then, so
 * every entry, an interview with a note or a bare closing day, opened the
 * same timeline, and the entry clicked was one row in it.
 *
 * ONE LAYOUT FOR EVERY KIND, so no card reads differently from the next:
 * the glyph and the title, then a line saying what the entry is (`whatOf`),
 * then the same rows in the same order, each only where the entry has it:
 * When (with how far off for a deadline), Application, Resume (the one an
 * application went out with), Meeting, then the note, and View
 * Application last. The tracker's own dates (Applied, Apply By, Closes)
 * carry no text of their own, so their line says what the date means:
 * "Applied" and a day alone read as nothing.
 *
 * PLACED BESIDE THE ENTRY, AND NEVER CUT OFF. The card opens to the
 * entry's right (left where the screen runs out) with its top at the
 * entry's top, and slides up only as far as it must to fit (`align:
 * "shift"`): base-ui's default flips the alignment instead, so a tall card
 * that did not fit below jumped to end level with the entry's foot, well
 * above it. It is held inside the window, not the grid's scroll box (the
 * entry's clipping ancestor, the default boundary), and no taller than the
 * window leaves it; a long note scrolls inside its own box.
 */
export function EventEntry({
  event,
  openHref,
  className,
  title,
  side = "right",
  children,
}: {
  event: TrackerEvent;
  openHref: (applicationId: string) => string;
  className?: string;
  title?: string;
  side?: "right" | "bottom";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        title={title}
        className={cn("w-full cursor-pointer text-left", className, open && "brightness-95")}
      >
        {children}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side={side}
          align="start"
          sideOffset={6}
          collisionPadding={16}
          collisionBoundary={typeof document === "undefined" ? undefined : document.documentElement}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "end" }}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            className={cn(
              "bg-panel rounded-card shadow-lift ring-border-subtle flex max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) flex-col overflow-y-auto ring-1 outline-hidden",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100",
            )}
          >
            <EventCard
              event={event}
              href={openHref(event.applicationId)}
              close={() => setOpen(false)}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** What each of the tracker's own dates means, as the card's second line. */
const MEANING: Partial<Record<EventKind, string>> = {
  applied: "Application sent",
  "apply-by": "Your own day to apply by",
  closes: "The posting stops taking applications",
};

/** The card's second line: what the entry is and where it came from. A
 *  tracker date says what it means; any other is its kind and who made it,
 *  the student (Create Event) or an email, so no entry's title, time or
 *  note reads as if WorkIt made it up. */
function whatOf(event: TrackerEvent) {
  const meaning = MEANING[event.kind];
  if (meaning) return meaning;
  const by = event.source === "gmail" ? "From an email" : "Added by you";
  return `${KIND_LABEL[event.kind]} · ${by}`;
}

/** How far off a deadline is, for Apply By and Closes only: "Today", "In 3
 *  days", "2 days ago". Once the student applied, neither is drawn. */
function dueIn(event: TrackerEvent) {
  if (event.kind !== "apply-by" && event.kind !== "closes") return null;
  const days = differenceInCalendarDays(parseISO(localDay(event.at)), parseISO(dayKey(new Date())));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

function EventCard({
  event,
  href,
  close,
}: {
  event: TrackerEvent;
  href: string;
  close: () => void;
}) {
  const look = lookOf(event.kind);
  const { Icon } = look;
  const due = dueIn(event);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
            look.fill,
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <PopoverPrimitive.Title className="text-label text-ink font-semibold text-pretty">
            {event.title}
          </PopoverPrimitive.Title>
          <p className={cn("text-note font-medium", look.onTint)}>{whatOf(event)}</p>
        </div>
        <IconButton label="Close" className="-mt-1 -mr-1 size-8" onClick={close}>
          <CloseIcon className="size-4" />
        </IconButton>
      </div>

      <dl className="text-note text-ink-muted flex flex-col gap-2">
        <Row label="When" Icon={ClockIcon}>
          <span className="text-ink block">{longDay(event.at)}</span>
          <span className="tabular-nums">
            {whenOf(event)}
            {due && ` · ${due}`}
          </span>
        </Row>
        <Row label="Application" Icon={BriefcaseIcon}>
          <span className="text-ink block truncate">{event.role}</span>
          <span className="block truncate">{event.company}</span>
        </Row>
        {event.resume && (
          <Row label="Resume" Icon={FileIcon}>
            <span className="block truncate">Sent with {event.resume}</span>
          </Row>
        )}
        {event.meetingUrl && (
          <Row label="Meeting" Icon={ExternalLinkIcon}>
            <a
              href={event.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:text-brand-hover font-medium hover:underline"
            >
              Join Meeting
            </a>
          </Row>
        )}
      </dl>

      {/* The note, as typed or as the email read, under its own label: a
          bare grey box read as text from nowhere. A long one scrolls in its
          own box, so every card stays about one size. */}
      {event.note && (
        <div>
          <p className="text-caption text-ink-meta font-medium">
            {event.source === "gmail" ? "From the Email" : "Your Note"}
          </p>
          <p className="text-note text-ink-muted bg-app rounded-control mt-1 max-h-32 overflow-y-auto px-3 py-2 whitespace-pre-line">
            {event.note}
          </p>
        </div>
      )}

      <Link
        href={href}
        scroll={false}
        onClick={close}
        className={cn(buttonClasses({ variant: "secondary", size: "sm" }), "self-start")}
      >
        View Application
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  );
}

/** One of the card's rows: a glyph, then its lines. */
function Row({
  label,
  Icon,
  children,
}: {
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="sr-only">{label}</dt>
      <Icon className="text-ink-meta mt-0.5 size-4 shrink-0" />
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
