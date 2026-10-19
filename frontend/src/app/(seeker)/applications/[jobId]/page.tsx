import { CloudOff } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArrowLeftIcon, SparkleIcon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import type { JobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { AskScoutButton } from "@/components/scout/scout-buttons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";
import { listSentResumes } from "@/lib/sent-resume-actions";

import { SEEKER_GUTTER } from "../../gutter";
import { JobActionBar } from "../../jobs/[jobId]/action-bar";
import { ApplyButton } from "../../jobs/[jobId]/apply-button";
import { JobDescription } from "../../jobs/[jobId]/description";
import { EligibilityCard } from "../../jobs/[jobId]/eligibility";
import { MoreActions } from "../../jobs/[jobId]/page-actions";
import { placesOf } from "../../jobs/format";
import { getJobListing } from "../../jobs/listings";
import { MatchRail } from "../../jobs/match-rail";
import { listingFacts } from "../../jobs/listing-card";
import { factText, toPosting } from "../../jobs/to-posting";
import type { Application } from "../../tracker";
import { getNow, getTracker } from "../data";
import { YourApplication } from "./your-application";

export async function generateMetadata({
  params,
}: PageProps<"/applications/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const app = (await getTracker()).applications?.find((a) => a.id === jobId);
  return { title: app ? `${app.role} at ${app.company}` : "Application" };
}

type Tab = "job" | "application";

/**
 * /applications/[jobId] — one application in full (KAN-256), opened from its
 * row or card on /applications. It replaced the side panel there: the panel
 * had room for a timeline but not for the job itself.
 *
 * THE JOB'S OWN PAGE, EXPANDED, WITH TWO TABS. The top is the job page's:
 * its pinned action bar (`JobActionBar`, with Back to Applications) and its
 * header (`JobDetailHeader`, the same facts through `toPosting`) with the
 * Jobs page card's match rail, so the role reads as it did when the seeker
 * found it. Under it, two tabs, a URL each (`?tab=application`), so a tab can
 * be linked to and survives a reload:
 *
 *   Job Description   the posting's text, as on its job page
 *   Your Application  what was sent, the timeline and how long each step
 *                     took (./your-application.tsx)
 *
 * The application comes from the tracker's own read (`getTracker`, cached per
 * request), so the score, the resume and the stage match the list's row
 * exactly. An id the seeker has no saved or applied job for is not found.
 *
 * A CLOSED POSTING HAS NO JOB PAGE: `GET /jobs/{id}` answers 404 once it
 * closes. The header then says what the tracker knows (role, company, logo)
 * marked Closed, the description tab says it is gone, and Your Application
 * still works.
 */
export default async function ApplicationPage({
  params,
  searchParams,
}: PageProps<"/applications/[jobId]">) {
  const { jobId } = await params;
  const tab: Tab = (await searchParams).tab === "application" ? "application" : "job";
  const [{ applications, error }, { job }, sent] = await Promise.all([
    getTracker(),
    getJobListing(jobId),
    listSentResumes(),
  ]);

  if (applications == null) {
    return (
      <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
        <BackToApplications />
        <EmptyState
          Icon={CloudOff}
          title="This Application Isn't Loading"
          detail={process.env.NODE_ENV === "development" ? error : undefined}
        >
          We couldn&apos;t reach your saved and applied jobs. Refresh the page in a few minutes.
        </EmptyState>
      </div>
    );
  }

  const app = applications.find((a) => a.id === jobId);
  if (!app) notFound();
  // Newest first, as the API lists them.
  const sentHere = (sent.data ?? []).filter((s) => s.job_posting_id === jobId);
  const base = `/applications/${encodeURIComponent(jobId)}`;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* The job page's own bar (KAN-246): Back and the job's actions, held
          at the top while the description scrolls under them. */}
      <JobActionBar back={<BackToApplications className="group/back" />}>
        <MoreActions title={app.role} />
        <AskScoutButton id={app.id} title={app.role} company={app.company} />
        {job && (
          <>
            <ButtonLink
              href={`/jobs/${encodeURIComponent(job.id)}/tailor`}
              variant="secondary"
              size="sm"
              className="shrink-0"
            >
              <SparkleIcon className="size-4" />
              Tailor My Resume
            </ButtonLink>
            <ApplyButton
              jobId={job.id}
              title={job.title}
              applyUrl={job.apply_url}
              canMarkApplied
              applied={app.appliedOn != null}
              className="shrink-0"
            />
          </>
        )}
      </JobActionBar>

      <JobDetailHeader
        posting={job ? toPosting(job) : closedPosting(app)}
        tile={
          <CompanyLogo name={app.company} src={app.logoUrl} className="text-meta size-8 rounded" />
        }
        // The Jobs page card's rail. The list's read carries the score but
        // not its highlights, so the rail draws the ring alone.
        rail={<MatchRail score={app.match} highlights={[]} standalone />}
      />

      <SegmentedLinks
        label="Application Tabs"
        value={tab}
        className="mt-6"
        options={[
          { value: "job", label: "Job Description", href: base },
          { value: "application", label: "Your Application", href: `${base}?tab=application` },
        ]}
      />

      {tab === "job" ? (
        <>
          {job && <EligibilityCard jobId={job.id} />}
          <Section title="About the Role">
            {job ? (
              <>
                {/* All of its places, as on its job page. */}
                {placesOf(job.location_label ?? job.location).length > 1 && (
                  <p className="text-body text-ink-muted mt-3">
                    Open in {placesOf(job.location_label ?? job.location).join(" · ")}.
                  </p>
                )}
                {job.description ? (
                  <JobDescription
                    text={job.description}
                    company={job.company}
                    applyUrl={job.apply_url}
                    pay={factText(listingFacts(job).salary) || null}
                  />
                ) : (
                  <p className="text-body text-ink-meta mt-3">
                    This posting has no description here. Apply Now opens it on {job.company}
                    &apos;s site.
                  </p>
                )}
              </>
            ) : (
              <p className="text-body text-ink-meta mt-3">
                This posting has closed, so its description is no longer on WorkIt.
              </p>
            )}
          </Section>
        </>
      ) : (
        <YourApplication app={app} job={job} sent={sentHere} now={getNow()} />
      )}
    </div>
  );
}

function BackToApplications({ className = "group/back mb-3" }: { className?: string }) {
  return (
    <ButtonLink href="/applications" variant="secondary" size="sm" className={className}>
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      Back to Applications
    </ButtonLink>
  );
}

/** What the header can say about a closed posting: the tracker's role,
 *  company and location, marked Closed. */
function closedPosting(app: Application): JobPosting {
  return {
    id: app.id,
    companyName: app.company,
    title: app.role,
    status: "Closed",
    jobType: "",
    workStyle: "",
    level: "",
    starts: "",
    locationCity: app.location ?? "",
    salary: app.pay ?? "",
    postedAt: "",
    updatedAt: "",
    companyAbout: "",
    about: "",
    responsibilities: [],
    qualifications: [],
  };
}
