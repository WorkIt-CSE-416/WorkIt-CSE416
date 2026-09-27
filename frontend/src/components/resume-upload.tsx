"use client";

import { useRef, type ChangeEvent, type DragEvent } from "react";

import { PdfIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

const ALLOWED_EXTENSIONS = [".pdf", ".docx"];

type ResumeUploadProps = {
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ResumeUpload({ file, onFileChange, onRemove }: ResumeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function isAllowed(file: File): boolean {
    return ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (next && isAllowed(next)) onFileChange(next);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const next = event.dataTransfer.files?.[0];
    if (next && isAllowed(next)) onFileChange(next);
  }

  return (
    <div>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className="border-border-strong bg-well rounded-control flex flex-col items-center border border-dashed px-4 py-7"
      >
        <UploadIcon className="text-ink-meta h-6 w-5" />
        <p className="text-note text-ink mt-2.5 font-medium">Drag and drop your resume here</p>
        <p className="text-meta text-ink-meta mt-1.5">Supported formats: PDF, DOCX (Max 5MB)</p>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => inputRef.current?.click()}
        >
          Browse Files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          onChange={handleSelect}
          className="sr-only"
        />
      </div>

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
