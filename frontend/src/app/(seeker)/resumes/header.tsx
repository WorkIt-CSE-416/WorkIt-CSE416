import type { ReactNode } from "react";

import { SegmentedLinks } from "@/components/ui/segmented-control";

export type ResumesView = "resumes" | "experiences";

/**
 * The header the two views of Resumes & Experiences share: the view's search
 * on the left and the switcher at the right, as on the Jobs page and the
 * Applications Tracker, with the view's primary action before it where it has
 * one (Fill With Scout on Experiences; the Resumes view's buttons sit on its
 * filter row since KAN-362). On a phone the search takes a line of its own, so
 * the switcher's words never squeeze it. The view's title is in the top bar
 * (../bar-title.tsx). The views are two routes, /resumes and /experiences, so every link to
 * either still lands; the switcher is plain links between them, not a
 * shallow move, since each view reads its own data on the server.
 *
 * They were two pages and two sidebar rows (Experience Bank, My Resumes)
 * until KAN-249: a student building a resume went back and forth between
 * them, and each page's header pointed at the other with a button of its own.
 */
export function ResumesHeader({
  view,
  search,
  action,
}: {
  view: ResumesView;
  search?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      {search}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        {action}
        <SegmentedLinks
          label="Resumes or Experiences"
          value={view}
          options={[
            { value: "resumes", label: "Resumes", href: "/resumes" },
            { value: "experiences", label: "Experiences", href: "/experiences" },
          ]}
        />
      </div>
    </header>
  );
}

/** The width of a search in this header: the Tracker's, down to where it
 *  takes its own line. */
export const RESUMES_SEARCH = "min-w-48 flex-1 @lg/main:max-w-64";
