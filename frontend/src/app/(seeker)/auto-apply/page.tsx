import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";

import { PencilIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { claudeConnectorLink } from "@/lib/claude-connector";
import { cn } from "@/lib/cn";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../gutter";
import { RememberFeed } from "../jobs/[jobId]/page-actions";
import { activityOf } from "./activity-list";
import { getApplications, getRunApplications } from "./applications";
import { getWrittenQuestions } from "./answers/questions";
import { AutoApplyPanel } from "./auto-apply-panel";
import type { SavedJob } from "./add-jobs-dialog";
import { UpNext } from "./up-next";
import { WriteWithClaude } from "./write-with-claude";

export const metadata: Metadata = {
  title: "Auto Apply",
  description: "Apply to the jobs that match you, with your resume filled in for you.",
};

/**
 * /auto-apply — where the seeker sets up applying in bulk (KAN-223). The
 * pipeline it grows into is `auto-apply/architecture.md` at the repo root:
 * match, pick the resume, fill the form with the extension, record.
 *
 * JOBS FIRST (KAN-359). The heading block, with Manage Resumes and Start
 * Auto Apply at its top right (./auto-apply-panel.tsx), then:
 *
 *   Up Next    the queue in the order the extension takes it, each job
 *              with the resume it will go out with, which a click on it
 *              changes, and Add Jobs to queue saved ones (./up-next.tsx).
 *              Needs-you jobs stay in it, since they wait on the seeker.
 *
 * HISTORY IS ARCHIVED FOR NOW (KAN-359), its code kept: an applied job is
 * on the Applications Tracker already, so the table only repeated it, and
 * a skipped one needs nothing. A needs-you job does need the seeker and the
 * Tracker doesn't list it, so it moved to Up Next rather than going. To
 * bring History back, render <LiveActivity items={history} /> (where
 * `history` is the items that are neither queued nor needs you) in a
 * section after Up Next; ./live-activity.tsx and the table's "history"
 * variant (./activity-list.tsx) are as they were.
 *
 * WRITTEN QUESTIONS WAITING (KAN-385). While any open application has a
 * written question with no answer, a card over Up Next says how many and
 * links to Written Answers (./answers/page.tsx), where a student without
 * Claude writes or pastes them. A student with Claude can leave them to it;
 * the card says so, and its Write with Claude (./write-with-claude.tsx)
 * opens a Claude chat with the trigger in its box. A failed read hides the
 * card: Up Next says the API is down.
 *
 * It opened with a Resume List of every resume until KAN-359; the page is
 * about which jobs go out, so jobs lead it.
 *
 * WHICH RESUME A QUEUED JOB GETS: the student's pick for it (Up Next's
 * picker, kept as the sent resume the application names, `sent_resume`),
 * else the run's own rule, `pick_resume` (architecture.md, 11.3): the built
 * resume tailored to that job posting, else the default resume (built or
 * uploaded), else none (`ruleFor`). The rule is worked out here from the
 * two resume lists, for display only; the run decides when it fills the
 * form. Keep the two in step if the rule changes.
 *
 * Everything is read here, on the server, and passed through the client
 * panel; a batch or a queueing refreshes the route to redraw it. A failed
 * read says so, never a fixture (backend/CLAUDE.md). A <div>, since
 * SidebarInset is already the <main>.
 */
export default async function AutoApplyPage() {
  const [run, saved, built, uploaded, written] = await Promise.all([
    getRunApplications(),
    getApplications(["saved"] as const, { scored: true }),
    listBuiltResumes(),
    listResumes(),
    getWrittenQuestions(),
  ]);
  const toWrite = (written.data ?? []).reduce((n, posting) => n + posting.questions.length, 0);

  const builtList = built.data ?? [];
  const uploadedList = (uploaded.resumes ?? []).filter((resume) => resume.storage_path);
  const defaultBuilt = builtList.find((resume) => resume.is_default);
  const defaultUpload = uploadedList.find((resume) => resume.is_default);
  /** The rule's pick, as a name and the picker's key. */
  const ruleFor = (jobId: string) => {
    const tailored = builtList.find((resume) => resume.job_posting_id === jobId);
    if (tailored) return { name: tailored.name, key: `built:${tailored.id}` };
    if (defaultBuilt) return { name: defaultBuilt.name, key: `built:${defaultBuilt.id}` };
    if (defaultUpload) {
      return { name: defaultUpload.original_filename, key: `uploaded:${defaultUpload.id}` };
    }
    return { name: null, key: null };
  };

  // Queue order, oldest first: the API answers newest first, but the job the
  // extension opens next belongs at the top and a newly queued one joins at
  // the bottom.
  const items = run.applications
    ? [...run.applications].reverse().map((application) => {
        const sent = application.sent_resume;
        const resume = sent
          ? {
              name: sent.name,
              key: sent.built_resume_id
                ? `built:${sent.built_resume_id}`
                : sent.uploaded_resume_id
                  ? `uploaded:${sent.uploaded_resume_id}`
                  : null,
            }
          : ruleFor(application.job.id);
        return { ...activityOf(application), resume: resume.name, resumeKey: resume.key };
      })
    : [];
  // Up Next: queued jobs and needs-you ones, which wait on the seeker too.
  const queue = items.filter((item) => item.status === "queued" || item.status === "failed");

  const savedJobs: SavedJob[] = (saved.applications ?? []).map(({ job, match }) => ({
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
        claudeLink={claudeConnectorLink()}
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
            {toWrite > 0 && (
              <Card className="mt-6 flex flex-col gap-3 @2xl/main:flex-row @2xl/main:items-center @2xl/main:justify-between">
                <div className="min-w-0">
                  <h2 className="text-subtitle text-ink">
                    {toWrite} Written {toWrite === 1 ? "Question" : "Questions"} Waiting
                  </h2>
                  <p className="text-body text-ink-meta mt-0.5">
                    Your Claude writes them once you add WorkIt to it. Or write them yourself, or
                    paste answers from any AI.
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 @md/main:flex-row @md/main:items-start">
                  <WriteWithClaude />
                  <ButtonLink href="/auto-apply/answers" variant="secondary" size="sm">
                    <PencilIcon className="size-4" />
                    Write Answers
                  </ButtonLink>
                </div>
              </Card>
            )}
            <UpNext items={queue} saved={savedJobs} />
          </>
        )}
      </AutoApplyPanel>
    </div>
  );
}
