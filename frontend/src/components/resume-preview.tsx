"use client";

import { ArrowRightIcon } from "@/components/icons";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { builtResumeUrl } from "@/lib/resume-files";

/**
 * A resume WorkIt just built: the PDF itself, so what is previewed is exactly
 * what downloads, and its two downloads. Shared by the Resume Builder and
 * Tailor My Resume. `pages` past one gets a warning: Jake's Resume is a
 * one-page template, and early-career resumes are read as one page, so the
 * applicant should choose what to drop rather than find a second page. An
 * applicant's own LaTeX resume has no Word file (`word={false}`).
 */
export function ResumePreview({
  id,
  name,
  pages,
  word = true,
}: {
  id: string;
  name: string;
  pages: number;
  /** False for the applicant's own LaTeX, which downloads as a PDF only */
  word?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {pages > 1 && (
        <p role="status" className="bg-warning-tint text-warning rounded-control text-label p-3">
          This resume runs to {pages} pages. Untick a few entries or shorten some bullets to fit it
          on one.
        </p>
      )}
      <iframe
        title={`${name} preview`}
        src={builtResumeUrl(id, "pdf", true)}
        className="border-border-subtle rounded-control aspect-[8.5/11] w-full border bg-white"
      />
      <div className="flex flex-wrap gap-2">
        {/* Plain anchors: a file, not a page, so no client-side navigation */}
        <a href={builtResumeUrl(id, "pdf")} download className={buttonClasses()}>
          Download PDF
        </a>
        {word && (
          <a
            href={builtResumeUrl(id, "docx")}
            download
            className={buttonClasses({ variant: "secondary" })}
          >
            Download Word
          </a>
        )}
        {/* The panel's preview is too small to read; this is the page at full size */}
        <a
          href={builtResumeUrl(id, "pdf", true)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: "ghost" })}
        >
          Open Full Size
        </a>
        <ButtonLink href="/profile" variant="ghost" className="ml-auto">
          See It in My Profile
          <ArrowRightIcon className="size-3.5" />
        </ButtonLink>
      </div>
    </div>
  );
}
