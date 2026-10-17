"use client";

import { FileDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { listResumes } from "@/lib/resume-actions";
import { applyWithResume, type SentDownload } from "@/lib/sent-resume-actions";

import { markApplied } from "../actions";

/** One resume the student can apply with: a built resume (a base resume, or
 *  the one tailored to this posting) or an uploaded resume. */
type Choice = { key: string; label: string; kind: string; source: Source; isDefault: boolean };
type Source = { builtResumeId: string } | { uploadedResumeId: string };

/**
 * "Pick a resume, then Apply" (KAN-220). Apply Now asks which resume the
 * student sends, keeps that exact file as a sent resume linked to this
 * posting (`applyWithResume`), then offers the file to download and the
 * employer's own posting to apply on. This page then says which resume was
 * sent ("You sent ... on ..."). A student with no resume, or who would rather not
 * pick one, still reaches the posting: "Apply Without a Resume".
 *
 * The employer's page opens from a link the student clicks, never from
 * `window.open` after the request: a browser blocks a new tab that no click
 * opened.
 *
 * "Did You Apply?" (KAN-242). Once the student leaves for the employer's
 * posting, the dialog stays open behind the new tab and asks; Yes marks the
 * job applied (KAN-232), which takes it off their Jobs page. It replaced an
 * Applied button in the page's header, where one misclick marked a job
 * applied with no undo. It asks only a signed-in applicant (`canMarkApplied`)
 * who has not marked this job already (`applied`).
 */
export function ApplyButton({
  jobId,
  title,
  applyUrl,
  canMarkApplied = false,
  applied = false,
  className,
}: {
  jobId: string;
  title: string;
  applyUrl: string;
  /** A signed-in applicant, who can mark a job applied. */
  canMarkApplied?: boolean;
  /** Marked applied already: the dialog never asks again. */
  applied?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<SentDownload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function load() {
    setChoices(null);
    setSent(null);
    setError(null);
    setAsking(false);
    const [built, uploaded] = await Promise.all([listBuiltResumes(), listResumes()]);
    if (built.error || uploaded.error) {
      setChoices([]);
      return setError(built.error ?? uploaded.error);
    }
    const list: Choice[] = [
      ...(built.data ?? [])
        .filter((r) => r.job_posting_id == null || r.job_posting_id === jobId)
        .map((r) => ({
          key: `built:${r.id}`,
          label: r.name,
          kind: r.job_posting_id ? "Tailored to this job" : "Built resume",
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
    setPicked(first?.key ?? null);
  }

  async function apply() {
    const choice = choices?.find((c) => c.key === picked);
    if (!choice) return;
    setBusy(true);
    setError(null);
    const { data, error } = await applyWithResume(choice.source, jobId);
    setBusy(false);
    if (!data) return setError(error);
    setSent(data);
    // The page's "You sent <name> on <date>" reads the new sent resume.
    router.refresh();
  }

  async function confirmApplied() {
    setBusy(true);
    setError(null);
    const result = await markApplied(jobId);
    setBusy(false);
    if (result.error) return setError(result.error);
    setOpen(false);
    // The page's "You applied on …" reads the new mark.
    router.refresh();
  }

  const employerLink = (label: string, variant: "default" | "secondary") => (
    <a
      href={applyUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses({ variant })}
      // The posting opens in a new tab; this dialog stays to ask whether they
      // applied, for when they come back. Anyone it can't mark just closes it.
      onClick={() => (canMarkApplied && !applied ? setAsking(true) : setOpen(false))}
    >
      {label}
      <ExternalLinkIcon className="size-4" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );

  return (
    <>
      <Button
        size="lg"
        className={className}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        Apply Now
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {asking ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-subtitle font-semibold">Did You Apply?</DialogTitle>
                <DialogDescription>
                  If you sent your application for {title}, mark it applied and WorkIt takes it off
                  your Jobs page.
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-meta text-danger">{error}</p>}
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Not Yet
                </Button>
                <Button onClick={confirmApplied} disabled={busy}>
                  {busy ? "Saving…" : "Yes, I Applied"}
                </Button>
              </DialogFooter>
            </>
          ) : sent ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-subtitle font-semibold">
                  Your Resume Is Ready
                </DialogTitle>
                <DialogDescription>
                  WorkIt kept a copy of &ldquo;{sent.name}&rdquo;, linked to {title}. Download it,
                  then attach it on the employer&apos;s page.
                </DialogDescription>
              </DialogHeader>
              {sent.missing_characters.length > 0 && (
                <p className="text-note text-warning">
                  The PDF&apos;s font cannot show {sent.missing_characters.join(" ")}. Check the
                  file before you send it.
                </p>
              )}
              <DialogFooter>
                <a
                  href={sent.url}
                  rel="noopener"
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <FileDown className="size-4" />
                  Download Resume
                </a>
                {employerLink("Open the Posting", "default")}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-subtitle font-semibold">Pick a Resume</DialogTitle>
                <DialogDescription>
                  WorkIt keeps the exact file you send, so you can see later what {title} received.
                </DialogDescription>
              </DialogHeader>
              {choices == null ? (
                <p className="text-note text-ink-muted">Loading your resumes…</p>
              ) : choices.length === 0 ? (
                !error && (
                  <p className="text-note text-ink-muted">
                    You have no resumes yet. Generate one under Resumes, or apply without one.
                  </p>
                )
              ) : (
                <fieldset className="flex flex-col gap-1">
                  <legend className="sr-only">Resume to send</legend>
                  {choices.map((c) => (
                    <label
                      key={c.key}
                      className="hover:bg-hover has-checked:border-brand border-border rounded-control flex cursor-pointer items-center gap-3 border px-3 py-2"
                    >
                      <input
                        type="radio"
                        name="resume"
                        value={c.key}
                        checked={picked === c.key}
                        onChange={() => setPicked(c.key)}
                        className="accent-brand"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-body text-ink truncate">{c.label}</span>
                        <span className="text-note text-ink-meta">{c.kind}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {error && <p className="text-meta text-danger">{error}</p>}
              <DialogFooter>
                {employerLink("Apply Without a Resume", "secondary")}
                <Button onClick={apply} disabled={busy || picked == null}>
                  {busy ? "Saving…" : "Apply"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
