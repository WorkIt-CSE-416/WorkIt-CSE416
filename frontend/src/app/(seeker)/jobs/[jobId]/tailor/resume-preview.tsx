"use client";

import { Card } from "@/components/ui/card";

import type { Choice } from "../../resume-picker";

/**
 * A preview of the resume picked in Tailor's first step, so the student
 * sees what they are about to tailor. PLACEHOLDER: the resume-preview
 * session replaces this body (a built resume's rendered PDF, an upload's
 * file); the props stay as they are, since the flow session places it.
 */
export function ResumePreview({ choice }: { choice: Choice | null }) {
  return (
    <Card as="section" aria-label="Resume preview">
      <p className="text-note text-ink-meta">
        {choice ? `Preview of ${choice.label}` : "Pick a resume to preview it."}
      </p>
    </Card>
  );
}
