"use server";

import { applicantCall, encodeId } from "@/lib/applicant-call";

/**
 * The Applications Tracker's own writes (KAN-413), through the API's routes
 * (backend/app/routers/tracker.py): the stage menu, Add Event and an
 * event's Delete, on an application's page. Every export of a "use server"
 * file is a public POST endpoint: these take a job or event id and the
 * fields, and the applicant is always the session's own. The caller
 * refreshes the page after a success, so the tracker's read draws the
 * change everywhere at once (the list, the Calendar, the Dashboard).
 */

/** The stage menu's picks: applied or later. A record never goes back to a
 *  bookmark or the queue. */
export type PickableStage = "applied" | "interviewing" | "offer" | "rejected";

/** Add Event's kinds, as the API names them. A confirmation only comes from
 *  an email, so it is not one. */
export type NewEventKind = "interview" | "assessment" | "offer" | "rejection" | "other";

export type NewEvent = {
  kind: NewEventKind;
  title: string;
  /** An ISO instant with its zone, for something at a time; else `onDay`. */
  at: string | null;
  /** "YYYY-MM-DD", for something due on a day. */
  onDay: string | null;
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

/** Add Event (POST .../applications/{job_id}/events). An interview, offer
 *  or rejection moves the application forward; the API says so and the
 *  refreshed page shows it. */
export async function addApplicationEvent(jobId: string, event: NewEvent) {
  return send(`/applications/${encodeId(jobId)}/events`, {
    method: "POST",
    body: JSON.stringify({
      kind: event.kind,
      title: event.title,
      at: event.at,
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
