import { Badge, type BadgeTone } from "@/components/ui/badge";

/**
 * What kind of email an update is (the API's `application_event_kind`,
 * KAN-413), shown as one pill wherever an email is listed: the Inbox and
 * an application's Emails tab. Each kind keeps one
 * name and one colour, the stage colours where a kind has a stage: an
 * interview is Interviewing's amber, an offer Offer's green, a rejection
 * Rejected's red. An assessment (a coding or design challenge) is a task
 * the student owes, so it takes the "advanced" tone. A confirmation and
 * any other update are plain grey: they change nothing, and in violet they
 * were the loudest pills in the list (the KAN-413 critique).
 */
export type EmailKind =
  "confirmation" | "assessment" | "interview" | "offer" | "rejection" | "other";

const KINDS: Record<EmailKind, { label: string; tone: BadgeTone }> = {
  confirmation: { label: "Application Received", tone: "inert" },
  assessment: { label: "Assessment", tone: "advanced" },
  interview: { label: "Interview", tone: "warning" },
  offer: { label: "Offer", tone: "positive" },
  rejection: { label: "Rejection", tone: "danger" },
  other: { label: "Update", tone: "inert" },
};

export function EmailKindPill({ kind }: { kind: EmailKind }) {
  return <Badge tone={KINDS[kind].tone}>{KINDS[kind].label}</Badge>;
}
