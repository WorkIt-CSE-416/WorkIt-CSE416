import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BuildingIcon } from "../../icons";
import { ArrowLeftIcon, PencilIcon } from "@/components/icons";
import { getJobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { ButtonLink, Button } from "@/components/ui/button";
import { CompanyTile } from "@/components/ui/company-tile";
import { Points, Section } from "@/components/ui/section";

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
 */
export default async function CompanyJobDetailPage({ params }: PageProps<"/company/jobs/[jobId]">) {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  if (!posting) notFound();

  return (
    <div className="max-w-app mx-auto w-full flex-1 px-6 py-6 sm:px-12">
      <ButtonLink href="/company/jobs" variant="secondary" size="sm" className="mb-3">
        <ArrowLeftIcon className="size-3.5" />
        Back to Jobs
      </ButtonLink>

      <JobDetailHeader
        posting={posting}
        tile={<CompanyTile Icon={BuildingIcon} size="sm" tone="outline" />}
        actions={
          <Button variant="outline">
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
        }
        rail={<ApplicantOverviewPanel posting={posting} />}
      />

      <Section title="About the Role">
        <p className="text-label text-ink-muted mt-3 leading-5 font-normal">{posting.about}</p>
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
