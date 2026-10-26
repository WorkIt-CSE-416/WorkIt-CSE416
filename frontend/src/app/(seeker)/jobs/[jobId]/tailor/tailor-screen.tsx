"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { CheckIcon, SparkleIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { SelectField } from "@/components/ui/select-field";
import { tailorEditsKey, writeSessionDraft } from "@/lib/local-drafts";
import type { ResumeItem } from "@/lib/resume-actions";
import {
  matchTailor,
  runTailor,
  type Keyword,
  type TailorMatch,
  type TailorSource,
} from "@/lib/tailor-actions";

import {
  firstChoice,
  loadChoices,
  UploadPick,
  type Choice,
} from "../../resume-picker";

/**
 * The Tailor screen (KAN-217, docs/tailor_resume.md). The student picks a
 * generated or uploaded resume, or uploads one with the Resumes page's rules
 * (../../resume-picker, KAN-318); WorkIt reads its keyword match, and the
 * student picks which missing keywords to add as skills. Tailor Resume runs
 * once and saves the posting's one tailored resume with no confirmation,
 * then opens its editor on this route. The run's record of changes goes to
 * sessionStorage (`tailorEditsKey`) for the editor; nothing else keeps it.
 */
export function TailorScreen({
  jobId,
  title,
}: {
  jobId: string;
  title: string;
}) {
  const router = useRouter();
  const [source, setSource] = useState<TailorSource | null>(null);
  const [match, setMatch] = useState<TailorMatch | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
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
    setSelected(firstChoice(result.choices)?.key ?? null);
    return result.choices;
  }, [jobId]);

  useEffect(() => {
    void refreshChoices();
  }, [refreshChoices]);

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
    const { data, error, status } = await runTailor(jobId, source, [...picked]);
    if (!data) {
      setRunning(false);
      return setError({ message: error ?? "Tailor failed.", status });
    }
    writeSessionDraft(tailorEditsKey(data.resume.id), { edits: data.edits, dropped: data.dropped });
    router.push(
      `/jobs/${encodeURIComponent(jobId)}/tailor?resumeId=${encodeURIComponent(data.resume.id)}`,
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
              <SelectField
                id="tailor-resume"
                label="Pick a Resume"
                value={selected ?? ""}
                onValueChange={(key) => {
                  setSelected(key);
                  setSource(null);
                  setMatch(null);
                  setError(null);
                }}
                placeholder="Choose a resume"
                options={choices.map((choice) => ({
                  value: choice.key,
                  label: `${choice.label} · ${choice.type}${
                    choice.tailoredFor ? ` · ${choice.tailoredFor}` : ""
                  }`,
                }))}
                className="max-w-2xl"
              />
              {choices.length === 0 && (
                <p className="text-note text-ink-meta">
                  No resumes yet. Generate one below or upload a resume.
                </p>
              )}
              <UploadPick
                label="Upload a Resume"
                uploads={uploads}
                onUploaded={uploaded}
                onBusyChange={onUploadBusy}
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
            <div className="mt-3">
              <p className="text-note text-ink-meta">Missing: choose which skills to add</p>
              <ul role="list" className="mt-2 flex flex-wrap gap-2">
                {match.missing.map((k) => (
                  <li key={k.keyword}>
                    <Chip
                      pressed={picked.has(k.keyword)}
                      onClick={() => toggle(k.keyword)}
                      className="gap-2 rounded-control"
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
                      {k.kind === "required" && <span className="sr-only"> (required)</span>}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button className="mt-4" onClick={run} disabled={running}>
            <SparkleIcon /> {running ? "Tailoring…" : "Tailor Resume"}
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
