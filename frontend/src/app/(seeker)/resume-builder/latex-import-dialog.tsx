"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { UploadIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { FIELD_CONTROL, FIELD_LABEL, TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { importLatex } from "@/lib/latex-actions";

/**
 * "Use My Own LaTeX" (KAN-176): paste a resume's LaTeX, or pick its .tex
 * file, and it is saved as one of the applicant's resumes and opened in the
 * editor. The API compiles it first, so one that doesn't compile is never
 * saved, and says which line to fix. Nothing that reads other files or runs
 * code compiles (backend services/latex_source/safety.py); the message says
 * what to remove.
 */
export function LatexImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [name, setName] = useState("My LaTeX Resume");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 100_000) {
      setError("That file is over 100 KB, more than any resume's LaTeX.");
      return;
    }
    setError(null);
    setSource(await file.text());
    setName(file.name.replace(/\.tex$/i, ""));
  }

  async function handleImport() {
    setSaving(true);
    setError(null);
    const { data, error: err } = await importLatex(source, name.trim() || "My LaTeX Resume");
    setSaving(false);
    if (err != null) {
      setError(err);
      return;
    }
    router.push(`/resume-builder/latex/${encodeURIComponent(data.id)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Use My Own LaTeX</DialogTitle>
          <DialogDescription>
            Paste your resume&apos;s LaTeX, from Overleaf or anywhere else. It stays exactly as you
            wrote it: you edit its words, and tailoring rewords its bullets for each job.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="latex-source" className={FIELD_LABEL}>
              Your LaTeX
            </label>
            <label
              className={cn(
                FIELD_LABEL,
                "text-brand inline-flex cursor-pointer items-center gap-1",
              )}
            >
              <UploadIcon className="size-3.5" />
              Choose a .tex File
              <input
                type="file"
                accept=".tex,text/x-tex,text/plain"
                className="sr-only"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          </div>
          <textarea
            id="latex-source"
            rows={12}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={100_000}
            spellCheck={false}
            placeholder={
              "\\documentclass[letterpaper,11pt]{article}\n…\n\\begin{document}\n…\n\\end{document}"
            }
            className={cn(FIELD_CONTROL, "text-note px-3.5 py-2.5 font-mono")}
          />
          <p className="text-note text-ink-meta">
            One file, the whole document. Packages most resumes use are supported; images and other
            files it reads aren&apos;t.
          </p>
        </div>
        <TextField
          id="latex-name"
          label="Resume Name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-label text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button onClick={handleImport} disabled={saving || !source.trim()}>
            {saving ? "Compiling…" : "Add and Edit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
