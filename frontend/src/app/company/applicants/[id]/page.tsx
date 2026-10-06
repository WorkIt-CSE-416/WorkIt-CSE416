import type { Metadata } from "next";

import { Placeholder } from "../../placeholder";

export const metadata: Metadata = {
  title: "Applicant",
  description: "One applicant's application, resume and stage history.",
};

/** /company/applicants/[id], where every row of the Applicants table links.
 *  Scaffolded so opening an applicant lands inside the shell rather than on
 *  Next's stock 404. It reads no id yet: there is nothing to look one up in. */
export default function CompanyApplicantPage() {
  return (
    <Placeholder
      title="Applicant"
      description="One applicant's application, resume and stage history."
    />
  );
}
