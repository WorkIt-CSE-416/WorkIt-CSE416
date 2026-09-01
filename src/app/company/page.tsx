import type { Metadata } from "next";

import { Placeholder } from "./placeholder";

export const metadata: Metadata = {
  title: "Company Home",
  description: "Hiring activity across every open role.",
};

/**
 * The landing screen for a signed-in company, at /company.
 *
 * It exists as its own page rather than redirecting to /company/jobs because
 * the bar's logo has to point somewhere, and a redirect would make the two
 * shells behave differently for the same click. What goes here is the summary
 * a recruiter wants before choosing a role to work on.
 */
export default function CompanyHomePage() {
  return (
    <Placeholder
      title="Hiring Overview"
      description="What moved across your open roles since you were last here."
    >
      Counts per stage across all postings, the applications that arrived today, and anything
      waiting on the company rather than on the applicant.
    </Placeholder>
  );
}
