import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FileText } from "lucide-react";

import { ArrowLeftIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { getLatex } from "@/lib/latex-queries";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../../../gutter";
import { LatexEditor } from "./latex-editor";

export const metadata: Metadata = {
  title: "Edit LaTeX Resume",
  description: "Edit your own LaTeX resume by its words, with a live preview.",
};

/**
 * /resume-builder/latex/[resumeId] (KAN-176): one of the applicant's own
 * LaTeX resumes, read on the server and edited in ./latex-editor.tsx. A
 * resume that isn't theirs, or isn't LaTeX, is not found.
 */
export default async function LatexResumePage({
  params,
}: PageProps<"/resume-builder/latex/[resumeId]">) {
  const { resumeId } = await params;
  const [{ doc, error, missing }, { resumes }] = await Promise.all([
    getLatex(resumeId),
    listResumes(),
  ]);
  if (missing) notFound();
  const name =
    resumes.find((r) => r.id === resumeId)?.original_filename?.replace(/\.pdf$/, "") ?? "Resume";

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <ButtonLink href="/resume-builder" variant="ghost" size="sm" className="-ml-2.5">
        <ArrowLeftIcon className="size-3.5" />
        Resume Builder
      </ButtonLink>
      <h1 className="text-display text-ink mt-2">{name}</h1>
      <p className="text-body text-ink-meta mt-1 mb-5 max-w-[68ch]">
        Your own LaTeX, compiled exactly as written. Edit the words here, or the LaTeX itself in
        Source.
      </p>
      {doc ? (
        <LatexEditor resumeId={resumeId} name={name} initial={doc} />
      ) : (
        <EmptyState Icon={FileText} title="This Resume Isn't Loading" detail={error}>
          Refresh the page in a moment.
        </EmptyState>
      )}
    </div>
  );
}
