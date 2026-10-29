"use client";

import { ListChecksIcon } from "@phosphor-icons/react/ssr";
import { addMinutes, format, parse } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { DateField } from "@/components/date-field";
import type { FacetOption } from "@/components/field-facet";
import { ArrowLeftIcon, PlusIcon } from "@/components/icons";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog";
import { TextAreaField } from "@/components/text-area-field";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SelectField } from "@/components/ui/select-field";
import { FIELD_LABEL, RequiredMark, TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { KIND_ICON, KIND_STAGE, STAGE_COLOR } from "../stage-colors";
import type { EventKind } from "../tracker";

import { addApplicationEvent, type NewEventKind } from "./actions";
import { ApplicationTile } from "./application-tile";
import { ApplicationTable, type PickableApplication } from "./pick-application";

/**
 * CREATE EVENT (KAN-413, KAN-429): the one way a student puts an interview,
 * an assessment, an offer, a rejection or a follow-up on the tracker, with
 * a title, a day, a time or All Day, a meeting link and a note. Every event
 * on the Calendar that is not one of the tracker's own dates (Applied,
 * Apply By, Closes) came from here, or later from an email.
 *
 * Two places open it, drawn alike: an application's page (Interviews &
 * Dates, given its `jobId`) and the Calendar's toolbar, which has no
 * application in hand, so the form asks which one (`applications`).
 *
 * EVERY CONTROL IS ONE OF WORKIT'S OWN, never the browser's: the date is
 * <DateField> (WorkIt's calendar), the times are <SelectField>s of
 * quarter hours, as Google Calendar's are, the End list naming each
 * choice's length, Type wears each kind's glyph and colour (`OptionLabel`),
 * and the application is picked in Choose Application, the Tracker's rows
 * as a step of this dialog, never a dropdown and never a second dialog over
 * this one (./pick-application.tsx). The first version
 * used native date and time inputs, which open the OS's own picker in none
 * of WorkIt's type or colours, a plain text list for Type, and a dropdown
 * of "Company · Role" lines for the application.
 *
 * WIDE, NOT TALL, as Google Calendar's editor: the title first, then the
 * fields that pair up side by side, so the form fits a laptop screen.
 */

/** The kinds, each named as the title a blank one gets. The API's "other"
 *  is a follow-up on the tracker (./tracked.ts), and draws as one. */
const KINDS: { value: NewEventKind; label: string; kind: EventKind }[] = [
  { value: "interview", label: "Interview", kind: "interview" },
  { value: "assessment", label: "Assessment", kind: "assessment" },
  { value: "offer", label: "Offer", kind: "offer" },
  { value: "rejection", label: "Rejection", kind: "rejection" },
  { value: "other", label: "Follow-Up", kind: "follow-up" },
];

/** Type's options in each kind's glyph and colour, as the Calendar's Type
 *  filter and the timeline draw them. */
const KIND_OPTIONS: FacetOption[] = KINDS.map(({ value, label, kind }) => ({
  value,
  label,
  Icon: KIND_ICON[kind],
  iconClassName: STAGE_COLOR[KIND_STAGE[kind]].onTint,
}));

/** What adding each kind does to the stage, said in the dialog so the move
 *  is no surprise. */
const MOVES: Partial<Record<NewEventKind, string>> = {
  interview: "Creating it moves the application to Interviewing, unless it is further along.",
  offer: "Creating it moves the application to Offer, unless it was rejected.",
  rejection: "Creating it moves the application to Rejected.",
};

/** The times a start or an end can take: every quarter hour, as Google
 *  Calendar offers, "HH:mm". */
const QUARTERS = Array.from({ length: 96 }, (_, i) =>
  format(addMinutes(new Date(2026, 0, 1), i * 15), "HH:mm"),
);
/** A new event's start, and its length until the student picks an end. */
const DEFAULT_START = "09:00";
const DEFAULT_MINUTES = 60;

/** "14:30" as "2:30 PM". */
function clock(time: string) {
  return format(parse(time, "HH:mm", new Date(2026, 0, 1)), "h:mm a");
}

/** Minutes from midnight of "HH:mm". */
function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** A length as the End list names it: "30 min", "1 hr", "1.5 hrs". */
function length(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hr" : "hrs"}`;
}

/** The End list: each quarter hour after the start, with its length. */
function endOptions(startTime: string) {
  const from = minutesOf(startTime);
  return QUARTERS.filter((time) => minutesOf(time) > from).map((time) => ({
    value: time,
    label: `${clock(time)} (${length(minutesOf(time) - from)})`,
  }));
}

/** The end a start gets: an hour on, or the day's last quarter. */
function endFor(startTime: string) {
  const end = Math.min(minutesOf(startTime) + DEFAULT_MINUTES, 23 * 60 + 45);
  return QUARTERS.find((time) => minutesOf(time) === end) ?? "";
}

/** An application the Calendar's form can put an event on. */
export type EventTarget = PickableApplication;

export function CreateEventDialog({
  jobId,
  applications,
  defaultDay,
  variant = "secondary",
}: {
  /** The application, on its own page. */
  jobId?: string;
  /** Where there is none in hand (the Calendar): the student picks one. */
  applications?: EventTarget[];
  /** The date field's first value, "YYYY-MM-DD". */
  defaultDay?: string;
  variant?: "default" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={variant} size="sm">
            <PlusIcon />
            Create Event
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* Mounted per open, so each opens blank. */}
        {open && (
          <CreateEventForm
            jobId={jobId}
            applications={applications}
            defaultDay={defaultDay}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateEventForm({
  jobId,
  applications,
  defaultDay,
  onDone,
}: {
  jobId?: string;
  applications?: EventTarget[];
  defaultDay?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<NewEventKind>("interview");
  const [target, setTarget] = useState(jobId ?? "");
  const [day, setDay] = useState(defaultDay ?? "");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(endFor(DEFAULT_START));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = KINDS.find((k) => k.value === kind)!.label;
  const empty = !jobId && (applications ?? []).length === 0;

  // CHOOSE APPLICATION IS A STEP OF THIS DIALOG, never a dialog over it
  // (./pick-application.tsx): from the Calendar the dialog opens on it,
  // since every event is on an application, and Change comes back to it.
  // The form stays mounted under it, hidden, so what was typed survives.
  const [choosing, setChoosing] = useState(!jobId && !empty);
  const picked = applications?.find((app) => app.id === target);

  function pickStart(next: string) {
    setStartTime(next);
    // An end at or before the new start moves on with it, keeping the
    // hour, as Google Calendar's does.
    if (minutesOf(endTime) <= minutesOf(next)) setEndTime(endFor(next));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) {
      setError("Pick the application this event is for.");
      return;
    }
    if (!day) {
      setError("Pick the day it happens.");
      return;
    }
    const form = new FormData(e.currentTarget);
    // A time is read in the viewer's own zone and sent as an instant; All
    // Day is the bare date (../tracker.ts).
    const at = allDay ? null : new Date(`${day}T${startTime}`).toISOString();
    const endsAt = allDay || !endTime ? null : new Date(`${day}T${endTime}`).toISOString();
    start(async () => {
      const result = await addApplicationEvent(target, {
        kind,
        title: String(form.get("title") ?? "").trim() || label,
        at,
        endsAt,
        onDay: at ? null : day,
        note: String(form.get("note") ?? ""),
        meetingUrl: String(form.get("link") ?? "").trim(),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-1">
          {/* Back to the form, once it has an application to go back to. */}
          {choosing && picked && (
            <IconButton
              label="Back to the event"
              className="-ml-1.5 size-8"
              onClick={() => setChoosing(false)}
            >
              <ArrowLeftIcon className="size-4" />
            </IconButton>
          )}
          <DialogTitle className="text-subtitle font-semibold">
            {choosing ? "Choose Application" : "Create Event"}
          </DialogTitle>
        </div>
        <DialogDescription>
          {choosing
            ? "Pick the application this event is for."
            : empty
              ? "Save a job first: every event belongs to one of your applications."
              : (MOVES[kind] ?? "It shows on the application's timeline and your Calendar.")}
        </DialogDescription>
      </DialogHeader>
      {choosing && (
        // The table scrolls inside the dialog's height, its search above it.
        <div className="animate-fade flex max-h-[60vh] min-h-0 flex-col gap-4">
          <ApplicationTable
            jobs={applications ?? []}
            picked={target}
            onPick={(id) => {
              setTarget(id);
              setChoosing(false);
            }}
          />
        </div>
      )}
      <form
        onSubmit={submit}
        className={cn("animate-fade grid gap-4 sm:grid-cols-6", choosing && "hidden")}
      >
        <div className="sm:col-span-6">
          <TextField
            id="event-title"
            name="title"
            label="Title"
            placeholder={label}
            maxLength={120}
          />
        </div>
        {/* THE APPLICATION IS PICKED IN CHOOSE APPLICATION, the step above
            (./pick-application.tsx), never a dropdown, and shown as the
            Inbox shows its pick: the logo, the role, the company and
            Change. */}
        {!jobId && (
          <div className="flex min-w-0 flex-col gap-1 sm:col-span-4">
            <p id="event-application-label" className={FIELD_LABEL}>
              Application
              <RequiredMark />
            </p>
            {picked ? (
              <div
                aria-labelledby="event-application-label"
                className="flex min-h-[2.625rem] min-w-0 items-center gap-3"
              >
                <ApplicationTile application={picked} size="sm" />
                <div className="min-w-0">
                  <p className="text-label text-ink truncate font-semibold">{picked.role}</p>
                  <p className="text-note text-ink-meta truncate">
                    {picked.company}
                    {" · "}
                    <button
                      type="button"
                      onClick={() => setChoosing(true)}
                      className="text-brand hover:text-brand-hover focus-visible:ring-brand-ring rounded-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                    >
                      Change
                    </button>
                  </p>
                </div>
              </div>
            ) : (
              <Button
                variant="secondary"
                className="self-start"
                aria-describedby="event-application-label"
                disabled={empty}
                onClick={() => setChoosing(true)}
              >
                <ListChecksIcon aria-hidden className="size-4" />
                Choose Application
              </Button>
            )}
          </div>
        )}
        <SelectField
          id="event-kind"
          label="Type"
          value={kind}
          options={KIND_OPTIONS}
          onValueChange={(next) => setKind(next as NewEventKind)}
          className={jobId ? "sm:col-span-6" : "sm:col-span-2"}
        />
        <div className="sm:col-span-2">
          <DateField id="event-day" label="Date" value={day} onValueChange={setDay} required />
        </div>
        <SelectField
          id="event-start"
          label="Start"
          value={startTime}
          options={QUARTERS.map((time) => ({ value: time, label: clock(time) }))}
          onValueChange={pickStart}
          disabled={allDay}
          className="sm:col-span-2"
        />
        <SelectField
          id="event-end"
          label="End"
          value={endTime}
          options={endOptions(startTime)}
          onValueChange={setEndTime}
          disabled={allDay}
          className="sm:col-span-2"
        />
        {/* ALL DAY, as Google Calendar's: for something due by the end of a
            day, an assessment's deadline or an offer's answer-by. */}
        <label className="text-label text-ink -mt-1 flex w-fit cursor-pointer items-center gap-2 sm:col-span-6">
          <Checkbox
            className="border-ink-meta"
            checked={allDay}
            onCheckedChange={(next) => setAllDay(next === true)}
          />
          All Day
        </label>
        <div className="sm:col-span-6">
          <TextField
            id="event-link"
            name="link"
            type="url"
            label="Meeting Link"
            placeholder="https://"
            maxLength={500}
          />
        </div>
        <div className="sm:col-span-6">
          <TextAreaField id="event-note" name="note" label="Note" rows={2} maxLength={1000} />
        </div>
        {error && (
          <p role="alert" className="text-meta text-danger sm:col-span-6">
            {error}
          </p>
        )}
        <DialogFooter className="sm:col-span-6">
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" disabled={pending || empty}>
            {pending ? "Creating…" : "Create Event"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
