import { Flag, Share2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { ArrowLeftIcon } from "@/components/icons";
import { getJobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { SaveButton } from "@/components/save-button";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Points, Section } from "@/components/ui/section";

import { MatchRail } from "../match-rail";
import { SEEKER_GUTTER } from "../../gutter";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  return { title: posting?.status === "Open" ? posting.title : "Job not found" };
}

/**
 * /jobs/[jobId] — the expanded view of one recommendation, reached by
 * clicking its title on the /jobs feed. Read-only: nothing here writes yet,
 * same as the rest of the seeker screens.
 *
 * Only an Open posting renders. `getJobPosting` also serves the company's own
 * fixtures, and a Draft or Closed one is not a job a seeker can apply to, so
 * it gets the same not-found.tsx as an id that does not exist.
 */
export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  if (!posting || posting.status !== "Open") notFound();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <ButtonLink href="/jobs" variant="secondary" size="sm" className="mb-3">
        <ArrowLeftIcon className="size-3.5" />
        Back to Jobs
      </ButtonLink>

      <JobDetailHeader
        posting={posting}
        // Initials, as on the feed card — `rounded` beats <Avatar>'s own
        // `rounded-full` the same way the card's `rounded-card` does.
        tile={<Avatar name={posting.companyName} className="text-meta size-8 rounded" />}
        showDeadline
        actions={
          <>
            {/* Outlined like the feed card's icon actions. On a narrow card
                these sit left and Apply Now right, on a row of their own. */}
            <SaveButton title={posting.title} saved={posting.saved} />
            <IconButton
              label={`Report ${posting.title}`}
              tooltip="Report"
              variant="outline"
              className="size-8 shrink-0"
            >
              <Flag className="size-4" />
            </IconButton>
            <IconButton
              label={`Share ${posting.title}`}
              tooltip="Share"
              variant="outline"
              className="size-8 shrink-0"
            >
              <Share2 className="size-4" />
            </IconButton>
            <Button size="lg" className="ml-auto shrink-0 @xl:ml-0">
              Apply Now
            </Button>
          </>
        }
        // No rail for a job nothing has scored: a 0% "Weak match" would read
        // as a verdict when there is no score at all.
        rail={
          posting.match != null ? (
            <MatchRail score={posting.match} highlights={posting.highlights ?? []} standalone />
          ) : undefined
        }
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
