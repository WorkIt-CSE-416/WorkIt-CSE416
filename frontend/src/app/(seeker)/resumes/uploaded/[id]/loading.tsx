import { Skeleton } from "@/components/shadcn/skeleton";
import { cn } from "@/lib/cn";

import { BackLink } from "../../../back-link";
import { SEEKER_GUTTER } from "../../../gutter";
import { PageSkeleton } from "../../[resumeId]/pdf-pages";

/**
 * An uploaded resume's page while it loads (KAN-368): the page reads the
 * resume list, then the file itself from Storage (./page.tsx), before it
 * draws anything. This is its frame (./viewer.tsx): Back (live), the name as
 * a bar of the title's line, the bar's box with its date and buttons as
 * bars, and a page's skeleton where pdf.js will draw the file.
 * ../../../dashboard/loading.tsx says why only the slow pages have one.
 */
export default function UploadedResumeLoading() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={{ href: "/resumes", name: "Resumes" }} />
      <div role="status">
        <span className="sr-only">Loading the resume</span>
        <Skeleton aria-hidden="true" className="h-8 w-56 max-w-full" />
        <div aria-hidden="true" className="mt-4 flex flex-col gap-4">
          <div className="bg-brand-tint/95 ring-brand-pale flex min-h-12 flex-wrap items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-sm ring-1">
            <Skeleton className="h-4 w-32" />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}
