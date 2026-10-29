"use server";

import { applicantCall, encodeId } from "@/lib/applicant-call";

/**
 * The Applications Tracker's own writes (KAN-413), through the API's routes
 * (backend/app/routers/tracker.py): the stage menu, Create Event and an
 * event's Delete, on an application's page. Every export of a "use server"
 * file is a public POST endpoint: these take a job or event id and the
 * fields, and the applicant is always the session's own. The caller
 * refreshes the page after a success, so the tracker's read draws the
 * change everywhere at once (the list, the Calendar, Home).
 */

/** The stage menu's picks: applied or later. A record never goes back to a
 *  bookmark or the queue. */
export type PickableStage = "applied" | "interviewing" | "offer" | "rejected";

/** Create Event's kinds, as the API names them. A confirmation only comes from
 *  an email, so it is not one. */
export type NewEventKind = "interview" | "assessment" | "offer" | "rejection" | "other";

export type NewEvent = {
  kind: NewEventKind;
  title: string;
  /** An ISO instant with its zone, for something at a time; else `onDay`. */
  at: string | null;
  /** "YYYY-MM-DD", for something due on a day. */
  onDay: string | null;
  /** An ISO instant after `at`, for a timed event's end (KAN-429). */
  endsAt?: string | null;
  note: string;
  meetingUrl: string;
};

/** Every write's answer: the API's message on a refusal, else null. */
async function send(path: string, init: RequestInit): Promise<{ error: string | null }> {
  const { error } = await applicantCall<unknown>(path, init);
  return { error };
}

/** The stage menu (PUT .../applications/{job_id}/stage). */
export async function setApplicationStage(jobId: string, stage: PickableStage) {
  return send(`/applications/${encodeId(jobId)}/stage`, {
    method: "PUT",
    body: JSON.stringify({ stage }),
  });
}

/** Create Event (POST .../applications/{job_id}/events). An interview, offer
 *  or rejection moves the application forward; the API says so and the
 *  refreshed page shows it. */
export async function addApplicationEvent(jobId: string, event: NewEvent) {
  return send(`/applications/${encodeId(jobId)}/events`, {
    method: "POST",
    body: JSON.stringify({
      kind: event.kind,
      title: event.title,
      at: event.at,
      ends_at: event.endsAt ?? null,
      on_day: event.onDay,
      note: event.note || null,
      meeting_url: event.meetingUrl || null,
    }),
  });
}

/** An event's Delete (DELETE .../events/{event_id}). The stage stays. */
export async function deleteApplicationEvent(eventId: string) {
  const { error, status } = await applicantCall<unknown>(`/events/${encodeId(eventId)}`, {
    method: "DELETE",
  });
  // Already gone (another tab deleted it): what was asked for is true.
  return { error: status === 404 ? null : error };
}

/** An update's Accept (POST .../events/{event_id}/accept): it goes on the
 *  tracker, on `jobId` when given (an unmatched email's pick) else on the
 *  application it matched, which it moves forward as Create Event does. */
export async function acceptUpdate(eventId: string, jobId: string | null) {
  return send(`/events/${encodeId(eventId)}/accept`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });
}

/** An update's dismiss cross (POST
 *  .../events/{event_id}/dismiss): it stays off the tracker. */
export async function dismissUpdate(eventId: string) {
  return send(`/events/${encodeId(eventId)}/dismiss`, { method: "POST" });
}

/** The Inbox's Mark as Read and Mark as Unread (PUT .../emails/read,
 *  KAN-427), on every email named, all or none; opening an email sends its
 *  one id. */
export async function markEmailsRead(eventIds: string[], read: boolean) {
  return send("/emails/read", {
    method: "PUT",
    body: JSON.stringify({ ids: eventIds, read }),
  });
}

/** A saved job's Apply by (PUT .../applications/{job_id}/apply-by,
 *  KAN-429): the student's own day to apply by, "YYYY-MM-DD", or null to
 *  clear it. */
export async function setApplyBy(jobId: string, applyBy: string | null) {
  return send(`/applications/${encodeId(jobId)}/apply-by`, {
    method: "PUT",
    body: JSON.stringify({ apply_by: applyBy }),
  });
}
