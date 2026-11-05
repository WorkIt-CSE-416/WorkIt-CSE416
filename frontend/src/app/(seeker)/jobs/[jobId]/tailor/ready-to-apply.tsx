"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckIcon, ExternalLinkIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, buttonClasses } from "@/components/ui/button";

import { useBack } from "../../../back-link";
import { useResumeDownload } from "../../../resumes/download-menu";
import { restoreScrollOn } from "../../../scroll-memory";
import type { ApplicationStage } from "../../../auto-apply/actions";
import { AutoApplyButton } from "../../../auto-apply/auto-apply-button";
import { DidYouApply } from "../../apply-button";
import type { JobListing } from "../../listings";

/** What the review knows about applying to its job, read with the page. */
export type ApplyState = {
  /** The job's application: saved once Tailor ran, unless it was further on. */
  stage: ApplicationStage | null;
  /** A signed-in applicant, whom "Did You Apply?" may ask. */
  canMarkApplied: boolean;
  /** Marked applied already: nothing asks again. */
  applied: boolean;
};

/**
 * Finish, the review's way on (KAN-217), and the Ready to Apply dialog it
 * opens: the tailored resume is saved and its job is on the Applications
 * Tracker, so the dialog takes the student to applying. Download PDF is the
 * primary action (the editor's PDF, kept nowhere, with its missing-character
 * warning, `useResumeDownload`); Open the Application opens the employer's
 * form in a new tab and turns the dialog into "Did You Apply?"
 * (`DidYouApply`), which starts on this tailored resume, as Apply Now's does;
 * Auto Apply queues the job where auto apply can fill its form, and attaches
 * the tailored resume (`pick_resume`, auto-apply/architecture.md).
 *
 * CLOSING IT RETURNS TO WHERE TAILOR STARTED: the page that opened Tailor's
 * route (`useBack`, ../../../back-link.tsx; the pick and the review share
 * the route, so its opener is the page before them), else the job posting.
 * Not Yet and Yes, I Applied leave the same way. Finish went straight to the
 * job posting's page until then, which showed nothing new: the student had
 * no file in hand, and Apply Now opened the form with no resume step.
 *
 * Drawn twice, in the step's row and in the phone editor's header, which
 * covers the row (`TailorReview`'s `phoneBar`); each has its own dialog.
 */
export function TailorFinish({
  job,
  resumeId,
  apply,
}: {
  job: JobListing;
  resumeId: string;
  apply: ApplyState;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const download = useResumeDownload(resumeId);
  const back = useBack({ href: `/jobs/${encodeURIComponent(job.id)}`, name: "Job Posting" });

  function leave() {
    setOpen(false);
    restoreScrollOn(back.href);
    router.push(back.href);
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setAsking(false);
          setOpen(true);
        }}
      >
        <CheckIcon aria-hidden className="size-4" /> Finish
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : leave())}>
        <DialogContent
          className={asking ? "max-h-[90vh] overflow-y-auto sm:max-w-3xl" : "sm:max-w-lg"}
        >
          {asking ? (
            <DidYouApply jobId={job.id} title={job.title} onClose={leave} onApplied={leave} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-subtitle font-semibold">Ready to Apply</DialogTitle>
                <DialogDescription>
                  Your tailored resume is saved, and {job.title} is on your Applications Tracker.
                  Download the PDF, then attach it on {job.company}&apos;s application.
                  {job.auto_apply && " Or let Auto Apply fill the form with it."}
                </DialogDescription>
              </DialogHeader>
              {download.held && (
                <p className="text-note text-warning">
                  The PDF&apos;s font cannot show {download.held.missing_characters.join(" ")}.
                  Check the file before you send it.
                </p>
              )}
              {download.error && <p className="text-note text-danger">{download.error}</p>}
              <DialogFooter className="flex-wrap">
                {job.auto_apply && (
                  <AutoApplyButton
                    jobId={job.id}
                    title={job.title}
                    company={job.company}
                    stage={apply.stage}
                  />
                )}
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  onClick={() => {
                    // The form opens in the new tab; this one asks whether
                    // they applied, as Apply Now's dialog does.
                    if (apply.canMarkApplied && !apply.applied) setAsking(true);
                  }}
                >
                  Open the Application
                  <ExternalLinkIcon className="size-4" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {download.held ? (
                  <Button size="sm" onClick={download.keep}>
                    <FileArrowDownIcon aria-hidden /> Download Anyway
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={download.busy !== null}
                    onClick={() => void download.pick("pdf")}
                  >
                    <FileArrowDownIcon aria-hidden />
                    {download.busy ? "Making PDF…" : "Download PDF"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
