"use client";

import { FileArrowDownIcon } from "@phosphor-icons/react/ssr";
// import Link from "next/link"; (Pick a Resume, hidden for now)
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ExternalLinkIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { type ResumeItem } from "@/lib/resume-actions";
import { applyWithResume } from "@/lib/sent-resume-actions";

import { markApplied } from "./actions";
import { useResumeFileDownload } from "./resume-download";
import {
  firstChoice,
  loadChoices,
  ResumeLists,
  ResumeListsSkeleton,
  type Choice,
} from "./resume-picker";
import { rememberStage } from "./shown-list";

/** "Did You Apply?"'s own choice: the student applied without a resume. */
const NO_RESUME = "none";

/**
 * "Pick a resume, then Apply" (KAN-220). Apply Now asks which resume the
 * student sends, keeps that exact file as a sent resume linked to this
 * posting (`applyWithResume`), then points to the resume on Resumes &
 * Experiences, the one place a student downloads resume files (KAN-267),
 * and offers the employer's own posting to apply on. The job posting page then says which resume was
 * sent ("You sent ... on ..."). A student with no resume, or who would rather not
 * pick one, still reaches the posting: "Apply Without a Resume".
 *
 * The employer's page opens from a link the student clicks, never from
 * `window.open` after the request: a browser blocks a new tab that no click
 * opened.
 *
 * "Did You Apply?" (KAN-242, `DidYouApply`). Once the student leaves for the
 * employer's posting, the dialog stays open behind the new tab and asks; Yes
 * marks the job applied (KAN-232), which takes it off their Jobs page. It
 * shows the resume they applied with (KAN-267): the one tailored to this job,
 * else the default, and they can change it, since they may have attached
 * another on the employer's page. The pick is kept as a sent resume for this
 * posting first (`applyWithResume`). Yes names the pick on the application
 * (`markApplied`'s `sentResumeId`), or none, which the tracker then shows. It
 * replaced an Applied button in the page's header, where one misclick marked
 * a job applied with no undo. It asks only a signed-in applicant
 * (`canMarkApplied`) who has not marked this job already (`applied`).
 *
 * THE PICK CAN BE DOWNLOADED FROM THE DIALOG (KAN-217): with Pick a Resume
 * hidden, Apply Now opens the employer's form with no resume in hand, so the
 * dialog's top row names the pick and downloads it (`useResumeFileDownload`)
 * while the form is open in the other tab. It is the second place a student
 * downloads a resume file, beside Resumes.
 *
 * EVERY APPLY NOW OPENS THIS DIALOG (KAN-290): the job posting page, the feed
 * card (/jobs, /search). WorkIt cannot see the
 * employer's site, so this is its one chance to learn which resume went and
 * whether the student applied; a card's Apply Now once linked straight to the
 * employer and recorded neither.
 *
 * A JOB MARKED APPLIED LEAVES EVERY LIST AT ONCE (KAN-217): Yes tells the
 * shown list (`rememberStage`), so the rail beside a job's page and a list
 * Next kept for Back drop it too, as Save does. A list that draws its cards
 * in the browser drops it itself as well (`onApplied`), since a refresh
 * redraws only the server's first page (./feed-list); anywhere else a mark
 * refreshes the route.
 */
export function ApplyButton({
  jobId,
  title,
  applyUrl,
  canMarkApplied = false,
  applied = false,
  // showsSent: read only by Pick a Resume's Apply, hidden for now.
  onApplied,
  className,
}: {
  jobId: string;
  title: string;
  applyUrl: string;
  /** A signed-in applicant, who can mark a job applied. */
  canMarkApplied?: boolean;
  /** Marked applied already: the dialog never asks again. */
  applied?: boolean;
  /** The page says which resume was sent: refresh it once one is. */
  showsSent?: boolean;
  /** Takes the job off the caller's list once marked applied, in place of
   *  refreshing the route. */
  onApplied?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function marked() {
    setOpen(false);
    if (onApplied) return onApplied();
    // The page's "You applied on …" reads the new mark.
    router.refresh();
  }

  return (
    <>
      {/* sm, as every action in the bar it sits in (./action-bar.tsx): lg
          stood 12px over Ask Scout and Tailor My Resume (frontend/docs/
          design.md, "Pick a button's size by where it sits"). */}
      {/* PICK A RESUME IS HIDDEN FOR NOW: Apply Now is a plain link to the
          employer's posting, in a new tab. A signed-in applicant who has
          not marked the job gets "Did You Apply?" behind that tab, from the
          same click: a link click opens the tab itself, so no popup blocker
          stops it. The hidden steps are at the end of this file. */}
      <a
        href={applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses({ size: "sm", className })}
        onClick={() => {
          if (canMarkApplied && !applied) setOpen(true);
        }}
      >
        Apply Now
        <ExternalLinkIcon className="size-4" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Wide on a full-screen window, with the two resume lists side by
            side, so it fits without a scrollbar: at the dialog's default
            width (sm:max-w-sm) the lists and the upload stacked into a
            narrow column taller than the window. It still scrolls inside
            itself on a short or narrow window. */}
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {open && (
            <DidYouApply
              jobId={jobId}
              title={title}
              onClose={() => setOpen(false)}
              onApplied={marked}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * "Did You Apply?" itself, the content of a dialog the caller draws: Apply
 * Now's above, and Tailor's Your Resume Is Ready once its Open the Application is
 * clicked (./[jobId]/tailor/ready-to-apply.tsx), so the two ask the same way.
 * It reads the resume list on mount. Yes keeps the pick as a sent resume,
 * marks the job applied, tells the shown list, then calls `onApplied`.
 */
export function DidYouApply({
  jobId,
  title,
  onClose,
  onApplied,
}: {
  jobId: string;
  title: string;
  /** Not Yet. */
  onClose: () => void;
  /** After Yes has saved. */
  onApplied: () => void;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The pick: a choice's key, or NO_RESUME.
  const [appliedWith, setAppliedWith] = useState(NO_RESUME);
  // Upload a resume there, the Resumes page's way (./resume-picker): the
  // uploads, for the limit, and whether a file is on its way.
  const [uploads, setUploads] = useState<ResumeItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const onUploadBusy = useCallback((busy: boolean) => setUploading(busy), []);
  const file = useResumeFileDownload();

  /** Reads the list again without blanking it, so an upload in progress
   *  keeps its place. */
  const refresh = useCallback(async (): Promise<Choice[]> => {
    const { choices, uploads, error } = await loadChoices(jobId);
    setChoices(choices);
    setUploads(uploads);
    if (error) setError(error);
    return choices;
  }, [jobId]);

  useEffect(() => {
    let live = true;
    void loadChoices(jobId).then(({ choices, uploads, error }) => {
      if (!live) return;
      setChoices(choices);
      setUploads(uploads);
      if (error) setError(error);
      // Starts on the resume tailored to this job, else the default.
      setAppliedWith(firstChoice(choices)?.key ?? NO_RESUME);
    });
    return () => {
      live = false;
    };
  }, [jobId]);

  // A file uploaded here (or the resume it duplicates) becomes the pick.
  async function uploaded(id: string) {
    await refresh();
    setAppliedWith(`uploaded:${id}`);
  }

  async function confirmApplied() {
    setBusy(true);
    setError(null);
    // The sent resume the application names (KAN-267): the pick, kept now
    // as a sent resume for this posting, or none.
    let sentResumeId: string | null = null;
    const choice = choices?.find((c) => c.key === appliedWith);
    if (choice) {
      const kept = await applyWithResume(choice.source, jobId);
      if (!kept.data) {
        setBusy(false);
        return setError(kept.error);
      }
      sentResumeId = kept.data.id;
    }
    const result = await markApplied(jobId, sentResumeId);
    setBusy(false);
    if (result.error) return setError(result.error);
    rememberStage(jobId, "applied");
    onApplied();
  }

  const picked = choices?.find((c) => c.key === appliedWith);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-subtitle font-semibold">Did You Apply?</DialogTitle>
        <DialogDescription>
          If you sent your application for {title}, check the resume you sent and mark it applied.
          WorkIt moves it to your Tracker.
        </DialogDescription>
      </DialogHeader>
      {/* The pick, to attach on the employer's form (KAN-217). */}
      {picked && (
        <div className="rounded-control border-border-control flex flex-wrap items-center justify-between gap-3 border px-3 py-2">
          <p className="text-note text-ink min-w-0">
            Attach <span className="font-medium">{picked.label}</span> on the employer&apos;s form.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={file.busy}
            onClick={() => void file.download(picked.source)}
          >
            <FileArrowDownIcon aria-hidden /> {file.busy ? "Downloading…" : "Download"}
          </Button>
          {file.error && <p className="text-note text-danger basis-full">{file.error}</p>}
        </div>
      )}
      {/* One radio group (`applied-with`): every resume in the
          list, a file they sent instead (Upload Resume in its row),
          or none. */}
      {choices == null ? (
        <ResumeListsSkeleton />
      ) : (
        <ResumeLists
          name="applied-with"
          choices={choices}
          empty="None yet. Upload the file you sent."
          picked={appliedWith}
          onPick={setAppliedWith}
          upload={{ uploads, onUploaded: uploaded, onBusyChange: onUploadBusy }}
        />
      )}
      {/* No Resume is a button, not a section of its own: pressed, it
          is the pick (every radio above clears), and Yes then marks
          the job applied with no resume. */}
      {choices != null && (
        <Button
          variant={appliedWith === NO_RESUME ? "default" : "secondary"}
          aria-pressed={appliedWith === NO_RESUME}
          onClick={() => setAppliedWith(NO_RESUME)}
          className="w-full"
        >
          No Resume
        </Button>
      )}
      {error && <p className="text-note text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Not Yet
        </Button>
        {/* Off until the resume list is in: Yes names the resume picked
            there, and before it loads the pick is only a guess. */}
        <Button onClick={confirmApplied} disabled={busy || choices == null || uploading}>
          {busy ? "Saving…" : "Yes, I Applied"}
        </Button>
      </DialogFooter>
    </>
  );
}

// --- Pick a Resume, hidden for now ---------------------------------------
// The state below lived in ApplyButton until "Did You Apply?" became its own
// component (`DidYouApply`, KAN-217), which now holds the choices; bring
// `sent` and `sentKey` back there with the rest.
// Apply Now opened this dialog on "Pick a Resume"; Apply kept the pick as a
// sent resume (`apply`), then "Your Resume Is Ready" linked to Resumes &
// Experiences and to the employer's posting (`employerLink`), whose click
// moved to "Did You Apply?" (`ask`). To bring it back: uncomment `picked`,
// `ask` and these, put `apply` and `employerLink` back in the component,
// make Apply Now a Button that opens the dialog and calls `load()` (which
// sets `picked` again), and put the two branches back in front of "Did You
// Apply?" in the ternary they came from (`asking ? ... : sent ? ... : ...`).
// `Link` comes back to the imports, and `ResumeChoices` from ./resume-picker.
//
//   async function apply() {
//     const choice = choices?.find((c) => c.key === picked);
//     if (!choice) return;
//     setBusy(true);
//     setError(null);
//     const { data, error } = await applyWithResume(choice.source, jobId);
//     setBusy(false);
//     if (!data) return setError(error);
//     setSent(data);
//     // The page's "You sent <name> on <date>" reads the new sent resume.
//     if (showsSent) router.refresh();
//   }
//
//   const employerLink = (label: string, variant: "default" | "secondary") => (
//     <a
//       href={applyUrl}
//       target="_blank"
//       rel="noopener noreferrer"
//       className={buttonClasses({ variant })}
//       // The posting opens in a new tab; this dialog stays to ask whether they
//       // applied, for when they come back. Anyone it can't mark just closes it.
//       onClick={() => (canMarkApplied && !applied ? ask() : setOpen(false))}
//     >
//       {label}
//       <ExternalLinkIcon className="size-4" />
//       <span className="sr-only"> (opens in a new tab)</span>
//     </a>
//   );
//
//           ) : sent ? (
//             <>
//               <DialogHeader>
//                 <DialogTitle className="text-subtitle font-semibold">
//                   Your Resume Is Ready
//                 </DialogTitle>
//                 <DialogDescription>
//                   WorkIt kept a copy of &ldquo;{sent.name}&rdquo;, linked to {title}. Download it
//                   from Resumes &amp; Experiences, then attach it on the employer&apos;s page.
//                 </DialogDescription>
//               </DialogHeader>
//               {sent.missing_characters.length > 0 && (
//                 <p className="text-note text-warning">
//                   The PDF&apos;s font cannot show {sent.missing_characters.join(" ")}. Check the
//                   file before you send it.
//                 </p>
//               )}
//               <DialogFooter>
//                 {/* Resume files come from Resumes & Experiences only (KAN-267):
//                     a built resume opens in its editor, which downloads it,
//                     an upload on the Resumes view. A new tab, so this dialog
//                     stays to ask "Did You Apply?" later. */}
//                 <Link
//                   href={
//                     sent.built_resume_id
//                       ? `/resumes/${encodeURIComponent(sent.built_resume_id)}`
//                       : "/resumes"
//                   }
//                   target="_blank"
//                   rel="noopener noreferrer"
//                   className={buttonClasses({ variant: "secondary" })}
//                 >
//                   Open in Resumes
//                   <ExternalLinkIcon className="size-4" />
//                   <span className="sr-only"> (opens in a new tab)</span>
//                 </Link>
//                 {employerLink("Open the Posting", "default")}
//               </DialogFooter>
//             </>
//           ) : (
//             <>
//               <DialogHeader>
//                 <DialogTitle className="text-subtitle font-semibold">Pick a Resume</DialogTitle>
//                 <DialogDescription>
//                   WorkIt keeps the exact file you send, so you can see later what {title} received.
//                 </DialogDescription>
//               </DialogHeader>
//               {choices == null ? (
//                 <p className="text-note text-ink-muted">Loading your resumes…</p>
//               ) : choices.length === 0 ? (
//                 !error && (
//                   <p className="text-note text-ink-muted">
//                     You have no resumes yet. Generate one under Resumes, or apply without one.
//                   </p>
//                 )
//               ) : (
//                 <ResumeChoices
//                   legend="Resume to Send"
//                   hideLegend
//                   name="resume"
//                   choices={choices}
//                   picked={picked}
//                   onPick={setPicked}
//                 />
//               )}
//               {error && <p className="text-note text-danger">{error}</p>}
//               <DialogFooter>
//                 {employerLink("Apply Without a Resume", "secondary")}
//                 <Button onClick={apply} disabled={busy || picked == null}>
//                   {busy ? "Saving…" : "Apply"}
//                 </Button>
//               </DialogFooter>
//             </>
