import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { BuildingIcon } from "../../icons";
import { ArrowLeftIcon, PencilIcon } from "@/components/icons";
import { getJobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CompanyTile } from "@/components/ui/company-tile";
import { getCompanyJob } from "@/lib/job-queries";
import { Points, Section } from "@/components/ui/section";

import { STATUS_TONE } from "../data";
import { ApplicantOverviewPanel } from "./applicant-overview";

export async function generateMetadata({
  params,
}: PageProps<"/company/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  return { title: posting ? posting.title : "Job Posting" };
}

/**
 * /company/jobs/[jobId] — the per-role screen the index page's docblock
 * promised. Read-only management view for now: the posting's own facts,
 * plus how far along it is with applicants.
 *
 * The status badge leads the actions, as it leads the jobs list and the
 * editor, so a Closed posting never reads as live. Edit opens the composer at
 * /edit, and is absent once a posting is Closed: there is nothing left to
 * change. Fixture ids 404 there until this page reads real jobs.
 */
export default async function CompanyJobDetailPage({ params }: PageProps<"/company/jobs/[jobId]">) {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  if (!posting) {
    // This view still reads fixtures. A real job has nothing to show here
    // yet, so it opens in the editor instead of a 404.
    const { job, error } = await getCompanyJob(jobId);
    // An outage or an expired session isn't a missing job; let the error
    // boundary say so rather than showing a 404 for a job that exists.
    if (error) throw new Error(error);
    if (job) redirect(`/company/jobs/${job.id}/edit`);
    notFound();
  }

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <ButtonLink href="/company/jobs" variant="secondary" size="sm" className="mb-3">
        <ArrowLeftIcon className="size-3.5" />
        Back to Jobs
      </ButtonLink>

      <JobDetailHeader
        posting={posting}
        tile={<CompanyTile Icon={BuildingIcon} size="sm" tone="outline" />}
        actions={
          <>
            <Badge variant="status" tone={STATUS_TONE[posting.status]}>
              {posting.status}
            </Badge>
            {posting.status !== "Closed" && (
              <ButtonLink
                href={`/company/jobs/${posting.id}/edit`}
                variant="outline"
                className="ml-auto @xl:ml-0"
              >
                <PencilIcon className="size-3.5" />
                Edit
              </ButtonLink>
            )}
          </>
        }
        rail={<ApplicantOverviewPanel posting={posting} />}
      />

      <Section title="About the Role">
        <p className="text-body text-ink-muted mt-3 max-w-[68ch]">{posting.about}</p>
      </Section>

      <Section title="What You'll Do">
        <Points items={posting.responsibilities} marker />
      </Section>

      <Section title="Qualifications">
        <Points items={posting.qualifications} marker />
      </Section>
    </div>
  );
}
