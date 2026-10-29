"use client";

import {
  BriefcaseIcon,
  CalendarDotsIcon,
  FileTextIcon,
  ListChecksIcon,
  HouseIcon,
  TrayIcon,
  UserCircleIcon,
} from "@phosphor-icons/react/ssr";
import { LightningRoundedIcon } from "@/components/custom-icons";
import type { ReactNode } from "react";

import { AppSidebar, type SidebarNavGroup } from "@/components/app-sidebar";

import { INBOX_LIVE } from "./inbox/live";

/**
 * The seeker shell's left panel, the rail (see RAIL in
 * @/components/app-sidebar): the hunt itself, the sections a job seeker
 * moves between all through a search, Home first as the home, with no
 * caption over them. These used to be tabs in the top bar.
 *
 * Nothing about the app rather than the work lives here. Settings, Help and
 * Sign Out were a second group, General, under this one; they moved to the
 * menu the bar's photo opens (SeekerAccount in ./account-status.tsx), where
 * people look for them, so the panel holds only the search and each of
 * those has one home. There is no Sign In anywhere in the shell: it only
 * renders for someone signed in, and the layout sends anyone else to
 * /login.
 *
 * There is no Search row. /search is where the bar's own field lands a query
 * (and, on a phone, the bar's magnifier), and a row beside that field would
 * be a second, contradictory way to reach it.
 *
 * Auto Apply sits between Jobs and Applications, in the order the work goes:
 * find the jobs, apply to them, track what was sent.
 *
 * Applications' glyph is ListChecks, what the page is for (tracking what was
 * sent), not how it is laid out. It was SquareKanban, the board's shape, and
 * went stale when the list replaced the board (KAN-256, KAN-317). Not
 * ClipboardList: a framed page with lines, it read as FileText, the next
 * row down.
 *
 * Inbox and Calendar sit after Resumes & Experiences (KAN-426): they hold
 * what comes back once applications are out, replies and dated events, so
 * the tools for applying come first and the follow-up after them.
 * Calendar's glyph is CalendarDots, not CalendarBlank: the plain calendar is
 * the Interviewing stage's glyph (../stage-colors.ts), and a nav row wearing
 * it would read as a stage.
 *
 * My Profile is a row rather than something behind the account in the bar:
 * a profile is somewhere a job seeker goes back to all through a hunt, not
 * somewhere they visit once, and a click of depth is the wrong price for
 * that. "My" is what separates it from an employer's profile, which the
 * company shell also has to name.
 *
 * Resumes & Experiences sits right after the Applications Tracker, beside
 * the work it feeds: every application goes out with a resume. It sat just
 * above My Profile, after Calendar, until KAN-426. It is one row for two
 * views, Resumes (/resumes) and Experiences (/bank, where resume facts are
 * kept, KAN-206), lit on either (`also`) and on the resume editor under
 * /resumes. They were two rows, Experience Bank and My Resumes, until
 * KAN-249 merged them behind one switcher. Its glyph is FileText, the one
 * on Generate Resume.
 *
 * On the rail a name sits under its icon in a 72px tile, so three names
 * take a `short` there: Tracker, Resumes and Profile. Each page's heading
 * and the phone's sheet keep the full name.
 */
const GROUPS: SidebarNavGroup[] = [
  {
    // No caption: with one group there is nothing to tell it apart from.
    items: [
      { href: "/home", label: "Home", Icon: HouseIcon },
      { href: "/jobs", label: "Jobs", Icon: BriefcaseIcon },
      { href: "/auto-apply", label: "Auto Apply", Icon: LightningRoundedIcon },
      {
        href: "/applications",
        label: "Applications Tracker",
        short: "Tracker",
        Icon: ListChecksIcon,
      },
      {
        href: "/resumes",
        also: ["/bank"],
        label: "Resumes & Experiences",
        short: "Resumes",
        Icon: FileTextIcon,
      },
      // KAN-413: replies to applications, after the tools that send them.
      // No count badge: one was built and taken out as out of place.
      // Archived with the Inbox until WorkIt has a source of emails
      // (KAN-428, ./inbox/live.ts).
      ...(INBOX_LIVE ? [{ href: "/inbox", label: "Inbox", Icon: TrayIcon }] : []),
      // Back since KAN-413: interviews, assessments and offers are stored.
      { href: "/calendar", label: "Calendar", Icon: CalendarDotsIcon },
      { href: "/profile", label: "My Profile", short: "Profile", Icon: UserCircleIcon },
    ],
  },
];

/** `card` is the profile strength card, rendered on the server by the layout
 *  (it reads the API) and passed through, since this panel is a client
 *  component. */
export function SeekerSidebar({ card }: { card?: ReactNode }) {
  return (
    <AppSidebar
      groups={GROUPS}
      footerCard={card}
      label="Job Search Sections"
      variant="rail"
      home="/home"
    />
  );
}
