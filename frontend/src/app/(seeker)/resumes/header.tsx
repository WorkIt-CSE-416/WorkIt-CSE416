import type { ReactNode } from "react";

import { SegmentedLinks } from "@/components/ui/segmented-control";

export type ResumesView = "resumes" | "experiences";

/** Each view's own title and line, so the heading says where you are. */
const VIEWS: Record<ResumesView, { title: string; description: string }> = {
  resumes: {
    title: "Resumes",
    description: "Resumes made from your experiences, and every one you sent.",
  },
  experiences: {
    title: "Experiences",
    description: "Add each thing you did once. Every resume you make draws from here.",
  },
};

/**
 * The header the two views of Resumes & Experiences share: the view's own
 * title and line on the left, and at the top right the switcher, then the
 * view's primary action (Generate Resume, or Fill With Scout). It is drawn
 * as the Dashboard's is: a <header> whose controls sit at the right, level
 * with the foot of the title's block, and wrap under it where the page is
 * narrow. The views are two routes, /resumes and /bank, so every link to
 * either still lands; the switcher is plain links between them, not a
 * shallow move, since each view reads its own data on the server.
 *
 * They were two pages and two sidebar rows (Experience Bank, My Resumes)
 * until KAN-249: a student building a resume went back and forth between
 * them, and each page's header pointed at the other with a button of its own.
 */
export function ResumesHeader({ view, action }: { view: ResumesView; action?: ReactNode }) {
  const { title, description } = VIEWS[view];
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-heading text-ink">{title}</h1>
        <p className="text-body text-ink-meta mt-1">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedLinks
          label="Resumes or Experiences"
          value={view}
          options={[
            { value: "resumes", label: VIEWS.resumes.title, href: "/resumes" },
            { value: "experiences", label: VIEWS.experiences.title, href: "/bank" },
          ]}
        />
        {action}
      </div>
    </header>
  );
}
