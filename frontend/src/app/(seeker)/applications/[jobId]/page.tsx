import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyLogo } from "@/components/company-logo";
import type { JobPosting } from "@/components/job-detail/data";
import { JobDetailHeader } from "@/components/job-detail/job-detail-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getApplicantSession } from "@/lib/session";

import { hasApplied } from "../../applied";
import type { Application as Stored } from "../../auto-apply/applications";
import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { INBOX_LIVE } from "../../inbox/live";
import { JobActionBar } from "../../jobs/[jobId]/action-bar";
import {
  JOB_PAGE_WIDTH,
  JobViewActions,
  JobViewBody,
  JobViewHeader,
  loadJobView,
  type KnownApplication,
} from "../../jobs/[jobId]/job-view";
import { getJobListing } from "../../jobs/listings";
import type { Application } from "../../tracker";
import { getEmailsOnce, getNow, getTracker } from "../data";
import { EmailsTab } from "./emails-tab";
import { ApplicationTabs, TabPanes } from "./tab-panes";
import { YourApplication } from "./your-application";

/**
 * The tab's title, "<role> at <company>", from the job posting's own read,
 * which the page makes too (fetch memoization keeps the two one request).
 * It came from the scored tracker read, and once the route has a
 * loading.tsx every visible link to it prefetches its head: each tracker
 * row in view would have run a scoring pass. A closed posting has no job
 * page (`GET /jobs/{id}` is a 404), so its title comes from the seeker's one
 * application instead, read unscored, and only one the tracker lists (saved,
 * applied or after): a queued one keeps the page's own name.
 */
export async function generateMetadata({
  params,
}: PageProps<"/applications/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const { job, error } = await getJobListing(jobId);
  if (job) return { title: `${job.title} at ${job.company}` };
  const closed = error == null ? await getClosedApplication(jobId) : null;
  return { title: closed ? `${closed.job.title} at ${closed.job.company}` : "Application" };
}

/** The seeker's saved or applied application for a job posting that has
 *  closed, for its title (GET .../applications/{job_id}, unscored); null
 *  when there is none or it can't be read. */
async function getClosedApplication(jobId: string): Promise<Stored | null> {
  try {
    const { id, token } = await getApplicantSession();
    const res = await apiGet(`/applicants/${id}/applications/${encodeURIComponent(jobId)}`, token);
    if (!res.ok) return null;
    const app = (await res.json()) as Stored;
    return app.stage === "saved" || hasApplied(app.stage) ? app : null;
  } catch {
    return null;
  }
}

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
 * reload. Both panes are drawn here once and the tab moves in place
 * (./tab-panes.tsx), with no trip to the server:
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
 * exactly. The job's buttons take their stage and applied date from that row
 * too, not from the job page's own two reads for them. An id the seeker has
 * no saved or applied job for is not found.
 *
 * A CLOSED POSTING HAS NO JOB PAGE: `GET /jobs/{id}` answers 404 once it
 * closes. The header then says what the tracker knows (role, company, logo)
 * marked Closed, the description tab says it is gone, and Your Application
 * still works.
 */
export default async function ApplicationPage({ params }: PageProps<"/applications/[jobId]">) {
  const { jobId } = await params;
  // The tracker's row says the stage and when it was applied, so the job's
  // loader takes them from it rather than asking the API twice more. Handed
  // over as a promise, so the tracker and the job's reads run together.
  const tracker = getTracker();
  const known: Promise<KnownApplication> = tracker.then(({ applications }) => {
    const row = applications?.find((a) => a.id === jobId);
    if (!row) return null;
    return {
      // The job page's buttons know saved and applied only: a stage after
      // applied (KAN-413) is applied to them.
      stage: row.stage === "saved" ? "saved" : "applied",
      appliedAt: row.appliedOn,
    };
  });
  const [{ applications, error }, view, { emails }] = await Promise.all([
    tracker,
    // About the Role alone on its tab, so no Key Requirements read.
    loadJobView(jobId, { descriptionOnly: true, application: known }),
    // No emails are read while the Inbox is archived (KAN-428).
    INBOX_LIVE ? getEmailsOnce() : { emails: null },
  ]);
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

  return (
    <div className={cn(JOB_PAGE_WIDTH, SEEKER_GUTTER)}>
      <JobActionBar back={<BackToApplications className="group/back" />}>
        {actionable ? <JobViewActions view={view} job={job} /> : <ApplicationTabs base={base} />}
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

      {actionable && <ApplicationTabs base={base} className="mt-6" />}

      {/* Both panes, drawn once; the tab shows one (./tab-panes.tsx). */}
      <TabPanes
        application={<YourApplication app={app} job={job} sent={view.sent} now={getNow()} />}
        emails={
          INBOX_LIVE && (
            <EmailsTab
              emails={emails?.filter((email) => email.jobId === app.id) ?? null}
              job={{
                id: app.id,
                role: app.role,
                company: app.company,
                logoUrl: app.logoUrl,
                stage: app.stage,
                appliedOn: app.appliedOn,
              }}
            />
          )
        }
        job={
          job ? (
            <JobViewBody view={view} job={job} descriptionOnly />
          ) : (
            <Section title="About the Role">
              <p className="text-body text-ink-meta mt-3">
                This posting has closed, so its description is no longer on WorkIt.
              </p>
            </Section>
          )
        }
      />
    </div>
  );
}

/** Back to the page that opened this one, the Calendar or the tracker's
 *  list or board, else the tracker (../../back-link.tsx, KAN-363). It went
 *  to the tracker from everywhere. */
function BackToApplications({ className }: { className?: string }) {
  return (
    <BackLink
      parent={{ href: "/applications", name: "Applications Tracker" }}
      named
      className={className}
    />
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
