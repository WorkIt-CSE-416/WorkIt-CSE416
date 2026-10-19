"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { importResume, type ImportResponse } from "@/lib/bank-actions";
import { importSummary } from "@/lib/import-summary";

/**
 * What an import wrote into the experience bank (ADR 0003). An upload
 * imports itself, so intake hands its result in (`result`); "Use One I
 * Uploaded" and the Jobs page's one-click "Import Your Resume" run Import
 * Again on mount (`autoStart`), on the default upload, else the newest.
 * Nothing waits for review: entries are in the bank already, and the student
 * fixes them there. Each write reads the bank again through `onSaved`.
 *
 * Model parsing (KAN-222) runs only on the student's click: "Read It With
 * AI" while they have an AI reading left today. Its entries merge into the
 * bank like any import; a failed reading leaves the bank as it was and shows
 * why.
 *
 * It opens inside intake's chat: Continue hands the space back, and the walk
 * goes on to ask about what the resume did not say.
 */
export function ImportCard({
  onSaved,
  onClose,
  result: given,
  autoStart = false,
}: {
  onSaved: () => Promise<string | null>;
  /** Hands the space back to intake's chat. */
  onClose: () => void;
  /** The upload's own import, already written. */
  result?: ImportResponse;
  /** Run Import Again on mount. */
  autoStart?: boolean;
}) {
  const [result, setResult] = useState<ImportResponse | null>(given ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(readWithAi = false) {
    setBusy(true);
    setError(null);
    const { data, error } = await importResume({ resumeId: result?.resume_id, readWithAi });
    setBusy(false);
    if (!data) return setError(error);
    setResult(data);
    const reloadError = await onSaved();
    if (reloadError) setError(reloadError);
  }

  // Once, even under Strict Mode's double mount.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);

  return (
    <Card as="section" aria-labelledby="bank-import">
      <h2 id="bank-import" className="text-subtitle text-ink">
        Import Your Resume
      </h2>

      <p className="text-body text-ink-meta mt-1" aria-live="polite">
        {result
          ? importSummary(result, result.filename)
          : busy
            ? "Reading your resume…"
            : !error && "Getting your resume…"}
        {result?.found === 0 && (
          <>
            {" "}
            <Link href="/resumes" className="text-brand hover:text-brand-hover underline">
              Upload another on Resumes
            </Link>
            , or add your entries here.
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onClose} disabled={busy}>
          Continue
        </Button>
        {result && result.uses_left > 0 && (
          <Button variant="secondary" size="sm" onClick={() => run(true)} disabled={busy}>
            <SparkleIcon /> {busy ? "Reading…" : "Read It With AI"}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}
