"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { PdfIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

const ALLOWED_EXTENSIONS = [".pdf", ".docx"];
const MAX_SIZE = 4 * 1024 * 1024;

type ResumeUploadProps = {
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
  /** An upload is in flight. The dropzone says so, Browse Files is disabled
   *  and a second pick or drop is ignored until the parent clears it. */
  busy?: boolean;
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ResumeUpload({ file, onFileChange, onRemove, busy = false }: ResumeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function isAllowed(file: File): boolean {
    return ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
  }

  // An error stays until the next valid file replaces it: one that clears
  // itself after a few seconds is gone before a slow reader reaches it.
  function handleFile(next: File) {
    if (busy) return;
    if (!isAllowed(next)) {
      setFileError("Only PDF and DOCX files are accepted.");
      return;
    }
    if (next.size > MAX_SIZE) {
      setFileError("File must be under 4 MB.");
      return;
    }
    setFileError(null);
    onFileChange(next);
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (next) handleFile(next);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const next = event.dataTransfer.files?.[0];
    if (next) handleFile(next);
  }

  return (
    <div>
      {/* The whole well opens the picker, not only the button: Browse Files
          has no handler of its own, and its click bubbles up to this one. The
          file input sits outside the well so its own click cannot bubble back
          into it. */}
      <div
        aria-busy={busy}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "border-border-strong bg-well rounded-control hover:border-brand/50 flex cursor-pointer flex-col items-center border border-dashed px-4 py-7 transition-colors",
          dragging && "border-brand bg-brand-tint",
          busy && "cursor-progress opacity-60",
        )}
      >
        <UploadIcon className="text-ink-meta size-6" />
        <p className="text-note text-ink mt-2.5 font-medium">
          {busy ? (
            "Uploading…"
          ) : (
            <>
              <span className="pointer-coarse:hidden">Drag and drop your resume here</span>
              <span className="hidden pointer-coarse:inline">Upload your resume</span>
            </>
          )}
        </p>
        <p className="text-meta text-ink-meta mt-1.5">Supported formats: PDF, DOCX (up to 4 MB)</p>
        <Button type="button" variant="outline" className="mt-2" disabled={busy}>
          Browse Files
        </Button>
      </div>
      <input ref={inputRef} type="file" accept=".pdf,.docx" onChange={handleSelect} hidden />

      {fileError && (
        <p role="alert" className="text-meta text-danger mt-2">
          {fileError}
        </p>
      )}

      {file && (
        <div className="border-border-subtle bg-app rounded-control mt-4 flex items-center gap-3 border p-2">
          <PdfIcon className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-label text-ink truncate">{file.name}</p>
            <p className="text-meta text-ink-meta">{formatBytes(file.size)}</p>
          </div>
          <IconButton label="Remove resume" onClick={onRemove}>
            <TrashIcon className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
