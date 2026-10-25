import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../../gutter";
import { BackToJobs } from "../page-actions";

/**
 * Tailor while the posting and the resumes load (KAN-368). Its own file,
 * not for speed but for shape: the job page's loading.tsx (../loading.tsx)
 * wraps every route under it, Tailor included, so without this one the
 * Tailor page would load behind a job page's skeleton. It draws Tailor's
 * frame (./page.tsx): Back (live), the title, the posting's line as a bar,
 * and the opening card.
 *
 * From the job page's own Tailor My Resume, the way in, the job's segment
 * is already on screen, so this is the skeleton that shows. A link to
 * Tailor from any other page prefetches only down to the job page's
 * boundary, and shows the job page's skeleton first.
 */
export default function TailorLoading() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackToJobs />
      <h1 className="text-heading text-ink">Tailor</h1>
      <div role="status" className="mt-1">
        <span className="sr-only">Loading the job posting</span>
        <Skeleton aria-hidden="true" className="h-5 w-72 max-w-full" />
        <Card as="section" aria-hidden="true" className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-2 h-9 w-36" />
        </Card>
      </div>
    </div>
  );
}
