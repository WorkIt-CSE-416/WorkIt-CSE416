import type { Metadata } from "next";
import { Suspense } from "react";

import { getBank } from "@/lib/bank-actions";

import { getSavedFilters } from "../jobs/listings";
import {
  ProfileExtras,
  ProfileExtrasSkeleton,
  SchoolLine,
  SchoolLineSkeleton,
} from "./profile-facts";
import { ProfileScreen } from "./profile-screen";

export const metadata: Metadata = {
  title: "Profile",
  description: "What employers see and what WorkIt fills in for you.",
};

/**
 * /profile, My Profile (./profile-screen.tsx has the screen and its rules).
 * A server page since KAN-550, so the parts read on the server (the school
 * line, Job Preferences and Top Skills, ./profile-facts.tsx) stream into the
 * client screen, each in its own <Suspense>, while the screen's own read
 * fills the identity card and Contact & Links. Both reads start here, before
 * anything waits, and the experience bank is read once for both parts that
 * use it. It was a client page with a layout.tsx only to carry the tab
 * title, which this page now exports itself.
 */
export default function ProfilePage() {
  const bank = getBank();
  const preferences = getSavedFilters();
  return (
    <ProfileScreen
      school={
        <Suspense fallback={<SchoolLineSkeleton />}>
          <SchoolLine bank={bank} />
        </Suspense>
      }
      extras={
        <Suspense fallback={<ProfileExtrasSkeleton />}>
          <ProfileExtras bank={bank} preferences={preferences} />
        </Suspense>
      }
    />
  );
}
