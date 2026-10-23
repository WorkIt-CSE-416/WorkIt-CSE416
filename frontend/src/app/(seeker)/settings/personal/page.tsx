import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { getAvatar } from "@/lib/avatar-actions";
import { getProfile } from "@/lib/profile-actions";
import { getSessionUser } from "@/lib/session";

import { DeleteAccount } from "./delete-account";
import { PersonalDetails } from "./personal-details";

export const metadata: Metadata = { title: "Personal Details" };

/**
 * The photo, name and headline (./personal-details), then Delete Account at
 * the foot, in a red-edged card of its own so it never reads as part of the
 * form above it. A failed profile read shows one notice, never an empty
 * form whose Save would look like it clears the name.
 */
export default async function PersonalPage() {
  const [user, { profile }, avatar] = await Promise.all([
    getSessionUser(),
    getProfile(),
    getAvatar(),
  ]);

  return (
    <>
      <Card as="section" aria-labelledby="personal" className="flex flex-col gap-4">
        <SectionHeading id="personal">Personal Details</SectionHeading>
        {profile ? (
          <PersonalDetails profile={profile} avatarUrl={avatar.url} />
        ) : (
          <p role="status" className="text-body text-ink-meta">
            Your details didn&apos;t load. Refresh the page to try again.
          </p>
        )}
      </Card>

      <Card
        as="section"
        aria-labelledby="delete-account"
        className="border-danger/40 flex flex-col gap-4"
      >
        <SectionHeading id="delete-account">Delete Account</SectionHeading>
        <p className="text-body text-ink-meta">
          This deletes your profile, resumes, experiences, applications and files for good. You
          can&apos;t undo it.
        </p>
        <DeleteAccount email={user?.email ?? ""} />
      </Card>
    </>
  );
}
