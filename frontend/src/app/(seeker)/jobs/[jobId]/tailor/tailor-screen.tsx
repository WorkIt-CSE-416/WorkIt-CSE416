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
import { Skeleton } from "@/components/shadcn/skeleton";
import { readEvents } from "@/components/scout/stream";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { ResumeItem } from "@/lib/resume-actions";
import { matchColor } from "@/lib/match";
import { markResumesStale } from "@/lib/resumes-stale";
import {
  matchTailor,
  type Keyword,
  type TailorMatch,
  type TailorRunResult,
  type TailorSource,
  type TailorStreamEvent,
} from "@/lib/tailor-actions";

import type { MatchShift, TailorReviewRecord } from "../../../resumes/[resumeId]/tailor-review";
import { loadChoices, ResumeLists, ResumeListsSkeleton, type Choice } from "../../resume-picker";
import { ResumePreviewDialog } from "./resume-preview";
import { BackToJobs } from "../page-actions";
import type { JobListing } from "../../listings";
import { TailorBar, TailorHeader } from "./tailor-header";
import { TailorRunning, type Phase } from "./tailor-running";
import { type TailorStep } from "./tailor-steps";

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
 * Each pick step's own title, under its top row, which asks for what the step
 * needs. Both steps read "Tailor Your Resume to {title}" over one line about
 * the whole flow until 2026-10-26. Each then had a line under its title, on
 * what WorkIt saves and what a run does; the user had both taken out on
 * 2026-11-01, since the step's own controls say enough.
 */
const HEADINGS = {
  pick: "Pick the Resume to Start From",
  keywords: "Add the Keywords You Have Used",
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
 * picking it. Next reads its keyword match and moves on. Choose
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

  /** Next: on to Choose Keywords, reading the match only for a
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
    // The run made or replaced the posting's tailored resume through a route
    // handler, which cannot clear the router's copies (lib/resumes-stale.ts)
    markResumesStale();
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
              Next <ArrowRightIcon />
            </Button>
          ) : (
            <Button size="sm" onClick={run} disabled={running || reading || !match}>
              <SparkleIcon /> Tailor Resume
            </Button>
          )
        }
      />
      <div className="mt-4">
        <TailorHeader job={job} title={HEADINGS[step]} />
      </div>
      <div className="mt-4">
        {step === "pick" && (
          <>
            <Card as="section" aria-label="Pick a Resume" className="flex min-w-0 flex-col gap-3">
              {choices == null ? (
                <ResumeListsSkeleton />
              ) : (
                <>
                  <ResumeLists
                    name="tailor-from"
                    choices={choices}
                    empty="None yet. Upload one, or generate one on Resumes."
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
                    // A page, not a dialog: the list runs to the page's foot
                    fill
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
            error={error}
          />
        )}
      </div>
      <TailorRunning open={running} phase={phase} resume={matchedChoice?.label} />
    </>
  );
}

/** The step's two columns at one height: what the student picks, and the
 *  match beside it. Below lg the match comes first, as one row, so the chips
 *  never sit under a tall panel. */
const COLUMNS = "flex flex-col gap-4 lg:flex-row";
const MATCH_PANEL = "flex shrink-0 flex-col gap-4 lg:w-72";
const PICK_CARD = "flex min-w-0 flex-1 flex-col gap-5 lg:order-first";

/**
 * Choose Keywords, in two columns at one height: the missing keywords to pick
 * (`MissingKeywords`) and, beside them, what the resume shows today
 * (`MatchPanel`). Back and Tailor Resume are the step's top row (`TailorBar`).
 *
 * **A pick never moves the score, and nothing picks in bulk.** A score that
 * rose with each pick, to 100% one click after Select All, paid the student for
 * claiming skills, and the claim is what the truth rule lets a rewording name
 * (2026-11-01). So the score counts what the resume proves, and each keyword
 * takes its own click.
 *
 * It was one card read top to bottom until 2026-11-01, in which the card and
 * the step title both named the step: "Keyword Match" over "3 of 14 keywords
 * matched" and a bar, then "Add Missing Keywords" over "0 of 6 selected", two
 * counts and three headings for one job, which the user found poorly designed.
 * Before that, a big "3 of 14", the matched tags in brand for the required
 * ones, a checkbox drawn in every missing chip and Add All as a text link,
 * which the user found overloaded (2026-10-26).
 */
function KeywordCard({
  match,
  resume,
  picked,
  onToggle,
  error,
}: {
  match: TailorMatch;
  resume: string | undefined;
  picked: Set<string>;
  onToggle: (keyword: string) => void;
  error: { message: string; status: number | null } | null;
}) {
  const total = match.matched.length + match.missing.length;
  return (
    <div className={COLUMNS}>
      {total > 0 && (
        <MatchPanel total={total} resume={resume} matched={match.matched} weak={match.weak_match} />
      )}
      <Card as="section" aria-label="Missing Keywords" padding="lg" className={PICK_CARD}>
        {match.missing.length > 0 ? (
          <MissingKeywords
            missing={match.missing}
            shown={match.in_experiences ?? []}
            picked={picked}
            onToggle={onToggle}
          />
        ) : (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="bg-positive-tint text-positive-ink flex size-10 items-center justify-center rounded-full">
              <CheckIcon aria-hidden className="size-5" />
            </span>
            <h2 className="text-subtitle text-ink mt-3">
              {total > 0 ? "Every Keyword Is on This Resume" : "This Posting Names No Keywords"}
            </h2>
            <p className="text-body text-ink-meta mt-1">
              Tailor Resume still rewords your bullets for this job.
            </p>
          </div>
        )}

        {/* Said before the click, not after: the run has no confirmation. */}
        {(match.tailored_resume_id || error) && (
          <div className="border-border-subtle flex flex-col gap-2 border-t pt-4">
            {match.tailored_resume_id && (
              <p className="text-note text-ink-meta">
                This posting already has a tailored resume. Tailor Resume replaces it with a new
                run.
              </p>
            )}
            <TailorError error={error} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* 128px box, 10px stroke, so the arc's centreline sits 5px inside the edge. */
const RING_RADIUS = (128 - 10) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * How much of the posting the resume shows today: the ring, in the same colour
 * bands as a job's match score (`matchColor`), so it reads as a match and not
 * as the Applied stage's violet. It draws itself on arrival and then stands
 * still: a pick is a claim, not proof (`KeywordCard`). Under it, what is
 * already on the resume, quiet, since those need nothing from the student.
 */
function MatchPanel({
  total,
  resume,
  matched,
  weak,
}: {
  total: number;
  resume: string | undefined;
  matched: Keyword[];
  weak: boolean;
}) {
  const share = Math.round((matched.length / total) * 100);
  return (
    <Card as="section" aria-label="Keyword Match" padding="lg" className={MATCH_PANEL}>
      <div className="flex items-center gap-4 lg:flex-col lg:gap-3 lg:text-center">
        <div
          role="meter"
          aria-label="Keywords matched"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={matched.length}
          className="relative size-24 shrink-0 lg:size-32"
        >
          {/* -rotate-90 starts the arc at twelve o'clock rather than three. */}
          <svg viewBox="0 0 128 128" aria-hidden="true" className="size-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="10"
              className="stroke-border-subtle"
            />
            <circle
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="10"
              // A round cap on an empty arc would draw a dot at twelve o'clock
              strokeLinecap={share > 0 ? "round" : "butt"}
              strokeDasharray={`${(RING_LENGTH * share) / 100} ${RING_LENGTH}`}
              style={{ stroke: matchColor(share) }}
              className="animate-ring-fill"
            />
          </svg>
          <p aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <span className="flex items-baseline">
              <span className="text-display lg:text-figure text-ink">{share}</span>
              <span className="text-body text-ink-meta">%</span>
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <h2 className="text-subtitle text-ink">Keyword Match</h2>
          <p className="text-note text-ink-muted mt-0.5">
            {matched.length} of {total} keywords
          </p>
          {resume && <p className="text-note text-ink-meta truncate">{resume}</p>}
        </div>
      </div>
      {weak && (
        <p role="note" className="text-note text-ink-muted">
          Weak match: this posting has no description, so WorkIt read only its title.
        </p>
      )}
      {matched.length > 0 && (
        <div className="border-border-subtle border-t pt-4">
          <h3 className="text-note text-ink-meta">Already on Your Resume</h3>
          <ul role="list" className="mt-2 flex flex-wrap gap-1.5">
            {matched.map((k) => (
              <li key={k.keyword}>
                <Badge variant="tag" tone="neutral">
                  {k.keyword}
                  {k.kind === "required" && <span className="sr-only"> (required)</span>}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const toSource = (choice: Choice): TailorSource =>
  "builtResumeId" in choice.source
    ? { built_resume_id: choice.source.builtResumeId }
    : { uploaded_resume_id: choice.source.uploadedResumeId };

/**
 * Choose Keywords while the match is read: the step's own two columns, with
 * what WorkIt is doing in one sentence where the note will be. The read has no
 * phases to report (one server action: the posting's keywords, extracted once
 * and cached, then the match), so it names the work, not a made-up stage. It
 * was "Reading..." on the button alone for the 15 to 20 seconds a first
 * extraction takes, with nothing on the page.
 */
function MatchWaiting() {
  return (
    <div aria-busy="true" className={COLUMNS}>
      <Card as="section" aria-hidden="true" padding="lg" className={MATCH_PANEL}>
        <div className="flex items-center gap-4 lg:flex-col lg:gap-3">
          <Skeleton className="size-24 shrink-0 rounded-full lg:size-32" />
          <div className="flex flex-col gap-1.5 lg:items-center">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </Card>
      <Card as="section" aria-label="Missing Keywords" padding="lg" className={PICK_CARD}>
        <p className="text-body text-ink-muted" aria-live="polite">
          Checking this job&apos;s keywords against your resume. A posting read for the first time
          takes longer.
        </p>
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {[32, 26, 36, 28, 40, 30].map((w, i) => (
            <Skeleton key={i} className="h-10.5 rounded-full" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * The missing keywords the student picks to add (KAN-408): toggle chips at
 * the large size, since here the chips are the question (`Chip`), required
 * ones first under their own label, then the preferred. Picking one says the
 * student has it: the run adds it to this resume's skills, and the truth rule
 * then lets a rewording name it (`tailor.known`), so the note says so, and says
 * what a false claim costs. Select All and Clear stood here until 2026-11-01:
 * asking first did not stop a student taking the one click to a higher score
 * (`KeywordCard`).
 */
/**
 * The missing keywords to pick, in groups. **In Your Experiences comes first**
 * (KAN-587, 2026-11-05): keywords the student's Experiences already show
 * (an entry, a bullet or a skill), though this resume leaves them out, so a
 * pick there claims nothing new. The rest follow as Required, then Preferred.
 * KAN-587 asked for an Add All button back; the user chose to show which
 * skills the student has instead, so every keyword still takes its own click
 * ("nothing picks in bulk", above). A required keyword in the first group
 * comes first there and carries a visible "Required" tag: KAN-408 found a
 * "(required)" that only a screen reader heard.
 */
function MissingKeywords({
  missing,
  shown,
  picked,
  onToggle,
}: {
  missing: Keyword[];
  /** The missing keywords the student's Experiences show (`in_experiences`). */
  shown: string[];
  picked: Set<string>;
  onToggle: (keyword: string) => void;
}) {
  const had = new Set(shown);
  const rest = missing.filter((k) => !had.has(k.keyword));
  const groups = [
    {
      label: "In Your Experiences",
      note: "You've shown these in your Experiences, but this resume leaves them out.",
      keywords: missing.filter((k) => had.has(k.keyword)),
    },
    { label: "Required", keywords: rest.filter((k) => k.kind === "required") },
    { label: "Preferred", keywords: rest.filter((k) => k.kind !== "required") },
  ].filter((group) => group.keywords.length > 0);

  return (
    <>
      <p className="text-body text-ink-muted">
        Pick only skills you have used. WorkIt adds them to this resume and may name them in your
        bullets, and an interviewer can ask about each one.
      </p>
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-label text-ink">{group.label}</h3>
          {group.note && <p className="text-note text-ink-meta mt-1">{group.note}</p>}
          <ul role="list" aria-label={group.label} className="mt-2.5 flex flex-wrap gap-2">
            {group.keywords.map((k, i) => {
              const on = picked.has(k.keyword);
              return (
                <li
                  key={k.keyword}
                  className="animate-rise"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <Chip size="lg" pressed={on} onClick={() => onToggle(k.keyword)}>
                    {on ? <CheckIcon className="animate-pop" /> : <PlusIcon />}
                    {k.keyword}
                    {group.note && k.kind === "required" && (
                      <span className="text-meta text-ink-meta font-normal">Required</span>
                    )}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

function TailorError({ error }: { error: { message: string; status: number | null } | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="text-note text-danger mt-2">
      <p>{error.message}</p>
      {error.status === 409 && error.message.toLowerCase().includes("bank") && (
        <ButtonLink href="/experiences" size="sm" className="mt-2">
          Fill My Bank
        </ButtonLink>
      )}
    </div>
  );
}
