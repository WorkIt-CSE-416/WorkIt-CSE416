"use client";

import { useState } from "react";

import { CheckIcon, SparkleIcon } from "@/components/icons";
import { ResumePreview } from "@/components/resume-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { saveResume, tailorResume, type Suggestion } from "@/lib/experience-actions";
import type { ParsedResume, ResumeItem } from "@/lib/resume-actions";

/**
 * Tailor My Resume (KAN-176): one job posting, one resume. The API reorders
 * the resume (each entry's bullets most relevant first, the skills the
 * posting names first) and offers rewordings of the bullets the posting talks
 * about most; the applicant accepts or rejects each, then saves the result
 * as a Tailored Resume that remembers the job. It starts from the whole
 * Experience Bank or from one resume they already have. Nothing is saved
 * until Save.
 *
 * It never says "you're missing X": a posting has no skill list to measure
 * against, so a gap would be a guess (backend/app/services/tailoring.py).
 */

const BANK = "bank";

function applied(resume: ParsedResume, suggestions: Suggestion[], accepted: Set<number>) {
  const out = structuredClone(resume);
  suggestions.forEach((s, i) => {
    if (!accepted.has(i)) return;
    const item = out[s.section][s.item];
    const bullets = [...(item.bullets ?? [])];
    bullets[s.bullet] = s.suggested;
    item.bullets = bullets;
    item.description = bullets.join("\n");
  });
  return out;
}

export function Tailor({
  jobId,
  company,
  resumes,
}: {
  jobId: string;
  company: string;
  resumes: ResumeItem[];
}) {
  const sources = [
    { value: BANK, label: "My Experience Bank (everything)" },
    ...resumes
      .filter((r) => r.status === "parsed")
      .map((r) => ({ value: r.id, label: r.original_filename ?? "Resume" })),
  ];
  const [source, setSource] = useState(BANK);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    resume: ParsedResume;
    suggestions: Suggestion[];
    notice: string | null;
  } | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [name, setName] = useState(`${company} Resume`);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string; pages: number } | null>(null);

  async function handleTailor() {
    setWorking(true);
    setError(null);
    setSaved(null);
    const { data, error: err } = await tailorResume(jobId, source === BANK ? null : source);
    setWorking(false);
    if (err != null) {
      setError(err);
      return;
    }
    setResult(data);
    setAccepted(new Set(data.suggestions.map((_, i) => i)));
  }

  function toggle(i: number) {
    setAccepted((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await saveResume(
      applied(result.resume, result.suggestions, accepted),
      name.trim() || `${company} Resume`,
      "jakes",
      jobId,
    );
    setSaving(false);
    if (err != null) setError(err);
    else setSaved({ id: data.id, name: data.original_filename, pages: data.pages });
  }

  return (
    <div className="grid gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            id="tailor-source"
            label="Start From"
            value={source}
            onValueChange={setSource}
            options={sources}
            className="min-w-64"
          />
          <Button onClick={handleTailor} disabled={working}>
            <SparkleIcon className="size-4" />
            {working ? "Tailoring…" : result ? "Tailor Again" : "Tailor to This Job"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}

        {result && (
          <>
            {result.notice && (
              <p role="status" className="text-label text-ink-muted">
                {result.notice}
              </p>
            )}
            <p className="text-body text-ink-muted">
              Each entry&apos;s bullets now lead with what this posting asks about
              {result.resume.skills.length > 0 &&
                `, and your skills start with ${result.resume.skills
                  .slice(0, 3)
                  .map((s) => s.skill_name)
                  .join(", ")}`}
              .
            </p>
            {result.suggestions.length > 0 && (
              <section aria-labelledby="suggestions">
                <h2 id="suggestions" className="text-subtitle text-ink">
                  Suggested Rewordings
                </h2>
                <p className="text-meta text-ink-meta mt-1">
                  Same facts, in the posting&apos;s words. Keep the ones that still sound like you.
                </p>
                <ol className="mt-3 flex flex-col gap-2">
                  {result.suggestions.map((s, i) => {
                    const on = accepted.has(i);
                    return (
                      <li
                        key={i}
                        className={cn(
                          "rounded-control flex flex-col gap-2 border p-3",
                          on ? "border-brand bg-brand-tint/40" : "border-border-subtle",
                        )}
                      >
                        <p className="text-note text-ink-meta line-through decoration-1">
                          {s.original}
                        </p>
                        <p className="text-body text-ink">{s.suggested}</p>
                        <Button
                          size="sm"
                          variant={on ? "default" : "secondary"}
                          onClick={() => toggle(i)}
                          aria-pressed={on}
                          className="self-start"
                        >
                          {on && <CheckIcon className="size-3.5" />}
                          {on ? "Kept" : "Keep This"}
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </>
        )}
      </div>

      <Card padding="lg" className="flex h-fit flex-col gap-4 @4xl/main:sticky @4xl/main:top-6">
        <h2 className="text-title text-ink">Save Tailored Resume</h2>
        {result ? (
          <>
            <TextField
              id="tailor-name"
              label="Resume Name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-meta text-ink-meta">
              {accepted.size} of {result.suggestions.length} rewordings kept, drawn as Jake&apos;s
              Resume.
            </p>
            <Button onClick={handleSave} disabled={saving} size="lg">
              {saving ? "Saving…" : "Save Tailored Resume"}
            </Button>
          </>
        ) : (
          <p className="text-body text-ink-meta">
            Tailor first, then save what you keep as a new resume. The one you started from stays as
            it is.
          </p>
        )}
        {saved && <ResumePreview key={saved.id} {...saved} />}
      </Card>
    </div>
  );
}
