"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

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
import { ExternalLinkIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../../local-time";
import {
  KIND_STAGE,
  STAGE_COLOR,
  STAGE_ICON,
  STAGE_LABEL,
  type StageKey,
} from "../../stage-colors";
import type { ApplicationEvent } from "../../tracker";
import {
  addApplicationEvent,
  deleteApplicationEvent,
  setApplicationStage,
  type NewEventKind,
  type PickableStage,
} from "../actions";

/**
 * The Applications Tracker's own controls on an application's page
 * (KAN-413, docs/email_tracker.md, "Where it lives"): the stage menu, and
 * Interviews & Dates with Add Event. Each write goes through ../actions and
 * then refreshes the page, so the tracker's one read (`getTracker`) draws
 * the change on the card, the timeline, the list, the Calendar and the
 * Dashboard alike; nothing here keeps a second copy of the stage or the
 * events.
 */

const PICKABLE: PickableStage[] = ["applied", "interviewing", "offer", "rejected"];

/**
 * The stage menu: Applied, Interviewing, Offer or Rejected, any way. A saved
 * job has no pick yet ("Move To…"), since saved is a bookmark the menu never
 * goes back to. An interview, offer or rejection added below moves the stage
 * forward by itself; this is for everything else.
 */
export function StageMenu({ jobId, stage }: { jobId: string; stage: StageKey }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <SelectField
      id={`stage-${jobId}`}
      label="Stage"
      hideLabel
      value={stage === "saved" ? "" : stage}
      placeholder="Move To…"
      options={PICKABLE.map((value) => ({ value, label: STAGE_LABEL[value] }))}
      onValueChange={(next) => {
        if (!next || next === stage || pending) return;
        start(async () => {
          const { error } = await setApplicationStage(jobId, next as PickableStage);
          if (error) {
            toast.show({ message: `Couldn't change the stage. ${error}` });
            return;
          }
          router.refresh();
        });
      }}
      className="w-40"
    />
  );
}

/** Add Event's kinds, each named as the title a blank one gets. The API's
 *  "other" is a follow-up on the tracker (../tracked.ts). */
const KINDS: { value: NewEventKind; label: string }[] = [
  { value: "interview", label: "Interview" },
  { value: "assessment", label: "Assessment" },
  { value: "offer", label: "Offer" },
  { value: "rejection", label: "Rejection" },
  { value: "other", label: "Follow-Up" },
];

/** What adding each kind does to the stage, said in the dialog so the move
 *  is no surprise. */
const MOVES: Partial<Record<NewEventKind, string>> = {
  interview: "Adding it moves this application to Interviewing, unless it is further along.",
  offer: "Adding it moves this application to Offer, unless it was rejected.",
  rejection: "Adding it moves this application to Rejected.",
};

/**
 * Interviews & Dates: every event on the application, soonest first, each
 * with its day in the viewer's own zone, its link and note, and Delete; and
 * Add Event. Deleting an event leaves the stage where it is.
 */
export function TrackerEvents({ jobId, events }: { jobId: string; events: ApplicationEvent[] }) {
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <SectionHeading>Interviews &amp; Dates</SectionHeading>
        <AddEventDialog jobId={jobId} />
      </div>
      {events.length > 0 ? (
        <ul className="divide-border-subtle border-border-subtle rounded-card bg-panel mt-3 divide-y border">
          {events.map((event) => (
            <EventRow key={event.id ?? event.at + event.title} event={event} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-meta mt-3">
          Add interviews, assessments, offers and replies here. They show on your timeline and your
          Calendar.
        </p>
      )}
    </section>
  );
}

function EventRow({ event }: { event: ApplicationEvent }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const stage = KIND_STAGE[event.kind];
  const Glyph = STAGE_ICON[stage];

  return (
    <li className={cn("flex items-start gap-3 p-4", pending && "opacity-50")}>
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white",
          STAGE_COLOR[stage].fill,
        )}
      >
        <Glyph className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink font-semibold">{event.title}</p>
        <p className="text-note text-ink-meta">
          <When at={event.at} />
        </p>
        {event.meetingUrl && (
          <a
            href={event.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-note text-brand hover:text-brand-hover mt-1 inline-flex items-center gap-1 hover:underline"
          >
            Join Meeting
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
        {event.note && (
          <p className="text-body text-ink-muted mt-1 whitespace-pre-line">{event.note}</p>
        )}
      </div>
      {event.id && (
        <IconButton
          label={`Delete ${event.title}`}
          tooltip="Delete"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const { error } = await deleteApplicationEvent(event.id!);
              if (error) {
                toast.show({ message: `Couldn't delete ${event.title}. ${error}` });
                return;
              }
              router.refresh();
            })
          }
        >
          <TrashIcon className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

function AddEventDialog({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            <PlusIcon />
            Add Event
          </Button>
        }
      />
      <DialogContent>
        {/* Mounted per open, so each opens blank. */}
        {open && <AddEventForm jobId={jobId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AddEventForm({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<NewEventKind>("interview");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = KINDS.find((k) => k.value === kind)!.label;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const day = String(form.get("day") ?? "");
    const time = String(form.get("time") ?? "");
    // A time is read in the viewer's own zone and sent as an instant; no
    // time is a whole day, sent as the bare date (tracker.ts).
    const at = time ? new Date(`${day}T${time}`).toISOString() : null;
    start(async () => {
      const result = await addApplicationEvent(jobId, {
        kind,
        title: String(form.get("title") ?? "").trim() || label,
        at,
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
        <DialogTitle className="text-subtitle font-semibold">Add Event</DialogTitle>
        <DialogDescription>
          {MOVES[kind] ?? "It shows on your timeline and your Calendar."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          id="event-kind"
          label="Type"
          value={kind}
          options={KINDS.map(({ value, label }) => ({ value, label }))}
          onValueChange={(next) => setKind(next as NewEventKind)}
        />
        <TextField
          id="event-title"
          name="title"
          label="Title"
          placeholder={label}
          maxLength={120}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField id="event-day" name="day" type="date" label="Date" required />
          <TextField id="event-time" name="time" type="time" label="Time" />
        </div>
        <p className="text-note text-ink-meta -mt-2">
          Leave the time blank for something due by the end of a day.
        </p>
        <TextField
          id="event-link"
          name="link"
          type="url"
          label="Meeting Link"
          placeholder="https://"
          maxLength={500}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="event-note" className={FIELD_LABEL}>
            Note
          </label>
          <textarea
            id="event-note"
            name="note"
            rows={3}
            maxLength={1000}
            className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
          />
        </div>
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add Event"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
