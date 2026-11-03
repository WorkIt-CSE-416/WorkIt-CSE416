import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeadingSkeleton } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { RESUMES_SEARCH, ResumesHeader } from "../resumes/header";

/**
 * Experiences while the bank loads (KAN-561): the page's frame (./page.tsx),
 * the Resumes or Experiences switch live, then the search, Fill With Scout,
 * the Showing card, the section links and the first sections
 * (./bank-screen.tsx) as bars.
 */
export default function ExperiencesLoading() {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="flex flex-col gap-4">
        <ResumesHeader
          view="experiences"
          search={
            <Skeleton aria-hidden="true" className={cn(RESUMES_SEARCH, "h-10 rounded-full")} />
          }
          action={<Skeleton aria-hidden="true" className="h-9 w-36" />}
        />
        <div role="status" className="flex flex-col gap-4">
          <span className="sr-only">Loading your experiences</span>
          <Card aria-hidden="true" className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0" />
            <Skeleton className="h-4 w-48" />
          </Card>
          <div aria-hidden="true" className="flex flex-wrap gap-2 px-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i} aria-hidden="true">
              <SectionHeadingSkeleton />
              {Array.from({ length: 2 }, (_, j) => (
                <div key={j} className="mt-4 flex flex-col gap-2">
                  <Skeleton className="h-4 w-64 max-w-full" />
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-5/6" />
                </div>
              ))}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
