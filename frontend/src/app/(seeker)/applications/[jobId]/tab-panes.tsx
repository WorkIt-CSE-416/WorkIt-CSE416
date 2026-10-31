"use client";

import type { ReactNode } from "react";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

import { INBOX_LIVE } from "../../inbox/live";

/**
 * The application page's tabs (./page.tsx), Your Application, Emails and
 * Job Description, kept in ?tab= so a tab can be linked to and survives a
 * reload. Emails is hidden while the Inbox is archived (KAN-428), and its
 * ?tab= opens Your Application then.
 *
 * THE TABS MOVE IN PLACE (`shallow`, components/shallow-routing.tsx). The
 * server draws both panes once and hands them to TabPanes, which shows the
 * one the query names. A tab was a link to the server: each click drew the
 * whole page again, the scored tracker read and the job's five reads with
 * it, for content the page already held, and the pane trailed the thumb by
 * that round trip (docs/motion.md: a choice the page can already draw never
 * waits on the server).
 *
 * Both read the tab with useShallowParams, so the thumb and the pane follow
 * the same query, Back and Forward included. A hard load or a reload
 * renders the pane ?tab= names on the server, since the query is the
 * request's there.
 */
type Tab = "application" | "emails" | "job";

/** The tab the page is showing. Your Application leads: it is what this
 *  page adds to the job's own, so any other ?tab= opens it. */
function useTab(): Tab {
  const tab = useShallowParams().get("tab");
  return tab === "job" || (tab === "emails" && INBOX_LIVE) ? tab : "application";
}

/** The tab switch, in the action bar or under the header (./page.tsx says
 *  which). `base` is the page's own address, with no query. */
export function ApplicationTabs({ base, className }: { base: string; className?: string }) {
  return (
    <SegmentedLinks
      shallow
      label="Application Tabs"
      value={useTab()}
      className={className}
      options={[
        { value: "application", label: "Your Application", href: base },
        // Archived with the Inbox (KAN-428, ../../inbox/live.ts).
        ...(INBOX_LIVE ? [{ value: "emails", label: "Emails", href: `${base}?tab=emails` }] : []),
        { value: "job", label: "Job Description", href: `${base}?tab=job` },
      ]}
    />
  );
}

/** The pane for the tab shown, of the two the server drew. */
export function TabPanes({
  application,
  emails,
  job,
}: {
  application: ReactNode;
  emails: ReactNode | null;
  job: ReactNode;
}) {
  const tab = useTab();
  return tab === "job" ? job : tab === "emails" ? emails : application;
}
