import { cache } from "react";

import { getEmails, getTracked, getUpdates } from "./tracked";

/**
 * The application tracker (KAN-261): the seeker's saved and applied jobs,
 * live from the API (./tracked.ts). Read by the Applications board, grid and
 * list, the Calendar, and Home's Saved count, Next Up and Up Next.
 * Stages past applied (interviewing, offer) and dated events (interviews,
 * deadlines) are not stored yet, so those columns and Up Next stay empty
 * until the API keeps them; ../tracker.ts is the shape they will take.
 */

/** The time of the request, read once. cache() so every component in one
 *  render agrees on it: the pages ask what is still upcoming against the
 *  same instant. */
export const getNow = cache(() => new Date());

/**
 * Every application the seeker is tracking: their saved and applied jobs,
 * newest first, or an `error` when the API can't be read (never stand-in
 * cards: backend/CLAUDE.md). cache() so the pages and the components under
 * them read the API once per request.
 */
export const getTracker = cache(getTracked);

/** Every application, as getTracker reads them; none when it failed. */
export async function getApplications() {
  return (await getTracker()).applications ?? [];
}

/** The seeker's updates (./tracked.ts), read once per request: the
 *  Applications Tracker's notice counts the ones that need review. */
export const getUpdatesOnce = cache(getUpdates);

/** The seeker's emails (./tracked.ts), read once per request: the Inbox
 *  and an application's Emails tab. */
export const getEmailsOnce = cache(getEmails);
