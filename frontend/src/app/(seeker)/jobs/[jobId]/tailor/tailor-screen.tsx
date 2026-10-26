"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CheckIcon, SparkleIcon } from "@/components/icons";
import { readEvents } from "@/components/scout/stream";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
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

import { loadChoices, ResumeLists, type Choice } from "../../resume-picker";

/** What Tailor Resume says while a run waits, by the streamed run's lines
 *  (`TailorStreamEvent`): Retrieving Info until the API sends `asking`, and
 *  Compiling Resume once `done` has come and the editor loads. */
const PHASE = {
  retrieving: "Retrieving Info…",
  asking: "Asking AI…",
  generating: "Generating Resume…",
  compiling: "Compiling Resume…",
} as const;

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
 * The Tailor screen (KAN-217, docs/tailor_resume.md). The student picks a
 * generated or uploaded resume, or uploads one with the Resumes page's rules
 * (../../resume-picker, KAN-318); WorkIt reads its keyword match, and the
 * student picks which missing keywords to add as skills. Tailor Resume runs
 * once and saves the posting's one tailored resume with no confirmation,
 * then opens its editor on this route. The run's record of changes goes to
 * sessionStorage (`tailorEditsKey`) for the editor; nothing else keeps it.
 */
export function TailorScreen({ jobId, title }: { jobId: string; title: string }) {
  const router = useRouter();
  const [source, setSource] = useState<TailorSource | null>(null);
  const [match, setMatch] = useState<TailorMatch | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>(PHASE.retrieving);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [uploads, setUploads] = useState<ResumeItem[]>([]);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const onUploadBusy = useCallback((busy: boolean) => setUploading(busy), []);
  const refreshChoices = useCallback(async (): Promise<Choice[]> => {
    const result = await loadChoices(jobId);
    setChoices(result.choices);
    setUploads(result.uploads);
    setChoiceError(result.error);
    setSource(null);
    setMatch(null);
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

  async function read(next: TailorSource) {
    setReading(true);
    setError(null);
    const { data, error, status } = await matchTailor(jobId, next);
    setReading(false);
    if (!data) return setError({ message: error ?? "WorkIt couldn't read that resume.", status });
    if (data.tailored_resume_id) {
      return router.push(
        `/jobs/${encodeURIComponent(jobId)}/tailor?resumeId=${encodeURIComponent(data.tailored_resume_id)}`,
      );
    }
    setSource(next);
    setMatch(data);
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
    setPhase(PHASE.retrieving);
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
        if (event.type === "phase") setPhase(PHASE[event.phase]);
        else if (event.type === "error") return failed(event.message, event.status);
        else result = event.result;
      }
    } catch {
      return failed("Tailor couldn't reach WorkIt. Try again in a minute.", null);
    }
    // A stream that ends with no last line lost its connection mid-run.
    if (!result) return failed("Tailor stopped before it finished. Try again.", null);
    setPhase(PHASE.compiling);
    writeSessionDraft(tailorEditsKey(result.resume.id), { edits: result.edits });
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
    <div className="mt-4 flex flex-col gap-4">
      <Card as="section">
        <h2 className="text-subtitle text-ink">Tailor Your Resume to {title}</h2>
        <p className="text-body text-ink-muted mt-1">
          Pick a resume, then the keywords you want on it. WorkIt rewrites its bullets for this
          posting and opens the result in the editor, where you can undo any change. WorkIt never
          adds a number or tool you did not give.
        </p>
        <div className="mt-3 flex flex-col gap-3">
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
                  setSource(null);
                  setMatch(null);
                  setError(null);
                }}
                upload={{ uploads, onUploaded: uploaded, onBusyChange: onUploadBusy }}
              />
              <Button
                className="self-start"
                onClick={() => {
                  const choice = choices.find((item) => item.key === selected);
                  if (choice) void read(toSource(choice));
                }}
                disabled={!selected || reading || running || uploading}
              >
                <SparkleIcon />{" "}
                {reading ? "Reading…" : match ? "Use Another Resume" : "Use This Resume"}
              </Button>
            </>
          )}
          {choiceError && (
            <p role="alert" className="text-note text-danger">
              {choiceError}
            </p>
          )}
        </div>
        {/* KAN-319: the Tailor limit is lifted for now, so the cost is hidden.
        <p className="text-note text-ink-meta mt-2">
          Each run uses one of today&apos;s 2 Tailor runs.
        </p>
        */}
        {!match && <TailorError error={error} />}
      </Card>

      {match && (
        <Card as="section" aria-labelledby="tailor-match">
          <h2 id="tailor-match" className="text-subtitle text-ink">
            Keyword Match
          </h2>
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
          <Button className="mt-4" onClick={run} disabled={running}>
            <SparkleIcon /> <span aria-live="polite">{running ? phase : "Tailor Resume"}</span>
          </Button>
          <TailorError error={error} />
        </Card>
      )}
    </div>
  );
}

const toSource = (choice: Choice): TailorSource =>
  "builtResumeId" in choice.source
    ? { built_resume_id: choice.source.builtResumeId }
    : { uploaded_resume_id: choice.source.uploadedResumeId };

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
