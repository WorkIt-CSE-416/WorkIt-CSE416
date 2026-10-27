import { Badge, type BadgeTone } from "@/components/ui/badge";

import { STAGE_LABEL, type StageKey } from "../stage-colors";

/**
 * What kind of email an update is (the API's `application_event_kind`,
 * KAN-413), shown as one pill wherever an email is listed: the Applications
 * Tracker's Updates table and an application's Emails. Each kind keeps one
 * name and one colour, the stage colours where a kind has a stage: an
 * interview is Interviewing's amber, an offer Offer's green, a rejection
 * Rejected's red, a confirmation Applied's violet. An assessment (a coding
 * or design challenge) is a task the student owes, so it takes the
 * "advanced" tone; anything else is a plain grey Update.
 */
export type EmailKind =
  "confirmation" | "assessment" | "interview" | "offer" | "rejection" | "other";

const KINDS: Record<EmailKind, { label: string; tone: BadgeTone }> = {
  confirmation: { label: "Application Received", tone: "brand" },
  assessment: { label: "Assessment", tone: "advanced" },
  interview: { label: "Interview", tone: "warning" },
  offer: { label: "Offer", tone: "positive" },
  rejection: { label: "Rejection", tone: "danger" },
  other: { label: "Update", tone: "inert" },
};

export function EmailKindPill({ kind }: { kind: EmailKind }) {
  return <Badge tone={KINDS[kind].tone}>{KINDS[kind].label}</Badge>;
}

/** The stage each kind moves an application to; the rest move none. */
const MOVES_TO: Partial<Record<EmailKind, StageKey>> = {
  interview: "interviewing",
  offer: "offer",
  rejection: "rejected",
};

/** How far along each stage is, as the API's `advance` ranks them. */
const RANK: Record<StageKey, number> = {
  saved: 0,
  applied: 1,
  interviewing: 2,
  offer: 3,
  rejected: 4,
};

/** What accepting it does, in a few words under its pill: the move it
 *  makes ("Moves to Interviewing"), else where it goes. Mirrors the API's
 *  `advance`, which decides; this only says it. */
export function acceptEffect(kind: EmailKind, stage: StageKey | undefined) {
  const target = MOVES_TO[kind];
  if (target && (stage == null || RANK[target] > RANK[stage])) {
    return `Moves to ${STAGE_LABEL[target]}`;
  }
  return kind === "assessment" ? "Adds its due date" : "Adds to the timeline";
}
