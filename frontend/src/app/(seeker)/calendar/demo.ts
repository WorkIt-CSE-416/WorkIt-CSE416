import { addDays, format, startOfWeek } from "date-fns";

import type { Application, EventKind, TrackerEvent } from "../tracker";

/**
 * THE SAMPLE WEEK (KAN-429): `?demo=1` on the Calendar, in local development
 * only (./page.tsx checks NODE_ENV), adds a spread of made-up entries to the
 * current week so the layout can be judged with a busy week rather than an
 * empty one. Nothing is written: the entries exist in this render alone,
 * and production never draws them.
 *
 * Each entry borrows a real application (its id, role and company, taken in
 * turn), so its card's View Application opens a real detail panel. A few
 * carry a note or a meeting link, and most none, as the event card shows.
 * The cases are chosen to
 * stress the layout: two events at the same moment, a chain of three that
 * overlap, a 15-minute call, a 90-minute interview, an early start (the grid
 * opens before 8 AM), a late one, a day stacked with all-day entries (the
 * all-day row and Month's "+N more"), and every kind at least once.
 *
 * Times are the server's local clock, which in development is the
 * developer's own, so they land where they read.
 */
type Sample = {
  day: number;
  kind: EventKind;
  title: string;
  /** "HH:mm" for a timed entry; none for an all-day one. */
  at?: string;
  /** Minutes, for one with an end. */
  minutes?: number;
  /** A note and a meeting link, so the event card shows both. */
  note?: string;
  link?: string;
  /** Filed from an email of this kind, as the Gmail reader would: a
   *  rejection email's time is when it came, so it lands on its day. */
  email?: TrackerEvent["emailKind"];
};

const SAMPLES: Sample[] = [
  // Sunday: a due day with no time.
  { day: 0, kind: "assessment", title: "Take-Home Due" },
  // Monday: three overlapping, and two all-day.
  {
    day: 1,
    kind: "interview",
    title: "Recruiter Screen",
    at: "10:00",
    minutes: 30,
    link: "https://meet.google.com/abc-defg-hij",
  },
  { day: 1, kind: "assessment", title: "CodeSignal Window", at: "10:15", minutes: 60 },
  { day: 1, kind: "follow-up", title: "Follow Up With Recruiter", at: "10:45" },
  { day: 1, kind: "apply-by", title: "Apply By" },
  { day: 1, kind: "closes", title: "Application Closes" },
  // Tuesday: a long interview and an offer.
  {
    day: 2,
    kind: "interview",
    title: "Onsite: System Design",
    at: "13:00",
    minutes: 90,
    note: "Two interviewers. Bring questions about the team's on-call.\nReview the rate limiter design first.",
  },
  { day: 2, kind: "offer", title: "Offer Call", at: "16:00", minutes: 30 },
  // Wednesday: a 15-minute call, and a stack of all-day entries.
  { day: 3, kind: "interview", title: "Quick Sync", at: "09:00", minutes: 15 },
  { day: 3, kind: "applied", title: "Applied" },
  { day: 3, kind: "applied", title: "Applied" },
  { day: 3, kind: "applied", title: "Applied" },
  { day: 3, kind: "apply-by", title: "Apply By" },
  { day: 3, kind: "closes", title: "Application Closes" },
  // Thursday: an early start and a late one, both at the same minute as
  // another to show two side by side.
  { day: 4, kind: "interview", title: "Early Phone Screen", at: "07:00" },
  { day: 4, kind: "interview", title: "Hiring Manager Chat", at: "14:00" },
  { day: 4, kind: "assessment", title: "Design Exercise Review", at: "14:00" },
  { day: 4, kind: "follow-up", title: "Thank-You Note", at: "19:30" },
  // Friday: a rejection and an afternoon interview.
  {
    day: 5,
    kind: "rejection",
    title: "Not Moving Forward",
    at: "11:20",
    email: "rejection",
    note: "Thank you for your interest. After careful review, the team has decided to move forward with other candidates for this role. We encourage you to apply again for future openings that match your background, and we will keep your resume on file for the next twelve months. We wish you the best in your search.",
  },
  {
    day: 5,
    kind: "interview",
    title: "Final Round",
    at: "15:00",
    minutes: 60,
    note: "Behavioral with the hiring manager.",
    link: "https://zoom.us/j/1234567890",
  },
  // Saturday: left empty on purpose.
];

/** The sample week's entries on `applications`, or none when there are none
 *  to borrow. */
export function sampleWeek(applications: Application[], now: Date): TrackerEvent[] {
  if (applications.length === 0) return [];
  const sunday = startOfWeek(now);

  return SAMPLES.map((sample, i) => {
    const app = applications[i % applications.length];
    const day = addDays(sunday, sample.day);
    let at = format(day, "yyyy-MM-dd");
    let endsAt: string | null = null;
    if (sample.at) {
      const [hour, minute] = sample.at.split(":").map(Number);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      at = start.toISOString();
      if (sample.minutes) endsAt = new Date(start.getTime() + sample.minutes * 60000).toISOString();
    }
    return {
      id: `demo-${i}`,
      applicationId: app.id,
      role: app.role,
      company: app.company,
      kind: sample.kind,
      title: sample.title,
      at,
      endsAt,
      note: sample.note ?? null,
      meetingUrl: sample.link ?? null,
      ...(sample.email && { source: "gmail" as const, emailKind: sample.email }),
    };
  });
}
