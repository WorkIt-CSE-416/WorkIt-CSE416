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
 *
 * ?q= is where the company bar's search lands. It is read here, the way
 * /search reads its own, and handed to the table as its starting name filter,
 * so the first render is already filtered. The key is the query because the
 * table reads its starting state once: a second search from the bar re-renders
 * this same page, and without a new key the table would keep the old filter.
 */
export default async function CompanyApplicantsPage({
  searchParams,
}: PageProps<"/company/applicants">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <header className="mb-5">
        <h1 className="text-heading text-ink">Applicants</h1>
        <p className="text-body text-ink-meta mt-1">
          Everyone who has applied to you, across every posting.
        </p>
      </header>

      <ApplicantsTable key={query} query={query} />
    </div>
  );
}
