import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { claudeConnectorLink } from "@/lib/claude-connector";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { AutoApplyPanel } from "./auto-apply-panel";

/**
 * Auto Apply while its four reads land (KAN-368): the queue, the saved jobs
 * with their scores, and both resume lists (./page.tsx). Two of them score,
 * so a click on the sidebar's row drew nothing new for a while; now the
 * prefetched state below is drawn in the click's next frame
 * (../dashboard/loading.tsx says why only the slow pages have one).
 *
 * The page's own frame: the width, then the real heading block
 * (./auto-apply-panel.tsx), so the title, its line and both buttons sit
 * exactly where the page puts them. Start stays off until the page knows
 * there is a resume, as it is off without one; Manage Resumes already
 * works. Then Up Next's heading, Add Jobs as a bar, and the queue's card
 * with rows in a row's shape.
 */
export default function AutoApplyLoading() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <AutoApplyPanel hasResume={false} claudeLink={claudeConnectorLink()}>
        <section aria-labelledby="up-next" aria-busy="true" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeading id="up-next">Up Next</SectionHeading>
            <Skeleton aria-hidden="true" className="h-9 w-28" />
          </div>
          <Card padding="none" aria-hidden="true" className="mt-3 overflow-hidden">
            <div className="border-border-subtle flex h-10 items-center gap-6 border-b px-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="ml-auto h-3 w-16" />
              <Skeleton className="h-3 w-16" />
            </div>
            <ul>
              {Array.from({ length: 4 }, (_, i) => (
                <li
                  key={i}
                  className="border-border-subtle flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <Skeleton className="rounded-control size-9 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-48 max-w-full" />
                    <Skeleton className="h-3 w-28 max-w-full" />
                  </span>
                  <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
                  <Skeleton className="h-3 w-20 shrink-0" />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </AutoApplyPanel>
    </div>
  );
}
