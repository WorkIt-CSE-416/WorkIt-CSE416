"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { SparkleIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
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
  ResumeLists,
  UploadPick,
  type Choice,
} from "../../resume-picker";

/**
 * The Tailor screen (KAN-217, docs/tailor_resume.md). The student picks a
 * generated or uploaded resume, or uploads one with the Resumes page's rules
 * (../../resume-picker, KAN-318); WorkIt reads its keyword match, and the
 * student picks which missing keywords to add as skills. Tailor Resume runs
 * once and saves the posting's one tailored resume with no confirmation,
 * then opens it in the editor, which marks each change and can revert it
 * until Save. The run's record of changes goes to sessionStorage
 * (`tailorEditsKey`) for the editor; nothing else keeps it.
 *
 * A posting has one tailored resume, made once: when it has one, the screen
 * opens it instead of running, and the API refuses a second run (409).
 */
export function TailorScreen({
  jobId,
  title,
  tailored,
}: {
  jobId: string;
  title: string;
  tailored: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [source, setSource] = useState<TailorSource | null>(null);
  const [match, setMatch] = useState<TailorMatch | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);

  if (tailored) {
    return (
      <Card as="section" className="mt-4">
        <h2 className="text-subtitle text-ink">You Tailored a Resume for {title}</h2>
        <p className="text-body text-ink-muted mt-1">
          {tailored.name} is this posting&apos;s tailored resume. Change it in the editor; WorkIt
          tailors each posting once.
        </p>
        <ButtonLink href={`/resumes/${encodeURIComponent(tailored.id)}`} size="sm" className="mt-3">
          Open in Editor
        </ButtonLink>
      </Card>
    );
  }

  async function read(next: TailorSource) {
    setReading(true);
    setError(null);
    const { data, error, status } = await matchTailor(jobId, next);
    setReading(false);
    if (!data) return setError({ message: error ?? "WorkIt couldn't read that resume.", status });
    if (data.tailored_resume_id) return router.push(`/resumes/${data.tailored_resume_id}`);
    setSource(next);
    setMatch(data);
    setPicked(new Set());
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
    router.push(`/resumes/${encodeURIComponent(data.resume.id)}`);
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
        <PickResume
          jobId={jobId}
          title={title}
          label={match ? "Pick Another Resume" : "Pick a Resume"}
          running={reading || running}
          onRun={read}
        />
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
              <p className="text-note text-ink-meta">Missing: Pick the Ones to Add as Skills</p>
              <p className="text-note text-ink-muted">
                Pick only what you have used. WorkIt adds each to this resume&apos;s skills and may
                name it in a bullet.
              </p>
              <ul role="list" className="mt-2 flex flex-wrap gap-1.5">
                {match.missing.map((k) => (
                  <li key={k.keyword}>
                    <Chip pressed={picked.has(k.keyword)} onClick={() => toggle(k.keyword)}>
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

/**
 * Tailor My Resume and its dialog, Pick a Resume to Tailor: the job
 * posting's resumes as "Did You Apply?" lists them, starting on the one
 * tailored to this job, else the default. Its Tailor My Resume closes the
 * dialog and reads its keyword match; the card shows "Reading…" and any
 * error.
 */
function PickResume({
  jobId,
  title,
  label,
  running,
  onRun,
}: {
  jobId: string;
  title: string;
  label: string;
  running: boolean;
  onRun: (source: TailorSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [uploads, setUploads] = useState<ResumeItem[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const onUploadBusy = useCallback((busy: boolean) => setUploading(busy), []);

  /** Reads the list without blanking it, so an upload keeps its place. */
  async function refresh(): Promise<Choice[]> {
    const { choices, uploads, error } = await loadChoices(jobId);
    setChoices(choices);
    setUploads(uploads);
    setError(error);
    return choices;
  }

  async function openPicker() {
    setOpen(true);
    setChoices(null);
    setPicked(firstChoice(await refresh())?.key ?? null);
  }

  async function uploaded(id: string) {
    await refresh();
    setPicked(`uploaded:${id}`);
  }

  const choice = choices?.find((c) => c.key === picked);

  return (
    <>
      <Button className="mt-3" onClick={openPicker} disabled={running}>
        <SparkleIcon /> {running ? "Reading…" : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* As wide as "Did You Apply?", for the same resume table. */}
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-subtitle font-semibold">
              Pick a Resume to Tailor
            </DialogTitle>
            <DialogDescription>
              WorkIt tailors it to {title} and saves the result as a new resume; this one stays as
              it is. An uploaded resume is read into your experience bank first.
            </DialogDescription>
          </DialogHeader>
          {choices == null ? (
            <p className="text-note text-ink-muted">Loading your resumes…</p>
          ) : (
            <>
              <ResumeLists
                name="tailor-from"
                choices={choices}
                emptyBuilt="None yet. Generate Resume on Resumes & Experiences makes one."
                emptyUploaded="None yet. Upload one below."
                picked={picked}
                onPick={setPicked}
              />
              <UploadPick
                label="Tailor a Different Resume?"
                uploads={uploads}
                onUploaded={uploaded}
                onBusyChange={onUploadBusy}
              />
            </>
          )}
          {error && <p className="text-meta text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!choice) return;
                setOpen(false);
                onRun(toSource(choice));
              }}
              disabled={choice == null || uploading}
            >
              Use This Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
