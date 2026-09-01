import type { Metadata } from "next";

import { Placeholder } from "../placeholder";

export const metadata: Metadata = {
  title: "Candidates",
  description: "Everyone who has applied, across every role.",
};

/**
 * /company/candidates — people, cut across postings.
 *
 * The applicants for one role live under that role, at
 * /company/jobs/[jobId]/applicants. This screen is the other axis: someone who
 * applied to three postings is one person here and three applicants there.
 * Both views are wanted, which is why this is a sibling of /company/jobs and
 * not a tab inside it.
 */
export default function CompanyCandidatesPage() {
  return (
    <Placeholder
      title="Candidates"
      description="Everyone who has applied to you, across every posting."
    >
      A searchable list of applicants with the roles each one applied to and the stage they are in,
      filterable by role, stage and skill.
    </Placeholder>
  );
}
