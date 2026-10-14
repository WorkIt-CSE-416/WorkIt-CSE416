import type { Metadata } from "next";

import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { ApplyingResume } from "./applying-resume";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Built in pipeline to auto apply to jobs. One resume, auto submit jobs",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it will grow into is `auto-apply/design.md` at the repo root:
 * match, tailor the resume, fill the form with the extension, record.
 *
 * Today it holds one live section, the resume an application goes out with
 * (./applying-resume.tsx). It uses the heading block every seeker screen
 * does. A <div>, since SidebarInset is already the <main>.
 */
export default function AutoApplyPage() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Auto Apply</h1>
      <p className="text-body text-ink-meta mt-1">
        Apply to the jobs that match you, with your resume filled in for you.
      </p>

      <ApplyingResume />
    </div>
  );
}
