import { Flag, Share2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArrowLeftIcon, BookmarkIcon } from "@/components/icons";
import { getJobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Points, Section } from "@/components/ui/section";

import { MatchRail } from "../match-rail";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  return { title: posting ? posting.title : "Job" };
}

/**
 * /jobs/[jobId] — the expanded view of one recommendation, reached by
 * clicking its title on the /jobs feed. Read-only: nothing here writes yet,
 * same as the rest of the seeker screens.
 */
export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const posting = getJobPosting(jobId);

  if (!posting) notFound();

  return (
    /* White, like the company side's job detail page, rather than the grey
     * --color-app the rest of the seeker shell grounds on. The company shell
     * gets this by retargeting --background on its whole SidebarProvider,
     * which also has to reach shadcn components grounding against it
     * elsewhere in that shell; this route has none of those, so painting
     * bg-panel directly on the one page that should read differently is the
     * smaller change. flex-1 is what carries the white down to the bottom of
     * the viewport rather than stopping where the content does. */
    <div className="bg-panel flex flex-1 flex-col">
      <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
        <ButtonLink href="/jobs" variant="secondary" size="sm" className="mb-3">
          <ArrowLeftIcon className="size-3.5" />
          Back to Jobs
        </ButtonLink>

        <JobDetailHeader
          posting={posting}
          tileIcon={posting.Icon}
          tileTone={posting.tone}
          companyHref="/companies"
          actions={
            <>
              <IconButton label={`Save ${posting.title}`} className="size-8 shrink-0">
                <BookmarkIcon className="size-4" />
              </IconButton>
              <IconButton label={`Report ${posting.title}`} className="size-8 shrink-0">
                <Flag className="size-4" />
              </IconButton>
              <IconButton label={`Share ${posting.title}`} className="size-8 shrink-0">
                <Share2 className="size-4" />
              </IconButton>
              <Button size="lg" className="shrink-0">
                Apply Now
              </Button>
            </>
          }
          rail={
            <MatchRail
              score={posting.match ?? 0}
              highlights={posting.highlights ?? []}
              standalone
            />
          }
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
      </main>
    </div>
  );
}
