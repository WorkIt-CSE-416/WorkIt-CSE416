import { ClipboardTextIcon, InfoIcon } from "@phosphor-icons/react/ssr";
import type { ComponentType } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";

import { STAGE_COLOR, STAGE_ICON } from "../stage-colors";

/**
 * What kind of email an update is (the API's `application_event_kind`,
 * KAN-413), shown as one pill wherever an email is listed: the Inbox and
 * an application's Emails tab. Each kind keeps one
 * name and one colour, the stage colours where a kind has a stage: an
 * interview is Interviewing's amber, an offer Offer's green, a rejection
 * Rejected's red. An assessment (a coding or design challenge) is a task
 * the student owes, so it takes the "advanced" tone. A confirmation and
 * any other update are plain grey: they change nothing, and in violet they
 * were the loudest pills in the list (the KAN-413 critique). Each pill
 * carries its kind's glyph (KAN-427), the one its Inbox filter option has.
 */
export type EmailKind =
  "confirmation" | "assessment" | "interview" | "offer" | "rejection" | "other";

/** Each kind's glyph and the text colour that matches its pill, for a
 *  filter option (the Inbox's Status, KAN-427), as the Tracker's Status
 *  options wear their stage's (applications/field-filters.tsx). A kind with
 *  a stage takes that stage's glyph and colour; an assessment a clipboard
 *  in the "advanced" blue; a confirmation Applied's briefcase and an update
 *  an info mark, both grey like their pills. */
const KINDS: Record<
  EmailKind,
  {
    label: string;
    tone: BadgeTone;
    Icon: ComponentType<{ className?: string }>;
    iconClassName: string;
  }
> = {
  confirmation: {
    label: "Application Received",
    tone: "inert",
    Icon: STAGE_ICON.applied,
    iconClassName: "text-ink-meta",
  },
  assessment: {
    label: "Assessment",
    tone: "advanced",
    Icon: ClipboardTextIcon,
    iconClassName: "text-advanced",
  },
  interview: {
    label: "Interview",
    tone: "warning",
    Icon: STAGE_ICON.interviewing,
    iconClassName: STAGE_COLOR.interviewing.onTint,
  },
  offer: {
    label: "Offer",
    tone: "positive",
    Icon: STAGE_ICON.offer,
    iconClassName: STAGE_COLOR.offer.onTint,
  },
  rejection: {
    label: "Rejection",
    tone: "danger",
    Icon: STAGE_ICON.rejected,
    iconClassName: STAGE_COLOR.rejected.onTint,
  },
  other: { label: "Update", tone: "inert", Icon: InfoIcon, iconClassName: "text-ink-meta" },
};

/** A kind's glyph and its colour, for a filter option. */
export function emailKindGlyph(kind: EmailKind) {
  return { Icon: KINDS[kind].Icon, iconClassName: KINDS[kind].iconClassName };
}

/** The kind's pill: its glyph and its name, in its tone. The glyph takes
 *  the pill's own text colour, which is the colour the Inbox's Status
 *  option wears (KAN-427), so a pill and its filter match. */
export function EmailKindPill({ kind }: { kind: EmailKind }) {
  const { label, tone, Icon } = KINDS[kind];
  return (
    <Badge tone={tone}>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-flex">
          <Icon className="size-3.5" />
        </span>
        {label}
      </span>
    </Badge>
  );
}
