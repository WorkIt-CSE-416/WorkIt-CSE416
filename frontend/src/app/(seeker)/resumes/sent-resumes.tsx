"use client";

import { FileDown, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { formatDate } from "@/lib/format-date";
import { deleteSentResume, sentResumeFileUrl, type SentResume } from "@/lib/sent-resume-actions";

/**
 * The Sent card on My Resumes (KAN-208): every resume the student
 * downloaded, newest first, each the exact file sent. A sent resume
 * downloads again or is deleted, never edited. The list is owned by
 * `BuiltResumes`, whose PDF and Word downloads add to it.
 */

/** Opens a Storage link that downloads its file (its Content-Disposition). */
export function openDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

export function SentResumes({ sent, reload }: { sent: SentResume[]; reload: () => Promise<void> }) {
  return (
    <Card as="section" aria-labelledby="resumes-sent">
      <h2 id="resumes-sent" className="text-subtitle text-ink">
        Sent
      </h2>
      <p className="text-note text-ink-meta mt-1">
        Each resume you downloaded or applied with, kept as it was. Later changes to your bank do
        not change these.
      </p>
      {sent.length === 0 ? (
        <p className="text-note text-ink-muted mt-2">
          Resumes you download or apply with show here.
        </p>
      ) : (
        <ul role="list" className="divide-border-subtle mt-2 flex flex-col divide-y">
          {sent.map((row) => (
            <SentRow key={row.id} row={row} reload={reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SentRow({ row, reload }: { row: SentResume; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    const { data, error } = await sentResumeFileUrl(row.id);
    setBusy(false);
    if (!data) return setError(error);
    openDownload(data.url);
  }

  async function remove() {
    setError(null);
    const { error } = await deleteSentResume(row.id);
    if (error) return setError(error);
    await reload();
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-ink font-medium break-words">{row.name}</p>
          <p className="text-note text-ink-meta">
            {row.format === "docx" && "Word · "}Sent {formatDate(row.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
            <FileDown /> {busy ? "Opening…" : "Download"}
          </Button>
          <IconButton
            label={`Delete sent resume ${row.name}`}
            tooltip="Delete this sent resume"
            onClick={remove}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}
