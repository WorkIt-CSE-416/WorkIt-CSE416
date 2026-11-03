"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useShallowParams } from "@/components/shallow-routing";
import { SegmentedLinks } from "@/components/ui/segmented-control";

/**
 * A job's Overview and Company (KAN-519, after Simplify's job page), in ?tab= as
 * the application page's tabs are (../../applications/[jobId]/tab-panes.tsx,
 * which says why): they move in place, since the server drew both panes. They
 * keep the rest of the query, so on the split view's /jobs a tab keeps the
 * list's filters.
 */
function useCompanyTab() {
  return useShallowParams().get("tab") === "company";
}

/** The switch, in the job's action bar. */
export function JobTabs() {
  const company = useCompanyTab();
  const params = new URLSearchParams(useShallowParams());
  const path = usePathname();
  params.delete("tab");
  const overview = params.toString();
  params.set("tab", "company");
  return (
    <SegmentedLinks
      shallow
      label="Job Tabs"
      value={company ? "company" : "overview"}
      options={[
        {
          value: "overview",
          label: "Overview",
          href: overview ? `${path}?${overview}` : path,
        },
        { value: "company", label: "Company", href: `${path}?${params}` },
      ]}
    />
  );
}

/** The pane for the tab shown, of the two the server drew. */
export function JobTabPanes({ overview, company }: { overview: ReactNode; company: ReactNode }) {
  return useCompanyTab() ? company : overview;
}
