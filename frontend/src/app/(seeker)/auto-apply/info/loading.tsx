import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeadingSkeleton } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { FIELD_GRID, SECTION_CARD } from "../../profile/field-styles";

/**
 * Application Info while the answers and the bank load (KAN-561): the
 * page's frame (./page.tsx) with Back live, then the side list of sections
 * and the first cards (./info-screen.tsx) as bars. Up Next's own skeleton
 * sits in ../(queue), so it never stands in for this page.
 */
export default function ApplicationInfoLoading() {
  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={{ href: "/auto-apply", name: "Auto Apply" }} named className="group/back" />
      <div role="status" className="mt-6 grid gap-8 @4xl/main:grid-cols-[12rem_minmax(0,1fr)]">
        <span className="sr-only">Loading your application info</span>
        <ul aria-hidden="true" className="hidden flex-col gap-0.5 @4xl/main:flex">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex h-9 items-center px-3">
              <Skeleton className="h-3.5 w-28" />
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="flex min-w-0 flex-col gap-5">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-96 max-w-full" />
          </div>
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i} padding="none" className={SECTION_CARD}>
              <SectionHeadingSkeleton />
              <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
              <div className={FIELD_GRID}>
                {Array.from({ length: 4 }, (_, j) => (
                  <div key={j} className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
