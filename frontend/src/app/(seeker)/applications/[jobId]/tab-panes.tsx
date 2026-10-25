"use client";

import type { ReactNode } from "react";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

/**
 * The application page's two tabs (./page.tsx), Your Application and Job
 * Description, kept in ?tab= so a tab can be linked to and survives a reload.
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
type Tab = "application" | "job";

/** The tab the page is showing. Your Application leads: it is what this
 *  page adds to the job's own, so any other ?tab= opens it. */
function useTab(): Tab {
  return useShallowParams().get("tab") === "job" ? "job" : "application";
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
        { value: "job", label: "Job Description", href: `${base}?tab=job` },
      ]}
    />
  );
}

/** The pane for the tab shown, of the two the server drew. */
export function TabPanes({ application, job }: { application: ReactNode; job: ReactNode }) {
  return useTab() === "job" ? job : application;
}
