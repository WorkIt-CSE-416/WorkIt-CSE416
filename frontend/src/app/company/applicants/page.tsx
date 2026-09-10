import type { Metadata } from "next";

import { ApplicantsTable } from "./applicants-table";

export const metadata: Metadata = {
  title: "Applicants",
  description: "Everyone who has applied, across every role.",
};

/**
 * /company/applicants — people, cut across postings.
 *
 * The two axes are both wanted, which is why this is a sibling of /company/jobs
 * and not a tab inside it: the applicants for one role live under that role, at
 * /company/jobs/[jobId]/applicants, and this screen is the other cut — someone
 * who applied to three postings is one row here and three rows there.
 *
 * That distinction used to be carried by the words: this screen was Candidates
 * and the per-role list was Applicants. It is carried by the axis now, since
 * both are applicants and only one of them is a list of applications. If the
 * two ever need telling apart in a sentence, name the axis rather than
 * reintroducing a second noun for the same person.
 */
export default function CompanyApplicantsPage() {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <header className="mb-5">
        <h1 className="text-heading text-ink">Applicants</h1>
        <p className="text-body text-ink-meta mt-1">
          Everyone who has applied to you, across every posting.
        </p>
      </header>

      <ApplicantsTable />
    </div>
  );
}
