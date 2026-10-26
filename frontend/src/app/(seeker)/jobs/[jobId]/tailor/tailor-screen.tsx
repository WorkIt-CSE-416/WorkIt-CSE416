"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, SparkleIcon } from "@/components/icons";
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
import { TailorSteps, type TailorStep } from "./tailor-steps";

/** The run's phases, in order, as the Tailor step lists them, by the
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

/** Tailor's first pick: the resume tailored to this posting, else the
 *  primary unless it is tailored to another posting, else the first one
 *  not tailored to any. A resume tailored to another posting is the
 *  picker's primary (KAN-268), but tailoring it again starts from another
 *  job's changes, so it is never picked for the student. */
function tailorFirst(choices: Choice[]): Choice | undefined {
  return (
    choices.find((c) => c.forThisJob) ??
    choices.find((c) => c.isDefault && c.type !== "Tailored") ??
    choices.find((c) => c.type !== "Tailored") ??
    choices[0]
  );
}

/**
 * The Tailor screen (KAN-217, docs/tailor_resume.md), one step at a time
 * under the step timeline (`TailorSteps`): Pick a Resume, Choose Keywords,
 * then Tailor, each its own view. The keyword match sat under the picker on
 * one page until 2026-10-26, so the student scrolled past the list to read
 * it. The step lives in this component, not the URL: a reload starts again
 * at the pick, which reads nothing the student would lose.
 *
 * Pick a Resume: the student picks a generated or uploaded resume, or
 * uploads one with the Resumes page's rules (../../resume-picker, KAN-318);
 * a card's Preview opens it in a dialog (./resume-preview.tsx) without
 * picking it. Use This Resume reads its keyword match and moves on.
 * Choose Keywords: the match, and the missing keywords to add as skills.
 * Back keeps the picks: the same resume picked again keeps its match and
 * its keywords, read once. Tailor Resume runs once and saves the posting's
 * one tailored resume with no confirmation; the Tailor step shows the run's
 * phases, then the tailored resume's editor opens on this route (Review
 * Changes, ./page.tsx). The run's record of changes goes to sessionStorage
 * (`tailorEditsKey`) for the editor; nothing else keeps it.
 */
export function TailorScreen({ jobId }: { jobId: string }) {
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
      setSelected(tailorFirst(result.choices)?.key ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

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
    if (data.tailored_resume_id) {
      return router.push(
        `/jobs/${encodeURIComponent(jobId)}/tailor?resumeId=${encodeURIComponent(data.tailored_resume_id)}`,
      );
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
    setStep("tailor");
    const failed = (message: string, status: number | null) => {
      setRunning(false);
      setStep("keywords");
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
      <TailorSteps current={step} />
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
                  <Button
                    className="self-start"
                    onClick={() => pickedChoice && void next(pickedChoice)}
                    disabled={!pickedChoice || reading || uploading}
                  >
                    Use This Resume <ArrowRightIcon />
                  </Button>
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
          <Card as="section" aria-labelledby="tailor-match">
            <h2 id="tailor-match" className="text-subtitle text-ink">
              Keyword Match
            </h2>
            {matchedChoice && (
              <p className="text-note text-ink-meta mt-1">For {matchedChoice.label}</p>
            )}
            {match.weak_match && (
              <p role="note" className="text-note text-ink-muted mt-1">
                Weak match: this posting has no description, so WorkIt read only its title.
              </p>
            )}
            <div className="mt-2">
              <MatchCount matched={match.matched} missing={match.missing} />
            </div>
            <KeywordList label="Matched" keywords={match.matched} />
            {match.missing.length > 0 && (
              <MissingKeywords
                missing={match.missing}
                picked={picked}
                onToggle={toggle}
                onSet={setPicked}
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setStep("pick");
                }}
              >
                <ArrowLeftIcon /> Back
              </Button>
              <Button onClick={run} disabled={running}>
                <SparkleIcon /> Tailor Resume
              </Button>
            </div>
            <TailorError error={error} />
          </Card>
        )}

        {step === "tailor" && (
          <TailorProgress phase={phase} resume={matchedChoice?.label} keywords={picked.size} />
        )}
      </div>
    </>
  );
}

/**
 * The Tailor step: the run's phases as the stream reports them, the done
 * ones checked and the current one live (`aria-live`). Each was the label
 * of the Tailor Resume button alone until the step views (2026-10-26). The
 * run cannot be stopped, so the step has no Back; a failed run goes back
 * to Choose Keywords with its error.
 */
function TailorProgress({
  phase,
  resume,
  keywords,
}: {
  phase: Phase;
  resume: string | undefined;
  keywords: number;
}) {
  const at = PHASES.indexOf(phase);
  return (
    <Card as="section" aria-busy="true" aria-labelledby="tailor-progress">
      <h2 id="tailor-progress" className="text-subtitle text-ink">
        Tailoring Your Resume
      </h2>
      <p className="text-note text-ink-muted mt-1">
        {resume
          ? `WorkIt is rewriting ${resume} for this posting`
          : "WorkIt is rewriting your resume for this posting"}
        {keywords > 0 &&
          `, adding the ${keywords === 1 ? "keyword" : `${keywords} keywords`} you picked`}
        . Your tailored resume opens when it is done.
      </p>
      <ol role="list" className="mt-4 flex flex-col gap-3">
        {PHASES.map((key, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li
              key={key}
              aria-current={now ? "step" : undefined}
              className="flex items-center gap-3"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  done && "border-brand bg-brand text-on-brand",
                  now && "border-brand bg-brand-tint",
                  !done && !now && "border-border-subtle",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" />
                ) : now ? (
                  <span className="bg-brand size-2 animate-pulse rounded-full motion-reduce:animate-none" />
                ) : null}
              </span>
              <span
                className={cn("text-label", now ? "text-ink" : "text-ink-meta")}
                aria-live={now ? "polite" : undefined}
              >
                {PHASE[key]}
                {now && "…"}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
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
 * The missing keywords the student picks to add (KAN-408): required ones
 * first, under their own label, then the preferred. Picking one says the
 * student has it: the run adds it to this resume's skills, and the truth
 * rule then lets a rewording name it (`tailor.known`), so the note says so
 * and Add All asks first, on its own line, as Delete does on Resumes
 * (`DeleteConfirm`). Its label follows the picks: Clear All once every
 * keyword is picked. "(required)" was for screen readers only, and Add All
 * ticked every keyword at once, then read "Added All" even after one was
 * unticked.
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
  const all = missing.every((k) => picked.has(k.keyword));
  const groups = [
    { label: "Required", keywords: missing.filter((k) => k.kind === "required") },
    { label: "Preferred", keywords: missing.filter((k) => k.kind !== "required") },
  ].filter((group) => group.keywords.length > 0);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-label text-ink">Missing: Choose Which Skills to Add</p>
        <Button
          variant="link"
          size="inline"
          disabled={confirming}
          onClick={() => (all ? onSet(new Set()) : setConfirming(true))}
        >
          {all ? "Clear All" : "Add All"}
        </Button>
      </div>
      <p className="text-note text-ink-muted mt-1">
        Pick only skills you have used. WorkIt adds each one to this resume&apos;s skills, and its
        rewrites may name it in your bullets.
      </p>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-note text-ink-muted">
            Add all {missing.length}? Do this only if you have used every one.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSet(new Set(missing.map((k) => k.keyword)));
                setConfirming(false);
              }}
            >
              Add All {missing.length}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="mt-3">
          <p className="text-note text-ink-meta">{group.label}</p>
          <ul role="list" aria-label={group.label} className="mt-1 flex flex-wrap gap-2">
            {group.keywords.map((k) => (
              <li key={k.keyword}>
                <Chip
                  pressed={picked.has(k.keyword)}
                  onClick={() => onToggle(k.keyword)}
                  className="gap-2"
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
                      picked.has(k.keyword)
                        ? "border-brand bg-brand text-on-brand"
                        : "border-ink-meta bg-panel text-transparent"
                    }`}
                  >
                    <CheckIcon className="size-3" />
                  </span>
                  {k.keyword}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MatchCount({ matched, missing }: { matched: Keyword[]; missing: Keyword[] }) {
  const total = matched.length + missing.length;
  return (
    <p className="text-title text-ink font-medium">
      {total === 0 ? "No keywords" : `${matched.length} of ${total}`}
    </p>
  );
}

function KeywordList({ label, keywords }: { label: string; keywords: Keyword[] }) {
  if (keywords.length === 0) return null;
  // Required keywords come first (the API sorts them so).
  return (
    <div className="mt-2">
      <p className="text-note text-ink-meta">{label}</p>
      <ul role="list" className="mt-1 flex flex-wrap gap-1.5">
        {keywords.map((k) => (
          <li key={k.keyword}>
            <Badge variant="tag" tone={k.kind === "required" ? "brand" : "neutral"}>
              {k.keyword}
              {k.kind === "required" && <span className="sr-only"> (required)</span>}
            </Badge>
          </li>
        ))}
      </ul>
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
