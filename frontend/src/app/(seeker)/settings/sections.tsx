import { Suspense } from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";

import { IntegrationsSection } from "./integrations/section";
import { NotificationsSection } from "./notifications/section";
import { PersonalSection } from "./personal/section";
import { PreferencesSection } from "./preferences/section";
import { SecuritySection } from "./security/section";

/**
 * Every Settings section, drawn on the server and handed to the modal
 * (./settings-modal.tsx), which shows one and keeps the rest mounted
 * (KAN-364). Both ways into Settings call this: ./layout.tsx on a hard load
 * and ../@modal/(.)settings/layout.tsx on a soft navigation.
 *
 * EACH SECTION THAT READS STREAMS IN ITS OWN <Suspense> (KAN-368). Personal
 * Details reads the profile and the photo, Job Preferences the saved
 * filters and the role options (the facets and the locations), and with no
 * boundary the modal opened only once the slowest of those had answered.
 * Now the route's layout awaits nothing, so the modal opens as soon as the
 * route's first bytes arrive, over each section's skeleton: its own card
 * and heading with bars where the fields go. A section's form mounts once,
 * when its data arrives, so its unsaved-changes guard (./unsaved-changes)
 * only ever starts clean; a refresh after a save keeps the drawn form, since
 * React never falls back a boundary that is already showing.
 *
 * NO loading.tsx FOR THE MODAL. A loading.tsx in ../@modal/(.)settings sits
 * inside that folder's layout, which is what draws the modal, so it wraps
 * only the section's empty page: one drawing the modal as its fallback put
 * a second modal, and a second backdrop, over the first while the page
 * resolved (measured in a production build, KAN-368). One in ../@modal
 * itself would wrap the slot on every page. The section boundaries here are
 * the whole loading state.
 */
export function allSections() {
  return {
    personal: (
      <Suspense fallback={<SectionSkeleton id="personal" title="Personal Details" photo />}>
        <PersonalSection />
      </Suspense>
    ),
    // Suspense for the notice's useSearchParams (./security/notice.tsx).
    security: (
      <Suspense>
        <SecuritySection />
      </Suspense>
    ),
    notifications: <NotificationsSection />,
    integrations: <IntegrationsSection />,
    preferences: (
      <Suspense
        fallback={<SectionSkeleton id="job-preferences" title="Job Preferences" fields={4} />}
      >
        <PreferencesSection />
      </Suspense>
    ),
  };
}

/**
 * A section while it reads: its card and heading as the section draws them,
 * then, for Personal Details, the photo's 72px circle beside its buttons,
 * and a field's label and 42px box for each field (`fields`), so the card
 * is about the height it will be. The modal shows one section at a time and
 * each scrolls alone, so nothing outside the card moves when it fills.
 */
export function SectionSkeleton({
  id,
  title,
  photo = false,
  fields = 3,
}: {
  id: string;
  title: string;
  photo?: boolean;
  fields?: number;
}) {
  return (
    <Card as="section" aria-labelledby={id} aria-busy="true" className="flex flex-col gap-4">
      <SectionHeading id={id}>{title}</SectionHeading>
      <div aria-hidden="true" className="flex flex-col gap-6">
        {photo && (
          <div className="flex items-center gap-4">
            <Skeleton className="size-18 shrink-0 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-[18px] w-24" />
              <Skeleton className="rounded-control h-[42px] w-full" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
