"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { CheckIcon, ExternalLinkIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
 * Finish, the review's way on (KAN-217), and the dialog it opens, "Your
 * Resume Is Ready": the tailored resume is saved and its job is on the
 * Tracker (a status line with View), then what to do next.
 *
 * APPLY YOURSELF IS TWO NUMBERED STEPS, AND THE PRIMARY BUTTON IS ALWAYS THE
 * NEXT ONE. Step 1, Download PDF (the editor's PDF, kept nowhere, with its
 * missing-character warning, `useResumeDownload`), starts primary and takes
 * focus; once the file is saved it turns secondary, step 2, Open <Company>'s
 * Application, turns primary and takes focus, which says the step moved on
 * to a screen reader too. Step 2 opens the employer's form in a new tab and
 * turns the dialog into "Did You Apply?" (`DidYouApply`), starting on this
 * tailored resume, as Apply Now's does. OR LET AUTO APPLY DO IT is a block of
 * its own, only where auto apply can fill the form (`job.auto_apply`): one
 * line and a secondary Auto Apply, which attaches this resume (`pick_resume`,
 * auto-apply/architecture.md). The first version, "Ready to Apply", put
 * Auto Apply, Open the Application and Download PDF in one row of equal
 * buttons under a paragraph that mixed the status with the instructions;
 * the user found it hard to read (2026-11-05).
 *
 * ITS BACKDROP IS THE STRONG ONE (`data-backdrop="strong"`, globals.css): the
 * resume page behind showed through the usual light dim and competed with
 * the steps.
 *
 * CLOSING IT RETURNS TO WHERE TAILOR STARTED: the page that opened Tailor's
 * route (`useBack`, ../../../back-link.tsx; the pick and the review share
 * the route, so its opener is the page before them), else the job posting.
 * Not Yet and Yes, I Applied leave the same way. Finish went straight to the
 * job posting's page before KAN-217, which showed nothing new: the student
 * had no file in hand, and Apply Now opened the form with no resume step.
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
  const [downloaded, setDownloaded] = useState(false);
  const download = useResumeDownload(resumeId);
  const back = useBack({ href: `/jobs/${encodeURIComponent(job.id)}`, name: "Job Posting" });
  const downloadRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);

  // Once the file is saved, focus follows the primary button to step 2.
  useEffect(() => {
    if (downloaded) openRef.current?.focus();
  }, [downloaded]);

  function leave() {
    setOpen(false);
    restoreScrollOn(back.href);
    router.push(back.href);
  }

  async function getPdf() {
    if (await download.pick("pdf")) setDownloaded(true);
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
          data-backdrop="strong"
          initialFocus={asking ? true : downloadRef}
          className={asking ? "max-h-[90vh] overflow-y-auto sm:max-w-3xl" : "gap-5 sm:max-w-md"}
        >
          {asking ? (
            <DidYouApply jobId={job.id} title={job.title} onClose={leave} onApplied={leave} />
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <span className="bg-positive-tint text-positive-ink flex size-9 shrink-0 items-center justify-center rounded-full">
                    <CheckIcon aria-hidden className="size-5" />
                  </span>
                  <DialogTitle className="text-subtitle font-semibold">
                    Your Resume Is Ready
                  </DialogTitle>
                </div>
                <DialogDescription>
                  Saved to your Tracker.{" "}
                  <Link
                    href={`/applications/${encodeURIComponent(job.id)}`}
                    className="text-brand font-medium underline underline-offset-2"
                  >
                    View
                  </Link>
                </DialogDescription>
              </DialogHeader>

              <section aria-labelledby={`apply-yourself-${job.id}`}>
                <h3 id={`apply-yourself-${job.id}`} className="text-label text-ink font-semibold">
                  Apply Yourself
                </h3>
                <ol role="list" className="mt-2 flex flex-col gap-2">
                  <Step number={1}>
                    {download.held ? (
                      <Button
                        ref={downloadRef}
                        size="sm"
                        onClick={() => {
                          download.keep();
                          setDownloaded(true);
                        }}
                      >
                        <FileArrowDownIcon aria-hidden /> Download Anyway
                      </Button>
                    ) : (
                      <Button
                        ref={downloadRef}
                        size="sm"
                        variant={downloaded ? "secondary" : "default"}
                        disabled={download.busy !== null}
                        onClick={() => void getPdf()}
                      >
                        <FileArrowDownIcon aria-hidden />
                        {download.busy ? "Making PDF…" : "Download PDF"}
                      </Button>
                    )}
                    {downloaded && (
                      <span className="text-note text-positive-ink flex items-center gap-1">
                        <CheckIcon aria-hidden className="size-3.5" /> Downloaded
                      </span>
                    )}
                  </Step>
                  <Step number={2}>
                    <a
                      ref={openRef}
                      href={job.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClasses({
                        variant: downloaded ? "default" : "secondary",
                        size: "sm",
                      })}
                      onClick={() => {
                        // The form opens in the new tab; this one asks whether
                        // they applied, as Apply Now's dialog does.
                        if (apply.canMarkApplied && !apply.applied) setAsking(true);
                      }}
                    >
                      Open {job.company}&apos;s Application
                      <ExternalLinkIcon className="size-4" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </Step>
                </ol>
                {download.held && (
                  <p className="text-note text-warning mt-2">
                    The PDF&apos;s font cannot show {download.held.missing_characters.join(" ")}.
                    Check the file before you send it.
                  </p>
                )}
                {download.error && <p className="text-note text-danger mt-2">{download.error}</p>}
              </section>

              {job.auto_apply && (
                <section
                  aria-labelledby={`auto-apply-${job.id}`}
                  className="border-border-subtle border-t pt-4"
                >
                  <h3 id={`auto-apply-${job.id}`} className="text-label text-ink font-semibold">
                    Or Let Auto Apply Do It
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-note text-ink-muted">
                      Fills {job.company}&apos;s form with this resume.
                    </p>
                    <AutoApplyButton
                      jobId={job.id}
                      title={job.title}
                      company={job.company}
                      stage={apply.stage}
                    />
                  </div>
                </section>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One numbered step: its number in a disc, then its controls. The number is
 *  the list's own for a screen reader, so the disc is hidden from it. */
function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className="bg-well text-ink-muted text-note flex size-6 shrink-0 items-center justify-center rounded-full font-semibold"
      >
        {number}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}
