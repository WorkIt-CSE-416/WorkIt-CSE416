import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../../gutter";
import { BackToJobs } from "../page-actions";
import { TailorSteps } from "./tailor-steps";

/**
 * Tailor while the posting and the resumes load (KAN-368). Its own file,
 * not for speed but for shape: the job page's loading.tsx (../loading.tsx)
 * wraps every route under it, Tailor included, so without this one the
 * Tailor page would load behind a job page's skeleton. It draws Tailor's
 * frame (./page.tsx, `TailorHeader`): Back (live), the title and its line
 * as bars, the job card's shape, the steps at Pick a Resume, and the
 * picker card.
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
      <div role="status">
        <span className="sr-only">Loading the job posting</span>
        <div aria-hidden="true">
          {/* The title's and its line's heights, so nothing under them moves. */}
          <div className="flex h-8 items-center">
            <Skeleton className="h-7 w-96 max-w-full" />
          </div>
          <Skeleton className="mt-1 h-5 w-[36rem] max-w-full" />
          <Card as="section" padding="md" className="mt-4 flex items-start gap-3">
            <Skeleton className="rounded-control size-10 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-64 max-w-full" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
          </Card>
        </div>
      </div>
      <TailorSteps current="pick" />
      <Card as="section" aria-hidden="true" className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="mt-2 h-9 w-36" />
      </Card>
    </div>
  );
}
