import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";

import { LightningRoundedIcon } from "@/components/custom-icons";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { activityOf } from "./activity-list";
import { getApplications, getRunApplications } from "./applications";
import { AutoApplyPanel } from "./auto-apply-panel";
import { LiveActivity } from "./live-activity";
import { ReadyToQueue, type ReadyJob } from "./ready-to-queue";
import { UpNext } from "./up-next";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it grows into is `auto-apply/architecture.md` at the repo root:
 * match, pick the resume, fill the form with the extension, record.
 *
 * JOBS FIRST (KAN-359). The heading block, with Start Auto Apply at its top
 * right (./auto-apply-panel.tsx) and a note on which resume goes out, then:
 *
 *   Up Next          the queue in the order the extension takes it, each
 *                    job with the resume it will go out with (./up-next.tsx)
 *   Ready to Queue   the saved jobs, to pick several and queue them
 *                    (./ready-to-queue.tsx): the one place that does
 *   History          what happened: needs you, applied, skipped, filtered
 *                    by status and sorted from the URL (./live-activity.tsx)
 *
 * It opened with a Resume List of every resume until KAN-359; the page is
 * about which jobs go out, so jobs lead it.
 *
 * WHICH RESUME A QUEUED JOB GETS (`resumeFor`) is the run's own rule,
 * `pick_resume` (architecture.md, 11.3): the built resume tailored to that
 * job posting, else the default resume (built or uploaded), else none. It
 * is worked out here from the two resume lists, for display only; the run
 * picks again when it fills the form, so a change made since shows on the
 * next visit. Keep the two in step if the rule changes.
 *
 * Everything is read here, on the server, and passed through the client
 * panel; a batch or a queueing refreshes the route to redraw it. A failed
 * read says so, never a fixture (backend/CLAUDE.md). A <div>, since
 * SidebarInset is already the <main>.
 */
export default async function AutoApplyPage() {
  const [run, saved, built, uploaded] = await Promise.all([
    getRunApplications(),
    getApplications(["saved"] as const, { scored: true }),
    listBuiltResumes(),
    listResumes(),
  ]);

  const builtList = built.data ?? [];
  const uploadedList = (uploaded.resumes ?? []).filter((resume) => resume.storage_path);
  const defaultResume =
    builtList.find((resume) => resume.is_default)?.name ??
    uploadedList.find((resume) => resume.is_default)?.original_filename ??
    null;
  const resumeFor = (jobId: string) =>
    builtList.find((resume) => resume.job_posting_id === jobId)?.name ?? defaultResume;

  // Queue order, oldest first: the API answers newest first, but the job the
  // extension opens next belongs at the top and a newly queued one joins at
  // the bottom.
  const items = run.applications
    ? [...run.applications].reverse().map((application) => ({
        ...activityOf(application),
        resume: resumeFor(application.job.id),
      }))
    : [];
  const queue = items.filter((item) => item.status === "queued");
  const history = items.filter((item) => item.status !== "queued");

  const ready: ReadyJob[] = (saved.applications ?? []).map(({ job, match }) => ({
    id: job.id,
    role: job.title,
    company: job.company,
    logoUrl: job.logo_url,
    match: match ?? null,
    autoApply: job.auto_apply,
  }));

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* So a queued job's page goes back here, not to the feed. */}
      <RememberFeed />
      <AutoApplyPanel
        hasResume={builtList.length + uploadedList.length > 0}
        defaultResume={defaultResume}
      >
        {run.error != null ? (
          <EmptyState
            Icon={CloudSlashIcon}
            title="Your Applications Aren't Loading"
            className="mt-8"
            detail={process.env.NODE_ENV === "development" ? run.error : undefined}
          >
            We couldn&apos;t reach your applications. Refresh the page in a few minutes.
          </EmptyState>
        ) : (
          <>
            <section aria-labelledby="up-next" className="mt-8">
              <SectionHeading id="up-next">Up Next</SectionHeading>
              {queue.length > 0 ? (
                <UpNext items={queue} />
              ) : (
                <EmptyState Icon={LightningRoundedIcon} title="Nothing Queued Yet" className="mt-3">
                  Start Auto Apply to queue your best matches, pick saved jobs below, or click Auto
                  Apply on any job.
                </EmptyState>
              )}
            </section>

            <section aria-labelledby="ready-to-queue" className="mt-10">
              <SectionHeading id="ready-to-queue">Ready to Queue</SectionHeading>
              {saved.error != null ? (
                <p className="text-body text-ink-meta mt-3">
                  Your saved jobs aren&apos;t loading right now. Refresh the page in a few minutes.
                </p>
              ) : ready.length > 0 ? (
                <ReadyToQueue jobs={ready} />
              ) : (
                <p className="text-body text-ink-meta mt-3">
                  Jobs you save show up here, ready to queue.
                </p>
              )}
            </section>

            {history.length > 0 && (
              <section aria-labelledby="history" className="mt-10">
                <SectionHeading id="history">History</SectionHeading>
                <LiveActivity items={history} />
              </section>
            )}
          </>
        )}
      </AutoApplyPanel>
    </div>
  );
}
