import type { Metadata } from "next";

import { FileText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { getBank } from "@/lib/experience-queries";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../gutter";
import { Builder } from "./builder";

export const metadata: Metadata = {
  title: "Resume Builder",
  description: "Turn everything you've done into an ATS-friendly resume.",
};

/**
 * /resume-builder (KAN-176): the applicant's Experience Bank and the resumes
 * made from it. The bank is everything they have done, kept apart from any
 * one resume; a resume is a frozen copy of the entries they pick, drawn with
 * a template (Jake's Resume first) and saved beside their uploads.
 *
 * Read here on the server; ./builder.tsx changes it through
 * lib/experience-actions.ts and asks for this page again. A failed read is
 * the error, never an empty bank, which would invite someone to fill in what
 * they already have.
 */
export default async function ResumeBuilderPage() {
  const [{ bank, error }, { resumes }] = await Promise.all([getBank(), listResumes()]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-display text-ink">Resume Builder</h1>
      <p className="text-body text-ink-meta mt-1 max-w-[68ch]">
        Everything you&apos;ve done lives in your Experience Bank. Pick what fits, and we&apos;ll
        lay it out as a clean, one-column resume that applicant tracking systems read correctly.
      </p>
      <div className="mt-5">
        {bank ? (
          <Builder bank={bank} resumes={resumes} />
        ) : (
          <EmptyState Icon={FileText} title="Your Experience Bank Isn't Loading" detail={error}>
            Refresh the page in a moment.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
