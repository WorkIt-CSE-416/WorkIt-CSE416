"use client";

import { FileDown, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import {
  deleteSentResume,
  listSentResumes,
  sentResumeFileUrl,
  type SentResume,
} from "@/lib/sent-resume-actions";

import { LocalDate } from "../local-time";
import { DeleteConfirm } from "./delete-confirm";
import { openDownload } from "./download-menu";
import { RowLayout } from "./row-layout";

/**
 * The Sent card on the Resumes view (KAN-208): every resume the student
 * downloaded or applied with, newest first, each the exact file sent. A sent
 * resume downloads again or is deleted, after a confirm, never edited. The
 * card owns its list: downloads happen in the editor since KAN-258, and the
 * page reads the list again on each visit.
 */
export function SentResumes({ initial }: { initial: SentResume[] }) {
  const [sent, setSent] = useState(initial);
  // A failed reload of this list.
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { data, error } = await listSentResumes();
    if (data) setSent(data);
    setError(error);
  }

  return (
    <Card as="section" aria-labelledby="resumes-sent">
      <h2 id="resumes-sent" className="text-subtitle text-ink">
        Sent
      </h2>
      <p className="text-note text-ink-meta mt-1">
        Each resume you downloaded or applied with, kept as it was. Later changes in Experiences do
        not change these.
      </p>
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
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
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    const { data, error } = await sentResumeFileUrl(row.id);
    setBusy(false);
    if (!data) return setError(error);
    openDownload(data.url);
  }

  // Delete stays disabled until the reload drops the row.
  async function remove() {
    setDeleting(true);
    setError(null);
    const { error } = await deleteSentResume(row.id);
    if (!error) return reload();
    setDeleting(false);
    setError(error);
  }

  return (
    <li className="py-3">
      <RowLayout
        head={
          <>
            <p className="text-body text-ink font-medium break-words">{row.name}</p>
            {/* Its file, then the day, as a resume row's line is drawn. */}
            <p className="text-note text-ink-meta">
              {row.format === "docx" ? "Word" : "PDF"} · Sent <LocalDate at={row.created_at} />
            </p>
          </>
        }
        buttons={
          <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
            <FileDown /> {busy ? "Opening…" : "Download"}
          </Button>
        }
        icons={
          <IconButton
            label={`Delete sent resume ${row.name}`}
            tooltip="Delete this sent resume"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" />
          </IconButton>
        }
      />
      {confirming && (
        <DeleteConfirm
          label="Delete Sent Resume"
          busy={deleting}
          onDelete={remove}
          onKeep={() => setConfirming(false)}
        >
          Delete this sent resume? You cannot download it again.
        </DeleteConfirm>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </li>
  );
}
