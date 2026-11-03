import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeadingSkeleton } from "@/components/ui/section-heading";

/**
 * The composer while a saved posting loads into it (KAN-561): the page's
 * frame (../../new/composer.tsx) with the title, its line, the status row
 * and the steps as bars, then the first step's card with its fields.
 */
export default function EditJobLoading() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <div role="status">
        <span className="sr-only">Loading the job posting</span>
        <div aria-hidden="true">
          <div className="flex h-8 items-center">
            <Skeleton className="h-6 w-56 max-w-full" />
          </div>
          <div className="mt-1 flex h-5 items-center">
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="mt-4 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-8 flex-1" />
            ))}
          </div>
          <Card padding="none" className="mt-5 p-4.5">
            <div className="border-border-subtle border-b pb-3">
              <SectionHeadingSkeleton />
            </div>
            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
