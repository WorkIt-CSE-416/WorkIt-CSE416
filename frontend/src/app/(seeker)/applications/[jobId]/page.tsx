import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArrowLeftIcon } from "@/components/icons";
import { CompanyLogo } from "@/components/company-logo";
import type { JobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { SegmentedLinks } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { JobActionBar } from "../../jobs/[jobId]/action-bar";
import {
  JOB_PAGE_WIDTH,
  JobViewActions,
  JobViewBody,
  JobViewHeader,
  loadJobView,
} from "../../jobs/[jobId]/job-view";
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
 * THE JOB'S OWN PAGE, WITH TWO TABS. The action bar, the header and the Job
 * Description tab are the job page's own parts (../../jobs/[jobId]/job-view),
 * so the role looks exactly as it does on /jobs/[jobId]; only Back goes to
 * Applications. No match rail, as on the job page. Two tabs, a URL each
 * (`?tab=job` for the second), so a tab can be linked to and survives a
 * reload:
 *
 *   Your Application  the default: the analytics, what was sent, the timing
 *                     and the timeline (./your-application.tsx)
 *   Job Description   About the Role alone (`descriptionOnly`): the job
 *                     page's sent and applied notes and its Key
 *                     Requirements card stay off, so the description reads as the
 *                     posting, not as the seeker's record
 *
 * THE BAR HOLDS THE TABS ONCE THERE IS NOTHING TO DO. An applied job, or a
 * closed posting, has no use for Apply, Tailor, Save or Ask Scout, so the
 * bar shows the tabs beside Back instead. A saved job with an open posting
 * keeps the job page's actions, and its tabs sit under the header.
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
  // Your Application leads: it is what this page adds to the job's own.
  const tab: Tab = (await searchParams).tab === "job" ? "job" : "application";
  const [{ applications, error }, view] = await Promise.all([getTracker(), loadJobView(jobId)]);
  const { job } = view;

  if (applications == null) {
    return (
      <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
        <BackToApplications />
        <EmptyState
          Icon={CloudSlashIcon}
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
  const base = `/applications/${encodeURIComponent(jobId)}`;
  // Only a saved job with an open posting still has something to do: Apply,
  // Tailor, Save. An applied job, or a closed posting, gets the tabs in the
  // bar in their place.
  const actionable = job != null && app.stage === "saved";
  const tabs = (className?: string) => (
    <SegmentedLinks
      label="Application Tabs"
      value={tab}
      className={className}
      options={[
        { value: "application", label: "Your Application", href: base },
        { value: "job", label: "Job Description", href: `${base}?tab=job` },
      ]}
    />
  );

  return (
    <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
      <JobActionBar back={<BackToApplications className="group/back" />}>
        {actionable ? <JobViewActions view={view} job={job} /> : tabs()}
      </JobActionBar>

      {job ? (
        <JobViewHeader job={job} />
      ) : (
        <JobDetailHeader
          posting={closedPosting(app)}
          tile={
            <CompanyLogo
              name={app.company}
              src={app.logoUrl}
              className="text-label rounded-control size-10"
            />
          }
        />
      )}

      {actionable && tabs("mt-6")}

      {tab === "application" ? (
        <YourApplication app={app} job={job} sent={view.sent} now={getNow()} />
      ) : job ? (
        <JobViewBody view={view} job={job} descriptionOnly />
      ) : (
        <Section title="About the Role">
          <p className="text-body text-ink-meta mt-3">
            This posting has closed, so its description is no longer on WorkIt.
          </p>
        </Section>
      )}
    </div>
  );
}

function BackToApplications({ className = "group/back mb-3" }: { className?: string }) {
  return (
    <ButtonLink href="/applications" variant="secondary" size="sm" className={className}>
      <ArrowLeftIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
      Back to Tracker
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
