import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { getAvatar } from "@/lib/avatar-actions";
import { getProfile } from "@/lib/profile-actions";

import { PersonalDetails } from "./personal-details";

/**
 * The photo, name and headline (./personal-details). Delete Account moved
 * to Sign-In & Security's foot (KAN-364). A failed profile read shows one
 * notice, never an empty form whose Save would look like it clears the
 * name.
 */
export async function PersonalSection() {
  const [{ profile }, avatar] = await Promise.all([getProfile(), getAvatar()]);

  return (
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
  );
}
