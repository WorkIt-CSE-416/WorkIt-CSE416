"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ExternalLinkIcon, TrashIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../../local-time";
import {
  KIND_ICON,
  KIND_STAGE,
  STAGE_COLOR,
  STAGE_ICON,
  STAGE_LABEL,
  type StageKey,
} from "../../stage-colors";
import type { ApplicationEvent } from "../../tracker";
import { deleteApplicationEvent, setApplicationStage, type PickableStage } from "../actions";
import { CreateEventDialog } from "../create-event";

/**
 * The Applications Tracker's own controls on an application's page
 * (KAN-413, docs/email_tracker.md, "Where it lives"): the stage menu, and
 * Interviews & Dates with Create Event (../create-event.tsx, which the
 * Calendar's toolbar opens too). Each write goes through ../actions and
 * then refreshes the page, so the tracker's one read (`getTracker`) draws
 * the change on the card, the timeline, the list, the Calendar and the
 * Home alike; nothing here keeps a second copy of the stage or the
 * events.
 */

const PICKABLE: PickableStage[] = ["applied", "interviewing", "offer", "rejected"];

/**
 * The stage menu: Applied, Interviewing, Offer or Rejected, any way, each
 * in its glyph and colour as the Tracker's Status filter draws it. A saved
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
      options={PICKABLE.map((value) => ({
        value,
        label: STAGE_LABEL[value],
        Icon: STAGE_ICON[value],
        iconClassName: STAGE_COLOR[value].onTint,
      }))}
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

/**
 * Interviews & Dates: every event on the application, soonest first, each
 * with its day in the viewer's own zone, its link and note, and Delete; and
 * Create Event. Deleting an event leaves the stage where it is. Only an event
 * the student added has Delete: one read from an email stays, as every
 * email stays in the Inbox as a record (the API refuses its delete too).
 */
export function TrackerEvents({ jobId, events }: { jobId: string; events: ApplicationEvent[] }) {
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <SectionHeading>Interviews &amp; Dates</SectionHeading>
        <CreateEventDialog jobId={jobId} />
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
  const Glyph = KIND_ICON[event.kind];

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
      {event.id && event.source !== "gmail" && (
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
