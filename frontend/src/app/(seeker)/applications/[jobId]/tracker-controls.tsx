"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { ExternalLinkIcon, TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
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
import {
  addApplicationEvent,
  deleteApplicationEvent,
  setApplicationStage,
  type PickableStage,
} from "../actions";
import { CreateEventDialog } from "../create-event";

import { asksFirst, readdEvent, undoStage } from "./undo";

/**
 * The Applications Tracker's own controls on an application's page
 * (KAN-413, docs/email_tracker.md, "Where it lives"): the stage menu, and
 * Interviews & Dates with Create Event (../create-event.tsx, which the
 * Calendar's toolbar opens too). Each write goes through ../actions and
 * then refreshes the page, so the tracker's one read (`getTracker`) draws
 * the change on the card, the timeline, the list, the Calendar and the
 * Home alike; nothing here keeps a second copy of the stage or the
 * events. Each write says it worked in a toast with Undo (KAN-577,
 * ./undo.ts), or asks first where Undo cannot take it back.
 */

const PICKABLE: PickableStage[] = ["applied", "interviewing", "offer", "rejected"];

/**
 * The stage menu: Applied, Interviewing, Offer or Rejected, any way, each
 * in its glyph and colour as the Tracker's Status filter draws it. A saved
 * job has no pick yet ("Move To…"), since saved is a bookmark the menu never
 * goes back to. An interview, offer or rejection added below moves the stage
 * forward by itself; this is for everything else.
 *
 * A pick writes at once and says so in a toast ("Moved to Offer.") whose
 * Undo puts the stage before it back. A saved job's pick asks first: the
 * API never moves a job back to Saved, so it has no Undo. The menu is off
 * while a write runs.
 *
 * The Tracker's list rows and cards carry it too, so a stage changes where
 * the application is seen; there a saved job's menu reads "Saved"
 * (`placeholder`), its stage, rather than the page's "Move To…". Its id is
 * its own (`useId`): the list and the cards are both on the page at once.
 */
export function StageMenu({
  jobId,
  stage,
  placeholder = "Move To…",
  className = "w-40",
}: {
  jobId: string;
  stage: StageKey;
  /** What a saved job's menu reads, since Saved is not a pick. */
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<PickableStage | null>(null);

  function move(next: PickableStage) {
    const back = undoStage(stage);
    start(async () => {
      const { error } = await setApplicationStage(jobId, next);
      if (error) {
        toast.show({ message: `Couldn't change the stage. ${error}` });
        return;
      }
      router.refresh();
      toast.show({
        message: `Moved to ${STAGE_LABEL[next]}.`,
        action: back
          ? {
              label: "Undo",
              onClick: async () => {
                const undone = await setApplicationStage(jobId, back);
                if (undone.error) {
                  toast.show({ message: `Couldn't move it back. ${undone.error}` });
                  return;
                }
                router.refresh();
              },
            }
          : undefined,
      });
    });
  }

  return (
    <>
      <SelectField
        id={id}
        label="Stage"
        hideLabel
        value={stage === "saved" ? "" : stage}
        placeholder={placeholder}
        // Saved is not a pick, so a saved job's menu draws Saved's own glyph
        // beside its placeholder, as every picked stage wears its own.
        placeholderIcon={
          stage === "saved" && placeholder === STAGE_LABEL.saved
            ? { Icon: STAGE_ICON.saved, iconClassName: STAGE_COLOR.saved.onTint }
            : undefined
        }
        options={PICKABLE.map((value) => ({
          value,
          label: STAGE_LABEL[value],
          Icon: STAGE_ICON[value],
          iconClassName: STAGE_COLOR[value].onTint,
        }))}
        disabled={pending}
        onValueChange={(next) => {
          if (!next || next === stage || pending) return;
          if (asksFirst(stage)) setAsking(next as PickableStage);
          else move(next as PickableStage);
        }}
        className={className}
      />
      <Dialog open={asking != null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-subtitle font-semibold">
              Move to {asking && STAGE_LABEL[asking]}?
            </DialogTitle>
            <DialogDescription>
              Once it moves, it can&apos;t go back to Saved. It takes today as its applied date if
              it has none.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button
              onClick={() => {
                if (asking) move(asking);
                setAsking(null);
              }}
            >
              Move to {asking && STAGE_LABEL[asking]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Interviews & Dates: every event on the application, soonest first, each
 * with its day in the viewer's own zone, its link and note, and Delete; and
 * Create Event. Deleting an event leaves the stage where it is, and its
 * toast's Undo adds the same event again (a new id; an interview, offer or
 * rejection moves the stage forward as Create Event does). Only an event
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
        <Card as="ul" padding="none" className="divide-border-subtle mt-3 divide-y">
          {events.map((event) => (
            <EventRow key={event.id ?? event.at + event.title} jobId={jobId} event={event} />
          ))}
        </Card>
      ) : (
        <p className="text-body text-ink-meta mt-3">
          Add interviews, assessments, offers and replies here. They show on your timeline and your
          Calendar.
        </p>
      )}
    </section>
  );
}

function EventRow({ jobId, event }: { jobId: string; event: ApplicationEvent }) {
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
              toast.show({
                message: `Deleted ${event.title}.`,
                action: {
                  label: "Undo",
                  onClick: async () => {
                    const added = await addApplicationEvent(jobId, readdEvent(event));
                    if (added.error) {
                      toast.show({ message: `Couldn't add ${event.title} back. ${added.error}` });
                      return;
                    }
                    router.refresh();
                  },
                },
              });
            })
          }
        >
          <TrashIcon className="size-4" />
        </IconButton>
      )}
    </li>
  );
}
