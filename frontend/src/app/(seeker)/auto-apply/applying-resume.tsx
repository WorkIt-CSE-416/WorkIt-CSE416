"use client";

import { FileText, Pause, Play, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { RESUME_ROW, ResumeRow } from "@/components/resume-row";
import { Button } from "@/components/ui/button";
import { SectionLink } from "@/components/ui/section-link";
import { previewResume } from "@/lib/preview-resume";
import { listResumes, type ResumeItem } from "@/lib/resume-actions";

import { useProfileCache } from "../profile-cache";
import type { RunState } from "./auto-apply-panel";

/**
 * "Applying with Resume:" at the top of the Auto Apply page: the seeker's
 * primary resume (`is_default`), the one an application is sent with. It is
 * My Profile's own row (components/resume-row.tsx) with only its eye, since
 * choosing and deleting resumes stays on My Profile, which Change leads to.
 *
 * Only the primary, never My Profile's fallback to the newest resume: the
 * matching (`GET /jobs/recommended`) reads the primary alone, so a seeker with
 * none is told to pick one rather than shown a resume nothing uses.
 *
 * It reads the resumes the way My Profile does: a return visit within the
 * shell shows My Profile's cached list at once (../profile-cache.tsx), and
 * listResumes() refetches it on every visit. It never writes that cache, which
 * holds a whole profile snapshot this section does not have.
 *
 * The button on the row's right starts and pauses auto apply; Start queues a
 * batch of matches. The state lives in ./auto-apply-panel.tsx, since Live
 * Activity's heading shows it too.
 * Paused, Resume is the brand fill again; running, Pause steps back to the
 * bordered neutral, so the brand fill always marks the action that starts work.
 */
const RUN_BUTTON: Record<
  RunState,
  { label: string; variant: "default" | "secondary"; Icon: typeof Zap }
> = {
  idle: { label: "Start Auto Apply", variant: "default", Icon: Zap },
  running: { label: "Pause Auto Apply", variant: "secondary", Icon: Pause },
  paused: { label: "Resume Auto Apply", variant: "default", Icon: Play },
};

export function ApplyingResume({
  run,
  pending,
  onToggle,
}: {
  run: RunState;
  /** A batch is being queued: the button holds still until it lands. */
  pending: boolean;
  onToggle: () => void;
}) {
  const cache = useProfileCache();
  const [resumes, setResumes] = useState<ResumeItem[] | null>(() => cache.read()?.resumes ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listResumes()
      .then(({ resumes: list, error: listError }) => {
        // A failed refetch keeps the cached list a return visit already shows.
        if (listError) setLoadFailed(true);
        else setResumes(list);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  async function handlePreview(resume: ResumeItem) {
    setError(null);
    // No await before this call: it opens the PDF's tab inside the click.
    const message = await previewResume(resume);
    if (message) setError(message);
  }

  const primary = resumes?.find((r) => r.is_default);

  const button = RUN_BUTTON[run];

  return (
    <section aria-labelledby="applying-resume" className="mt-6 max-w-2xl">
      {/* The button stands beside the row, its bottom on the row's and as tall
          (52px), so the two read as one control strip. Its width is fixed
          (208px, the widest label's) so the row does not shift when Start
          becomes Pause. On a phone it drops under the row at full width. */}
      <div className="flex flex-col gap-3 @lg/main:flex-row @lg/main:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <h2 id="applying-resume" className="text-label text-ink-meta">
              Applying with Resume:
            </h2>
            <SectionLink href="/profile" label="Change your primary resume on My Profile">
              Change
            </SectionLink>
          </div>

          {primary ? (
            <ResumeRow resume={primary} onPreview={() => handlePreview(primary)} />
          ) : resumes === null && !loadFailed ? (
            // The same 52px box as the row, so nothing jumps when it arrives.
            <div aria-hidden="true" className="bg-well rounded-control mt-2 h-13 animate-pulse" />
          ) : (
            // No primary, or a list that didn't load: the row's place in grey, as
            // My Profile holds it, so a failed load is not read as "none".
            <div className={RESUME_ROW}>
              <FileText aria-hidden className="text-ink-faint size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink-muted truncate">
                  {loadFailed && resumes === null
                    ? "Your resume didn't load"
                    : "No primary resume yet"}
                </p>
                <p className="text-note text-ink-meta">
                  {loadFailed && resumes === null
                    ? "Refresh the page to see it here."
                    : "Star one on My Profile to apply with it."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Off until there is a primary to send: Auto Apply has nothing to
            apply with otherwise, and the row beside it says how to get one. */}
        <Button
          variant={button.variant}
          size="lg"
          disabled={!primary || pending}
          onClick={onToggle}
          className="w-full shrink-0 @lg/main:h-13 @lg/main:w-52"
        >
          <button.Icon aria-hidden className="size-4" />
          {button.label}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-meta text-danger mt-2">
          {error}
        </p>
      )}
    </section>
  );
}
