"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  SparkleIcon,
} from "@/components/icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/shadcn/dialog";
import { Skeleton } from "@/components/shadcn/skeleton";
import { readEvents } from "@/components/scout/stream";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { ResumeItem } from "@/lib/resume-actions";
import {
  matchTailor,
  type Keyword,
  type TailorMatch,
  type TailorRunResult,
  type TailorSource,
  type TailorStreamEvent,
} from "@/lib/tailor-actions";

import type { MatchShift, TailorReviewRecord } from "../../../resumes/[resumeId]/tailor-review";
import { loadChoices, ResumeLists, type Choice } from "../../resume-picker";
import { ResumePreviewDialog } from "./resume-preview";
import { BackToJobs } from "../page-actions";
import type { JobListing } from "../../listings";
import { TailorBar, TailorHeader } from "./tailor-header";
import { type TailorStep } from "./tailor-steps";

/** The run's phases, in order, as its loader lists them, by the
 *  streamed run's lines (`TailorStreamEvent`): Retrieving Info until the API
 *  sends `asking`, and Compiling Resume once `done` has come and the editor
 *  loads. */
const PHASE = {
  retrieving: "Retrieving Info",
  asking: "Asking AI",
  generating: "Generating Resume",
  compiling: "Compiling Resume",
} as const;
type Phase = keyof typeof PHASE;
const PHASES = Object.keys(PHASE) as Phase[];

/** Tailor's first pick: the primary unless it is tailored, else the first
 *  one not tailored. A resume tailored to another posting is the picker's
 *  primary (KAN-268), but tailoring it again starts from another job's
 *  changes, so it is never picked for the student; this posting's own
 *  tailored resume cannot be a source at all, since a run replaces it (the
 *  API answers 422). It was picked first until a run could replace it. */
function tailorFirst(choices: Choice[]): Choice | undefined {
  return (
    choices.find((c) => c.isDefault && c.type !== "Tailored") ??
    choices.find((c) => c.type !== "Tailored") ??
    choices.find((c) => !c.forThisJob)
  );
}

/**
 * Each pick step's own title and line, under its top row. Both steps read
 * "Tailor Your Resume to {title}" over one line about the whole flow until
 * 2026-10-26, which told the student nothing about the step in front of
 * them; the top row already names the step, so the title asks for what the
 * step needs and the line says what follows from it. The keyword card's
 * own note says what a picked keyword means, so step 2's line does not.
 */
const HEADINGS = {
  pick: {
    title: "Pick the Resume to Start From",
    line: "WorkIt saves a tailored copy for this job and leaves the resume you pick as it is. Preview any resume before you choose.",
  },
  keywords: {
    title: "Add the Keywords You Have Used",
    line: "Then Tailor Resume rewrites this resume's bullets for the job. It never adds a number or tool you did not give, and you can undo any change.",
  },
} as const;

/**
 * The Tailor screen (KAN-217, docs/tailor_resume.md), one step at a time
 * under the step's top row (`TailorBar`: Back, the step, and its way on):
 * Pick a Resume, then Choose Keywords, each its own view. The keyword match sat under the picker on
 * one page until 2026-10-26, so the student scrolled past the list to read
 * it. The step lives in this component, not the URL: a reload starts again
 * at the pick, which reads nothing the student would lose.
 *
 * Pick a Resume: the student picks a generated or uploaded resume, or
 * uploads one with the Resumes page's rules (../../resume-picker, KAN-318);
 * a card's Preview opens it in a dialog (./resume-preview.tsx) without
 * picking it. Use This Resume reads its keyword match and moves on. Choose
 * Keywords: the match, and the missing keywords to add as skills
 * (`KeywordCard`).
 * Back keeps the picks: the same resume picked again keeps its match and
 * its keywords, read once. Tailor Resume saves the posting's one tailored
 * resume with no confirmation, or replaces it when the posting has one (the
 * review's Back opens Choose Keywords again, `start`), under a loader in the middle
 * of the window (`TailorRunning`); then the tailored resume's editor opens
 * on this route (Review Changes, ./page.tsx). The run's record of changes
 * goes to sessionStorage (`tailorEditsKey`) for the editor; nothing else
 * keeps it.
 */
export function TailorScreen({
  jobId,
  start,
  job,
}: {
  jobId: string;
  /** The posting, for each step's title, line and job card (`TailorHeader`). */
  job: JobListing;
  /** Where to open: the review's Back opens Choose Keywords for the resume
   *  the run started from (`source`, a picker key such as "built:<id>"), so
   *  the student can pick other keywords and run again. */
  start?: { step: "keywords"; source: string };
}) {
  const router = useRouter();
  const [step, setStep] = useState<Exclude<TailorStep, "review">>("pick");
  const [source, setSource] = useState<TailorSource | null>(null);
  const [match, setMatch] = useState<TailorMatch | null>(null);
  /** The choice the match was read for, so Back and the same pick keep it. */
  const [matchedKey, setMatchedKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("retrieving");
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [uploads, setUploads] = useState<ResumeItem[]>([]);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** The resume last previewed; the dialog stays mounted once opened, so a
   *  resume opened again shows at once. */
  const [previewed, setPreviewed] = useState<Choice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const onUploadBusy = useCallback((busy: boolean) => setUploading(busy), []);
  const refreshChoices = useCallback(async (): Promise<Choice[]> => {
    const result = await loadChoices(jobId);
    setChoices(result.choices);
    setUploads(result.uploads);
    setChoiceError(result.error);
    setSource(null);
    setMatch(null);
    setMatchedKey(null);
    setSelected(tailorFirst(result.choices)?.key ?? null);
    return result.choices;
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void loadChoices(jobId).then((result) => {
      if (cancelled) return;
      setChoices(result.choices);
      setUploads(result.uploads);
      setChoiceError(result.error);
      // Back from the review opens Choose Keywords on its source, read again
      const back = result.choices.find((c) => c.key === start?.source && !c.forThisJob);
      setSelected((back ?? tailorFirst(result.choices))?.key ?? null);
      if (back) void next(back);
    });
    return () => {
      cancelled = true;
    };
    // `next` reads only setters and the mount's empty match, so the mount's
    // copy is the one to call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, start?.source]);

  const pickedChoice = choices?.find((c) => c.key === selected) ?? null;
  const matchedChoice = choices?.find((c) => c.key === matchedKey) ?? null;

  /** Use This Resume: on to Choose Keywords, reading the match only for a
   *  resume it has not read. A failed read comes back to the pick with its
   *  error; a posting already tailored opens that resume (the API's 409). */
  async function next(choice: Choice) {
    setError(null);
    setStep("keywords");
    if (match && matchedKey === choice.key) return;
    const next = toSource(choice);
    setReading(true);
    setMatch(null);
    setMatchedKey(null);
    const { data, error, status } = await matchTailor(jobId, next);
    setReading(false);
    if (!data) {
      setStep("pick");
      return setError({ message: error ?? "WorkIt couldn't read that resume.", status });
    }
    setSource(next);
    setMatch(data);
    setMatchedKey(choice.key);
    setPicked(new Set());
  }

  async function uploaded(id: string) {
    const refreshed = await refreshChoices();
    setSelected(refreshed.find((choice) => choice.key === `uploaded:${id}`)?.key ?? null);
  }

  async function run() {
    if (!source) return;
    setRunning(true);
    setError(null);
    setPhase("retrieving");
    const failed = (message: string, status: number | null) => {
      setRunning(false);
      setError({ message, status });
    };
    let result: TailorRunResult | null = null;
    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_posting_id: jobId, ...source, skills: [...picked] }),
      });
      // A refusal before the model call (an empty bank, a posting already
      // tailored) is an HTTP status with the API's detail, as the action's was.
      if (!res.ok || !res.body) {
        const body: unknown = await res.json().catch(() => null);
        const detail = (body as { detail?: unknown } | null)?.detail;
        const message =
          typeof detail === "string" ? detail : (detail as { message?: unknown } | null)?.message;
        return failed(typeof message === "string" ? message : "Tailor failed.", res.status);
      }
      for await (const event of readEvents<TailorStreamEvent>(res.body)) {
        if (event.type === "phase") setPhase(event.phase);
        else if (event.type === "error") return failed(event.message, event.status);
        else result = event.result;
      }
    } catch {
      return failed("Tailor couldn't reach WorkIt. Try again in a minute.", null);
    }
    // A stream that ends with no last line lost its connection mid-run.
    if (!result) return failed("Tailor stopped before it finished. Try again.", null);
    setPhase("compiling");
    const had = new Set(result.matched.map((k) => k.keyword));
    const match: MatchShift = {
      before: result.matched.length,
      after: result.after_matched.length,
      total: result.after_matched.length + result.after_missing.length,
      added: result.after_matched.filter((k) => !had.has(k.keyword)),
    };
    const record: TailorReviewRecord = { edits: result.edits, match, source };
    writeSessionDraft(tailorEditsKey(result.resume.id), record);
    router.push(
      `/jobs/${encodeURIComponent(jobId)}/tailor?resumeId=${encodeURIComponent(result.resume.id)}`,
    );
  }

  const toggle = (keyword: string) =>
    setPicked((all) => {
      const next = new Set(all);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });

  return (
    <>
      <TailorBar
        step={step}
        back={
          step === "pick" ? (
            <BackToJobs className="group/back" />
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={running}
              onClick={() => {
                setError(null);
                setStep("pick");
              }}
            >
              <ArrowLeftIcon /> Back
            </Button>
          )
        }
        next={
          step === "pick" ? (
            <Button
              size="sm"
              onClick={() => pickedChoice && void next(pickedChoice)}
              disabled={!pickedChoice || reading || uploading}
            >
              Use This Resume <ArrowRightIcon />
            </Button>
          ) : (
            <Button size="sm" onClick={run} disabled={running || reading || !match}>
              <SparkleIcon /> Tailor Resume
            </Button>
          )
        }
      />
      <div className="mt-4">
        <TailorHeader job={job} title={HEADINGS[step].title}>
          {HEADINGS[step].line}
        </TailorHeader>
      </div>
      <div className="mt-4">
        {step === "pick" && (
          <>
            <Card as="section" aria-label="Pick a Resume" className="flex min-w-0 flex-col gap-3">
              {choices == null ? (
                <p className="text-note text-ink-muted">Loading your resumes…</p>
              ) : (
                <>
                  <ResumeLists
                    name="tailor-from"
                    choices={choices}
                    empty="None yet. Upload one, or generate one on Resumes & Experiences."
                    picked={selected}
                    onPick={(key) => {
                      setSelected(key);
                      setError(null);
                    }}
                    onPreview={(choice) => {
                      setPreviewed(choice);
                      setPreviewOpen(true);
                    }}
                    upload={{ uploads, onUploaded: uploaded, onBusyChange: onUploadBusy }}
                  />
                </>
              )}
              {choiceError && (
                <p role="alert" className="text-note text-danger">
                  {choiceError}
                </p>
              )}
              {/* KAN-319: the Tailor limit is lifted for now, so the cost is hidden.
              <p className="text-note text-ink-meta">
                Each run uses one of today&apos;s 2 Tailor runs.
              </p>
              */}
              <TailorError error={error} />
            </Card>
            {previewed && (
              <ResumePreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                label={previewed.label}
                source={toSource(previewed)}
              />
            )}
          </>
        )}

        {step === "keywords" && (reading || !match) && <MatchWaiting />}

        {step === "keywords" && !reading && match && (
          <KeywordCard
            match={match}
            resume={matchedChoice?.label}
            picked={picked}
            onToggle={toggle}
            onSet={setPicked}
            error={error}
          />
        )}
      </div>
      <TailorRunning
        open={running}
        phase={phase}
        resume={matchedChoice?.label}
        keywords={picked.size}
      />
    </>
  );
}

/**
 * Choose Keywords: one card, read top to bottom. The match as one line and
 * a bar ("3 of 14 keywords matched"), the matched keywords as quiet tags,
 * then the missing ones to add (`MissingKeywords`); Back and Tailor Resume
 * are the step's top row (`TailorBar`), and they sat at its foot until
 * then. It was a big "3 of 14", the matched tags in brand
 * for the required ones, a checkbox drawn in every missing chip and Add
 * All as a text link, which the user found overloaded (2026-10-26).
 */
function KeywordCard({
  match,
  resume,
  picked,
  onToggle,
  onSet,
  error,
}: {
  match: TailorMatch;
  resume: string | undefined;
  picked: Set<string>;
  onToggle: (keyword: string) => void;
  onSet: (next: Set<string>) => void;
  error: { message: string; status: number | null } | null;
}) {
  const total = match.matched.length + match.missing.length;
  return (
    <Card as="section" aria-labelledby="tailor-match" className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="tailor-match" className="text-subtitle text-ink">
            Keyword Match
          </h2>
          {resume && <p className="text-note text-ink-meta">{resume}</p>}
        </div>
        <MatchSummary matched={match.matched.length} total={total} />
        {match.weak_match && (
          <p role="note" className="text-note text-ink-muted mt-2">
            Weak match: this posting has no description, so WorkIt read only its title.
          </p>
        )}
        {match.matched.length > 0 && (
          <ul role="list" aria-label="Matched" className="mt-3 flex flex-wrap gap-1.5">
            {match.matched.map((k) => (
              <li key={k.keyword}>
                <Badge variant="tag" tone="neutral">
                  {k.keyword}
                  {k.kind === "required" && <span className="sr-only"> (required)</span>}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {match.missing.length > 0 && (
        <MissingKeywords
          missing={match.missing}
          picked={picked}
          onToggle={onToggle}
          onSet={onSet}
        />
      )}

      {/* Said before the click, not after: the run has no confirmation.
          Back and Tailor Resume are the step's top row (`TailorBar`) */}
      {(match.tailored_resume_id || error) && (
        <div className="border-border-subtle flex flex-col gap-2 border-t pt-4">
          {match.tailored_resume_id && (
            <p className="text-note text-ink-meta">
              This posting already has a tailored resume. Tailor Resume replaces it with a new run.
            </p>
          )}
          <TailorError error={error} />
        </div>
      )}
    </Card>
  );
}

/** "3 of 14 keywords matched" over a bar of the same share. */
function MatchSummary({ matched, total }: { matched: number; total: number }) {
  if (total === 0) {
    return <p className="text-body text-ink-muted mt-1">This posting names no keywords.</p>;
  }
  return (
    <div className="mt-2">
      <p className="text-body text-ink">
        <span className="font-semibold">
          {matched} of {total}
        </span>{" "}
        keywords matched
      </p>
      <div
        role="meter"
        aria-label="Keywords matched"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={matched}
        className="bg-brand-tint mt-2 h-2 overflow-hidden rounded-full"
      >
        {/* Drawn at full length and scaled from its left end
            (docs/motion.md: transforms, never a width). */}
        <div
          className="bg-brand h-full origin-left rounded-full"
          style={{ transform: `scaleX(${matched / total})` }}
        />
      </div>
    </div>
  );
}

/**
 * The run, over Choose Keywords: a modal card in the middle of the window
 * with a spinner and the run's phases as the stream reports them, the done
 * ones checked. Tailor was a step of its own until 2026-10-26, a view that
 * only waited, so the user had it folded into a loader. It cannot be
 * closed (Esc and a click outside do nothing: a run cannot be stopped); a
 * failed run closes it and shows its error on the card under it, and a
 * finished one opens the tailored resume (Review Changes).
 */
function TailorRunning({
  open,
  phase,
  resume,
  keywords,
}: {
  open: boolean;
  phase: Phase;
  resume: string | undefined;
  keywords: number;
}) {
  const at = PHASES.indexOf(phase);
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="gap-0 p-6 sm:max-w-sm">
        <span
          aria-hidden="true"
          className="border-brand-tint border-t-brand mx-auto size-10 animate-spin rounded-full border-[3px] motion-reduce:animate-none"
        />
        <DialogTitle className="text-subtitle text-ink mt-4 text-center font-semibold">
          Tailoring Your Resume
        </DialogTitle>
        <DialogDescription className="text-note text-ink-muted mt-1 text-center text-balance">
          {resume ? `Rewriting ${resume}` : "Rewriting your resume"}
          {keywords > 0 && ` with ${keywords === 1 ? "1 keyword" : `${keywords} keywords`}`}. It
          opens when it is done.
        </DialogDescription>
        <ol role="list" className="mt-5 flex flex-col gap-2.5 self-center">
          {PHASES.map((key, i) => {
            const done = i < at;
            const now = i === at;
            return (
              <li
                key={key}
                aria-current={now ? "step" : undefined}
                className="flex items-center gap-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    done && "border-brand bg-brand text-on-brand",
                    now && "border-brand bg-brand-tint",
                    !done && !now && "border-border-subtle",
                  )}
                >
                  {done && <CheckIcon className="size-3" />}
                  {now && <span className="bg-brand size-1.5 rounded-full" />}
                </span>
                <span
                  className={cn("text-label", done || now ? "text-ink" : "text-ink-meta")}
                  aria-live={now ? "polite" : undefined}
                >
                  {PHASE[key]}
                  {now && "…"}
                </span>
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

const toSource = (choice: Choice): TailorSource =>
  "builtResumeId" in choice.source
    ? { built_resume_id: choice.source.builtResumeId }
    : { uploaded_resume_id: choice.source.uploadedResumeId };

/**
 * The Keyword Match card's place while the match is read: what WorkIt is
 * doing, in one sentence, over the card's shape. The read has no phases to
 * report (one server action: the posting's keywords, extracted once and
 * cached, then the match), so it names the work, not a made-up stage. It
 * was "Reading…" on the button alone for the 15 to 20 seconds a first
 * extraction takes, with nothing on the page.
 */
function MatchWaiting() {
  return (
    <Card as="section" aria-busy="true" aria-labelledby="tailor-match-waiting">
      <h2 id="tailor-match-waiting" className="text-subtitle text-ink">
        Keyword Match
      </h2>
      <p className="text-note text-ink-muted mt-1" aria-live="polite">
        WorkIt is reading the posting&apos;s keywords and looking for each one in this resume. A
        posting read for the first time takes longer.
      </p>
      <Skeleton aria-hidden="true" className="mt-3 h-7 w-24" />
      <div aria-hidden="true" className="mt-3 flex flex-wrap gap-1.5">
        {[16, 20, 14, 24, 18, 12].map((w, i) => (
          <Skeleton key={i} className="h-6 rounded-md" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
    </Card>
  );
}

/**
 * The missing keywords the student picks to add (KAN-408): toggle chips,
 * required ones first under their own label, then the preferred, with a
 * running count. Picking one says the student has it: the run adds it to
 * this resume's skills, and the truth rule then lets a rewording name it
 * (`tailor.known`), so the note says so and Select All asks first, on its
 * own line, as Delete does on Resumes (`DeleteConfirm`). Select All and
 * Clear are small buttons: as a text link Add All read as an afterthought
 * (2026-10-26), and as one link that flipped to Clear All it changed under
 * the pointer.
 */
function MissingKeywords({
  missing,
  picked,
  onToggle,
  onSet,
}: {
  missing: Keyword[];
  picked: Set<string>;
  onToggle: (keyword: string) => void;
  onSet: (next: Set<string>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const count = missing.filter((k) => picked.has(k.keyword)).length;
  const groups = [
    { label: "Required", keywords: missing.filter((k) => k.kind === "required") },
    { label: "Preferred", keywords: missing.filter((k) => k.kind !== "required") },
  ].filter((group) => group.keywords.length > 0);

  return (
    <div className="border-border-subtle border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div>
          <h3 className="text-label text-ink">Add Missing Keywords</h3>
          <p className="text-note text-ink-meta" aria-live="polite">
            {count} of {missing.length} selected
          </p>
        </div>
        <div className="flex gap-2">
          {count > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onSet(new Set())}>
              Clear
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={confirming || count === missing.length}
            onClick={() => setConfirming(true)}
          >
            Select All
          </Button>
        </div>
      </div>
      <p className="text-note text-ink-muted mt-2">
        Pick only skills you have used. Each one joins this resume&apos;s skills, and WorkIt may
        name it in your bullets.
      </p>
      {confirming && (
        <div
          role="group"
          aria-label="Select all keywords"
          className="bg-brand-tint rounded-control mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2"
        >
          <span className="text-note text-ink">
            Select all {missing.length}? Only if you have used every one.
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSet(new Set(missing.map((k) => k.keyword)));
                setConfirming(false);
              }}
            >
              Select All {missing.length}
            </Button>
          </div>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="mt-4">
          <p className="text-note text-ink-meta">{group.label}</p>
          <ul role="list" aria-label={group.label} className="mt-2 flex flex-wrap gap-2">
            {group.keywords.map((k) => {
              const on = picked.has(k.keyword);
              return (
                <li key={k.keyword}>
                  <Chip pressed={on} onClick={() => onToggle(k.keyword)}>
                    {on ? <CheckIcon /> : <PlusIcon />}
                    {k.keyword}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TailorError({ error }: { error: { message: string; status: number | null } | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="text-note text-danger mt-2">
      <p>{error.message}</p>
      {error.status === 409 && error.message.toLowerCase().includes("bank") && (
        <ButtonLink href="/bank" size="sm" className="mt-2">
          Fill My Bank
        </ButtonLink>
      )}
    </div>
  );
}
