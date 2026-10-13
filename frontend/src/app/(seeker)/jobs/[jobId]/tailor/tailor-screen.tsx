"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addSkill, getBank, linkSkill, type BankEntry } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";
import {
  finishTailor,
  runTailor,
  type Keyword,
  type TailorChange,
  type TailorProposal,
  type TailorResult,
} from "@/lib/tailor-actions";

/**
 * The Tailor screen (KAN-217). Run spends one of today's Tailor runs and
 * proposes changes; the student accepts or rejects each, answers "Have you
 * used X?" for missing keywords, and Done saves the accepted ones on the
 * posting's one tailored resume. Nothing is saved before Done, except a
 * skill added by answering Yes (it goes into the bank, which is the point).
 *
 * The keyword match ("12 of 18") is the API's for the starting resume; the
 * "after" count adds each accepted change's keywords and each Yes, with no
 * AI call. Done's response is the saved resume's own match.
 */

type Decision = "accepted" | "rejected";

export function TailorScreen({
  jobId,
  title,
  tailoredName,
}: {
  jobId: string;
  title: string;
  tailoredName: string | null;
}) {
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<TailorProposal | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  // Skills added by answering Yes, as accepted show_skill changes.
  const [added, setAdded] = useState<TailorChange[]>([]);
  const [answered, setAnswered] = useState<Record<string, "yes" | "no">>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    const { data, error, status } = await runTailor(jobId);
    setRunning(false);
    if (!data) return setError({ message: error ?? "Tailor failed.", status });
    setProposal(data);
    setDecisions({});
    setAdded([]);
    setAnswered({});
    setResult(null);
  }

  async function done() {
    if (!proposal) return;
    setSaving(true);
    setError(null);
    const accepted = [...proposal.changes.filter((_, i) => decisions[i] === "accepted"), ...added];
    const { data, error, status } = await finishTailor(jobId, proposal.source_resume_id, accepted);
    setSaving(false);
    if (!data) return setError({ message: error ?? "Saving failed.", status });
    setResult(data);
  }

  if (result) {
    return (
      <Card as="section" className="mt-4">
        <h2 className="text-subtitle text-ink">Saved: {result.resume.name}</h2>
        <MatchCount matched={result.matched} missing={result.missing} />
        <p className="text-body text-ink-muted mt-2">
          Your tailored resume is with your base resumes on the Experience Bank page. Download it
          there as a PDF or a Word file.
        </p>
        <div className="mt-3 flex gap-3">
          <ButtonLink href="/bank" size="sm">
            Go to My Resumes
          </ButtonLink>
          <ButtonLink href={`/jobs/${encodeURIComponent(jobId)}`} variant="secondary" size="sm">
            Back to the Job
          </ButtonLink>
        </div>
      </Card>
    );
  }

  if (!proposal) {
    return (
      <Card as="section" className="mt-4">
        <h2 className="text-subtitle text-ink">Tailor your resume to {title}</h2>
        <p className="text-body text-ink-muted mt-1">
          WorkIt compares your resume with this posting and proposes changes. You approve each one.
          WorkIt never adds a fact you did not give: when a keyword is missing, it asks you.
        </p>
        {tailoredName && (
          <p className="text-note text-ink-meta mt-2">
            You already have a tailored resume for this posting ({tailoredName}). A new run starts
            from it.
          </p>
        )}
        <Button className="mt-3" onClick={run} disabled={running}>
          <Sparkles /> {running ? "Tailoring…" : "Tailor My Resume"}
        </Button>
        <p className="text-note text-ink-meta mt-2">
          Each run uses one of today&apos;s 2 Tailor runs.
        </p>
        <TailorError error={error} />
      </Card>
    );
  }

  const decide = (i: number, d: Decision) => setDecisions((all) => ({ ...all, [i]: d }));
  const acceptAll = () =>
    setDecisions(Object.fromEntries(proposal.changes.map((_, i) => [i, "accepted" as const])));
  const gained = new Set([
    ...proposal.changes.flatMap((c, i) => (decisions[i] === "accepted" ? c.keywords : [])),
    ...added.flatMap((c) => c.keywords),
  ]);
  const after = proposal.missing.filter((k) => gained.has(k.keyword));

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card as="section" aria-labelledby="tailor-match">
        <h2 id="tailor-match" className="text-subtitle text-ink">
          Keyword Match
        </h2>
        {proposal.weak_match && (
          <p role="note" className="text-note text-ink-muted mt-1">
            Weak match: this posting has no description, so WorkIt read only its title.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-6">
          <div>
            <p className="text-note text-ink-meta">Before</p>
            <MatchCount matched={proposal.matched} missing={proposal.missing} />
          </div>
          <div>
            <p className="text-note text-ink-meta">With What You Accept</p>
            <MatchCount
              matched={[...proposal.matched, ...after]}
              missing={proposal.missing.filter((k) => !gained.has(k.keyword))}
            />
          </div>
        </div>
        <KeywordList label="Matched" keywords={[...proposal.matched, ...after]} />
        <KeywordList
          label="Missing"
          keywords={proposal.missing.filter((k) => !gained.has(k.keyword))}
        />
        <p className="text-note text-ink-meta mt-2">
          {proposal.uses_left} Tailor {proposal.uses_left === 1 ? "run" : "runs"} left today.
        </p>
      </Card>

      {proposal.questions.length > 0 && (
        <Card as="section" aria-labelledby="tailor-questions">
          <h2 id="tailor-questions" className="text-subtitle text-ink">
            Have You Used These?
          </h2>
          <p className="text-note text-ink-meta mt-1">
            Your bank does not mention them, so WorkIt will not write them in. Say Yes only if you
            have used it.
          </p>
          <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
            {proposal.questions.map((k) => (
              <Question
                key={k.keyword}
                keyword={k}
                answer={answered[k.keyword]}
                onAnswer={(answer, change) => {
                  setAnswered((all) => ({ ...all, [k.keyword]: answer }));
                  if (change) setAdded((all) => [...all, change]);
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" aria-labelledby="tailor-changes">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="tailor-changes" className="text-subtitle text-ink">
            Proposed Changes
          </h2>
          {proposal.changes.length > 1 && (
            <Button variant="ghost" size="inline" onClick={acceptAll}>
              Accept All
            </Button>
          )}
        </div>
        {proposal.dropped > 0 && (
          <p className="text-note text-ink-meta mt-1">
            WorkIt dropped {proposal.dropped} {proposal.dropped === 1 ? "wording" : "wordings"} that
            added a number or tool your bank does not hold.
          </p>
        )}
        {proposal.changes.length === 0 ? (
          <p className="text-body text-ink-muted mt-2">No changes to propose.</p>
        ) : (
          <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
            {proposal.changes.map((change, i) => (
              <ChangeRow
                key={i}
                change={change}
                decision={decisions[i]}
                onDecide={(d) => decide(i, d)}
              />
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={done} disabled={saving}>
          <Check /> {saving ? "Saving…" : "Done"}
        </Button>
        <ButtonLink href={`/jobs/${encodeURIComponent(jobId)}`} variant="secondary">
          Leave Without Saving
        </ButtonLink>
      </div>
      <TailorError error={error} />
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

const WHAT: Record<TailorChange["kind"], string> = {
  reword: "New wording",
  show_entry: "Bring back",
  show_skill: "Show skill",
  order: "Reorder bullets",
};

function ChangeRow({
  change,
  decision,
  onDecide,
}: {
  change: TailorChange;
  decision: Decision | undefined;
  onDecide: (d: Decision) => void;
}) {
  return (
    <li className={cn("py-3", decision === "rejected" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-note text-ink-meta">
            {WHAT[change.kind]}
            {change.label ? `: ${change.label}` : ""}
          </p>
          {change.kind === "reword" && (
            <div className="mt-1 grid gap-1 @lg/main:grid-cols-2">
              <p className="text-body text-ink-muted">
                <span className="sr-only">Old wording: </span>
                {change.original}
              </p>
              <p className="text-body text-ink">
                <span className="sr-only">New wording: </span>
                {change.text}
              </p>
            </div>
          )}
          {change.keywords.length > 0 && (
            <p className="text-note text-positive-ink mt-1">Adds {change.keywords.join(", ")}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant={decision === "accepted" ? "positive" : "secondary"}
            aria-pressed={decision === "accepted"}
            onClick={() => onDecide("accepted")}
          >
            <Check /> Accept
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={decision === "rejected"}
            onClick={() => onDecide("rejected")}
          >
            <X /> Reject
          </Button>
        </div>
      </div>
    </li>
  );
}

/** "Have you used X?" Yes adds X to the bank as a skill and shows it on
 *  the tailored resume (an accepted change), then offers to link it to the
 *  entry where it was used. No AI call. */
function Question({
  keyword,
  answer,
  onAnswer,
}: {
  keyword: Keyword;
  answer: "yes" | "no" | undefined;
  onAnswer: (answer: "yes" | "no", change?: TailorChange) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [linked, setLinked] = useState<string | null>(null);

  async function yes() {
    setBusy(true);
    setError(null);
    const { data, error } = await addSkill(keyword.keyword, null);
    if (!data) {
      setBusy(false);
      return setError(error);
    }
    setSkillId(data.id);
    onAnswer("yes", {
      kind: "show_skill",
      skill_id: data.id,
      bullet_id: null,
      entry_id: null,
      bullet_ids: [],
      text: null,
      original: null,
      label: data.name,
      keywords: [keyword.keyword],
    });
    const bank = await getBank();
    setEntries(bank.data?.entries ?? []);
    setBusy(false);
  }

  async function link(entryId: string) {
    if (!skillId || !entryId) return;
    const { error } = await linkSkill(skillId, entryId);
    if (error) return setError(error);
    setLinked(entryId);
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-ink">
          Have you used <strong>{keyword.keyword}</strong>?
          {keyword.kind === "required" && (
            <span className="text-note text-ink-meta"> The posting requires it.</span>
          )}
        </p>
        {answer == null ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={yes} disabled={busy}>
              Yes, Add It
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAnswer("no")} disabled={busy}>
              No
            </Button>
          </div>
        ) : (
          <p className="text-note text-ink-meta">
            {answer === "yes" ? "Added to your skills" : "Left out"}
          </p>
        )}
      </div>
      {answer === "yes" && entries.length > 0 && (
        <label className="text-note text-ink-muted mt-2 flex flex-wrap items-center gap-2">
          Where Did You Use It?
          <select
            className="border-border-subtle bg-surface text-body rounded-control border px-2 py-1"
            value={linked ?? ""}
            onChange={(e) => link(e.target.value)}
          >
            <option value="">Choose an Entry (Optional)</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.organization ? `, ${e.organization}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-1">
          {error}
        </p>
      )}
    </li>
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
