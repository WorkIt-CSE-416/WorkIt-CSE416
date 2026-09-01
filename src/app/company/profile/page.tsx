import type { Metadata } from "next";

import { Placeholder } from "../placeholder";

export const metadata: Metadata = {
  title: "Company Profile",
  description: "The page applicants see when they open a posting.",
};

/**
 * /company/profile — the company's public page, edited from the inside.
 *
 * This is the route that made the /company prefix necessary: the seeker shell
 * already owns /profile, and two route groups cannot both define the same
 * path. It is also the reason the account menu says "Company Profile" — the
 * page is about the company, not about the recruiter signed in to edit it.
 */
export default function CompanyProfilePage() {
  return (
    <Placeholder
      title="Company Profile"
      description="What applicants see when they open one of your postings."
    >
      Logo, name, industry and size, the description and links, and the office locations a posting
      can be attached to.
    </Placeholder>
  );
}
