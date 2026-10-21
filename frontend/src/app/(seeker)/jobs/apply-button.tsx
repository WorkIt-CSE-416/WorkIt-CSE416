"use client";

// import Link from "next/link"; (Pick a Resume, hidden for now)
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ExternalLinkIcon } from "@/components/icons";
import { ResumeUpload } from "@/components/resume-upload";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { listResumes, replaceResume, uploadResume, type ResumeItem } from "@/lib/resume-actions";
import { MAX_UPLOADS } from "@/lib/resume-limits";
import { applyWithResume, type SentDownload } from "@/lib/sent-resume-actions";

import { markApplied } from "./actions";

/** One resume the student can apply with: a built resume (a base resume, or
 *  the one tailored to this posting) or an uploaded resume. */
type Choice = { key: string; label: string; kind: string; source: Source; isDefault: boolean };
type Source = { builtResumeId: string } | { uploadedResumeId: string };

/** "Did You Apply?"'s own choice: the student applied without a resume. */
const NO_RESUME = "none";

/** The choice a sent resume came from, as `load` keys them. */
function sentKey(sent: SentDownload): string {
  return sent.built_resume_id
    ? `built:${sent.built_resume_id}`
    : `uploaded:${sent.uploaded_resume_id}`;
}

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
 * "Did You Apply?" (KAN-242). Once the student leaves for the employer's
 * posting, the dialog stays open behind the new tab and asks; Yes marks the
 * job applied (KAN-232), which takes it off their Jobs page. It shows the
 * resume they applied with (KAN-267): the one picked at Apply, else No
 * Resume (Apply Without a Resume), and they can change it, since they may
 * have attached another on the employer's page. A resume other than the one
 * sent is kept as a sent resume for this posting first (`applyWithResume`).
 * Yes names the pick on the application (`markApplied`'s `sentResumeId`),
 * or none, which the tracker then shows. It replaced an
 * Applied button in the page's header, where one misclick marked a job
 * applied with no undo. It asks only a signed-in applicant (`canMarkApplied`)
 * who has not marked this job already (`applied`).
 *
 * EVERY APPLY NOW OPENS THIS DIALOG (KAN-290): the job posting page, the feed
 * card (/jobs, /search) and the Dashboard's New Matches. WorkIt cannot see the
 * employer's site, so this is its one chance to learn which resume went and
 * whether the student applied; a card's Apply Now once linked straight to the
 * employer and recorded neither.
 *
 * ONLY THE JOB'S OWN PAGE REFRESHES ON A SEND (`showsSent`): it is the one
 * screen that says which resume went. On a card a refresh reran the whole
 * feed, Best Match scoring and all, to redraw nothing. A list that draws its
 * cards in the browser drops a job marked applied itself (`onApplied`), since
 * a refresh redraws only the server's first page (./feed-list); anywhere else
 * a mark refreshes the route.
 */
export function ApplyButton({
  jobId,
  title,
  applyUrl,
  canMarkApplied = false,
  applied = false,
  // showsSent: read only by Pick a Resume's Apply, hidden for now.
  onApplied,
  label = "Apply Now",
  "aria-label": ariaLabel,
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
  /** The button's words: New Matches' row has room for "Apply" only. */
  label?: string;
  /** For a short label, the job it applies to, as a screen reader hears it. */
  "aria-label"?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  // const [picked, setPicked] = useState<string | null>(null); (Pick a Resume, hidden for now)
  const [sent, setSent] = useState<SentDownload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // "Did You Apply?"'s pick: a choice's key, or NO_RESUME.
  const [appliedWith, setAppliedWith] = useState(NO_RESUME);
  // Upload a resume there, the Resumes page's way (KAN-267): the uploads,
  // for the limit and the one to replace past it; a file waiting for that
  // pick; and what the last upload said.
  const [uploads, setUploads] = useState<ResumeItem[]>([]);
  const [waiting, setWaiting] = useState<File | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function load() {
    setChoices(null);
    setSent(null);
    setError(null);
    const [built, uploaded] = await Promise.all([listBuiltResumes(), listResumes()]);
    if (built.error || uploaded.error) {
      setChoices([]);
      return setError(built.error ?? uploaded.error);
    }
    setUploads(uploaded.resumes);
    const list: Choice[] = [
      ...(built.data ?? [])
        // A resume tailored to another posting shows only as the primary
        // (KAN-268): the student starred it, so it is theirs to send.
        .filter((r) => r.job_posting_id == null || r.job_posting_id === jobId || r.is_default)
        .map((r) => ({
          key: `built:${r.id}`,
          label: r.name,
          kind:
            r.job_posting_id === jobId
              ? "Tailored to this job"
              : r.job_posting_id
                ? "Tailored resume"
                : "Built resume",
          source: { builtResumeId: r.id },
          isDefault: r.is_default,
        })),
      ...uploaded.resumes
        .filter((r) => r.storage_path)
        .map((r) => ({
          key: `uploaded:${r.id}`,
          label: r.original_filename ?? "Uploaded resume",
          kind: "Uploaded file",
          source: { uploadedResumeId: r.id },
          isDefault: r.is_default,
        })),
    ];
    setChoices(list);
    // The tailored resume first, else the default resume, else the first.
    const first =
      list.find((c) => c.kind === "Tailored to this job") ??
      list.find((c) => c.isDefault) ??
      list[0];
    // setPicked(first?.key ?? null); (Pick a Resume, hidden for now)
    // With nothing picked at Apply, "Did You Apply?" starts on it.
    setAppliedWith(first?.key ?? NO_RESUME);
  }

  // Called by the hidden employer link (end of file).
  // function ask() {
  //   setAppliedWith(sent ? sentKey(sent) : NO_RESUME);
  //   setError(null);
  //   setAsking(true);
  // }

  // A file dropped on "Did You Apply?": uploaded as the Resumes page does,
  // or, at the limit, held until the student picks an upload to replace.
  function pickFile(file: File) {
    setUploadError(null);
    setUploadNote(null);
    if (uploads.length >= MAX_UPLOADS) {
      setWaiting(file);
      setReplacing(uploads[0]?.id ?? null);
      return;
    }
    void send(file, null);
  }

  /** Uploads the file, or with `replace` puts it on that upload's row
   *  (Import Updated Resume: the old file's sent resumes keep a frozen
   *  copy). Then the list is read again and the new resume picked; a
   *  duplicate picks the resume it matched instead. */
  async function send(file: File, replace: string | null) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const { resume, error, duplicateOf } = replace
      ? await replaceResume(replace, fd)
      : await uploadResume(fd);
    setUploading(false);
    if (!resume && !duplicateOf) return setUploadError(error ?? "Could not upload the resume.");
    setWaiting(null);
    await load();
    setAppliedWith(`uploaded:${resume?.id ?? duplicateOf}`);
    setUploadNote(
      duplicateOf
        ? `${error} It is picked under Uploaded Resumes.`
        : `Uploaded ${file.name}. It is picked under Uploaded Resumes.`,
    );
  }

  async function confirmApplied() {
    setBusy(true);
    setError(null);
    // The sent resume the application names (KAN-267): the one sent at
    // Apply, one kept now for a different pick, or none.
    let sentResumeId: string | null = null;
    const choice = choices?.find((c) => c.key === appliedWith);
    if (choice && sent && sentKey(sent) === choice.key) sentResumeId = sent.id;
    else if (choice) {
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
    setOpen(false);
    if (onApplied) return onApplied();
    // The page's "You applied on …" reads the new mark, and New Matches
    // drops the job.
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
        aria-label={ariaLabel}
        onClick={() => {
          if (!canMarkApplied || applied) return;
          setOpen(true);
          setAsking(true);
          setWaiting(null);
          setUploadNote(null);
          setUploadError(null);
          void load();
        }}
      >
        {label}
        <ExternalLinkIcon className="size-4" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Scrolls inside itself: with the list and the upload it can pass
            a short window's height. */}
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {asking && (
            <>
              <DialogHeader>
                <DialogTitle className="text-subtitle font-semibold">Did You Apply?</DialogTitle>
                <DialogDescription>
                  If you sent your application for {title}, check the resume you sent and mark it
                  applied. WorkIt takes it off your Jobs page.
                </DialogDescription>
              </DialogHeader>
              {/* Four sections, one radio group (`applied-with`): what WorkIt
                  made, what the student uploaded, a file they sent instead,
                  or none. */}
              {choices == null ? (
                <p className="text-note text-ink-muted">Loading your resumes…</p>
              ) : (
                <>
                  <ResumeChoices
                    legend="Generated Resumes"
                    name="applied-with"
                    choices={choices.filter((c) => c.key.startsWith("built:"))}
                    empty="None yet. Generate Resume on Resumes & Experiences makes one."
                    picked={appliedWith}
                    onPick={setAppliedWith}
                  />
                  <ResumeChoices
                    legend="Uploaded Resumes"
                    name="applied-with"
                    choices={choices.filter((c) => c.key.startsWith("uploaded:"))}
                    empty="None yet. Upload the file you sent below."
                    picked={appliedWith}
                    onPick={setAppliedWith}
                  />
                </>
              )}
              {choices != null && (
                <div className="flex flex-col gap-2">
                  <p className="text-label text-ink">Sent a Different Resume?</p>
                  {waiting ? (
                    // At the limit: which upload the new file replaces.
                    <>
                      <p className="text-note text-ink-muted">
                        You have {MAX_UPLOADS} uploaded resumes, the most WorkIt keeps. Pick the one{" "}
                        {waiting.name} replaces. Applications sent with it keep a copy.
                      </p>
                      <ResumeChoices
                        legend="Upload to Replace"
                        hideLegend
                        name="replace"
                        choices={uploads.map((r) => ({
                          key: r.id,
                          label: r.original_filename ?? "Uploaded resume",
                        }))}
                        picked={replacing}
                        onPick={setReplacing}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setWaiting(null)}
                          disabled={uploading}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void send(waiting, replacing)}
                          disabled={uploading || replacing == null}
                        >
                          {uploading ? "Replacing…" : "Replace It"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <ResumeUpload
                      file={null}
                      onFileChange={pickFile}
                      onRemove={() => {}}
                      busy={uploading}
                    />
                  )}
                  {uploadError && (
                    <p role="alert" className="text-meta text-danger">
                      {uploadError}
                    </p>
                  )}
                  {uploadNote && (
                    <p className="text-note text-ink-muted" aria-live="polite">
                      {uploadNote}
                    </p>
                  )}
                </div>
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
              {error && <p className="text-meta text-danger">{error}</p>}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Not Yet
                </Button>
                {/* Off until the resume list is in: Yes names the resume picked
                    there, and before it loads the pick is only a guess. */}
                <Button
                  onClick={confirmApplied}
                  disabled={busy || choices == null || uploading || waiting != null}
                >
                  {busy ? "Saving…" : "Yes, I Applied"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One radio row per resume, by its name. */
function ResumeChoices({
  legend,
  hideLegend = false,
  name,
  choices,
  empty,
  picked,
  onPick,
}: {
  legend: string;
  hideLegend?: boolean;
  name: string;
  /** What an empty section says, under its title. */
  empty?: string;
  choices: { key: string; label: string }[];
  picked: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={hideLegend ? "sr-only" : "text-label text-ink mb-1"}>{legend}</legend>
      {choices.length === 0 && empty && <p className="text-note text-ink-meta">{empty}</p>}
      {choices.map((c) => (
        <label
          key={c.key}
          className="hover:bg-hover has-checked:border-brand border-border rounded-control flex cursor-pointer items-center gap-3 border px-3 py-2"
        >
          <input
            type="radio"
            name={name}
            value={c.key}
            checked={picked === c.key}
            onChange={() => onPick(c.key)}
            className="accent-brand"
          />
          {/* The name alone: the section title already says what kind it is,
              and a grey kind line under each name only repeated it. */}
          <span className="text-body text-ink min-w-0 truncate">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

// --- Pick a Resume, hidden for now ---------------------------------------
// Apply Now opened this dialog on "Pick a Resume"; Apply kept the pick as a
// sent resume (`apply`), then "Your Resume Is Ready" linked to Resumes &
// Experiences and to the employer's posting (`employerLink`), whose click
// moved to "Did You Apply?" (`ask`). To bring it back: uncomment `picked`,
// `ask` and these, put `apply` and `employerLink` back in the component,
// make Apply Now a Button that opens the dialog and calls `load()` (which
// sets `picked` again), and put the two branches back in front of "Did You
// Apply?" in the ternary they came from (`asking ? ... : sent ? ... : ...`).
// `Link` comes back to the imports.
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
//               {error && <p className="text-meta text-danger">{error}</p>}
//               <DialogFooter>
//                 {employerLink("Apply Without a Resume", "secondary")}
//                 <Button onClick={apply} disabled={busy || picked == null}>
//                   {busy ? "Saving…" : "Apply"}
//                 </Button>
//               </DialogFooter>
//             </>
