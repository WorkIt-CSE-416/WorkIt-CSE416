import type { ReactNode } from "react";

import { SegmentedLinks } from "@/components/ui/segmented-control";

export type ResumesView = "resumes" | "experiences";

/**
 * The header the two views of Resumes & Experiences share: the switcher on the
 * left and, at the right, the view's primary action where it has one (Fill
 * With Scout on Experiences; the Resumes view's buttons sit on its filter row
 * since KAN-362). The view's title is in the top bar (../bar-title.tsx). The
 * views are two routes, /resumes and /experiences, so every link to
 * either still lands; the switcher is plain links between them, not a
 * shallow move, since each view reads its own data on the server.
 *
 * They were two pages and two sidebar rows (Experience Bank, My Resumes)
 * until KAN-249: a student building a resume went back and forth between
 * them, and each page's header pointed at the other with a button of its own.
 */
export function ResumesHeader({ view, action }: { view: ResumesView; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedLinks
        label="Resumes or Experiences"
        value={view}
        options={[
          { value: "resumes", label: "Resumes", href: "/resumes" },
          { value: "experiences", label: "Experiences", href: "/experiences" },
        ]}
      />
      {action}
    </header>
  );
}
