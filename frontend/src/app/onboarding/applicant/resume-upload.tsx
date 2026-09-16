"use client";

import { useRef, type ChangeEvent, type DragEvent } from "react";

import { PdfIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

/**
 * The dropzone from (seeker)/profile, made interactive: a real file can land
 * in it, and dropping one "reads" its skills. NOTHING HERE ACTUALLY PARSES A
 * RESUME — there is no backend to send the file to, so a fixed skill list
 * stands in for whatever a real parser would return (see ./data.ts). What is
 * real is everything else: the file is genuinely selected, genuinely
 * previewed by name and size, and genuinely removable.
 *
 * Detected skills are consumed as they are added — `detected` shrinks by one
 * each time `onAddSkill` fires — so a skill already sitting in the expertise
 * list above never lingers here as something still to add.
 */
type ResumeUploadProps = {
  file: File | null;
  onFileChange: (file: File) => void;
  onRemove: () => void;
  analyzing: boolean;
  detected: string[] | null;
  onAddSkill: (skill: string) => void;
  onAddAllSkills: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function ResumeUpload({
  file,
  onFileChange,
  onRemove,
  analyzing,
  detected,
  onAddSkill,
  onAddAllSkills,
}: ResumeUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (next) onFileChange(next);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const next = event.dataTransfer.files?.[0];
    if (next) onFileChange(next);
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

      {analyzing && (
        <p className="text-meta text-ink-meta mt-3">Scanning your resume for skills…</p>
      )}

      {detected && detected.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-label text-ink-muted">We found these skills in your resume</p>
            <Button type="button" variant="ghost" onClick={onAddAllSkills}>
              Add all
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {detected.map((skill) => (
              <button
                key={skill}
                type="button"
                onClick={() => onAddSkill(skill)}
                className="border-brand/50 text-brand hover:bg-brand/5 text-note focus-visible:ring-brand-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 focus-visible:ring-2 focus-visible:outline-none"
              >
                + {skill}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
