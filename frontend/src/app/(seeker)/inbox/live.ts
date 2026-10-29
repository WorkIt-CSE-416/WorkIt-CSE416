/**
 * Whether the Inbox is shown (KAN-428). It is archived until WorkIt has a
 * source of emails: reading Gmail needs Google's verification and a yearly
 * CASA assessment the team cannot pay for yet (docs/email_tracker.md,
 * "Google's rules"), and without it every student saw an empty Inbox that
 * promised a Gmail connection that did not exist. Students track
 * applications by hand meanwhile (the stage menu and Add Event).
 *
 * Off, it hides every place that shows or promises emails: the sidebar's
 * Inbox row (../seeker-sidebar.tsx), /inbox itself, which goes to the
 * Applications Tracker (./page.tsx), Gmail's row in Settings > Integrations,
 * an application's Emails tab, and the Tracker's "emails need a look" line;
 * and those pages stop reading emails from the API. The Inbox's code, the
 * `read_at` column and the API's email routes stay as they are. Set it to
 * true to bring all of it back at once.
 */
export const INBOX_LIVE = false;
