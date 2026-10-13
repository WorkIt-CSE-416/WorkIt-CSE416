import { CloudOff } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { getChoices, listBuiltResumes, renderResumePdf } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../../gutter";
import { Editor } from "./editor";

export const metadata: Metadata = { title: "Resume Editor" };

/**
 * /resumes/[resumeId], the resume editor, opened from a base resume on the
 * bank page: the PDF from `GET .../built-resumes/{id}/render`, drawn with
 * pdf.js (loaded on this page only), with a click target from each of the
 * render's boxes (KAN-209), edited in place (KAN-218). It needs the render,
 * the bank and the resume's choices; if any fails it shows the error state.
 * The phone layout comes in KAN-219.
 */
export default async function ResumeEditorPage({ params }: PageProps<"/resumes/[resumeId]">) {
  await connection();
  const { resumeId } = await params;
  const [rendered, resumes, bank, choices] = await Promise.all([
    renderResumePdf(resumeId),
    listBuiltResumes(),
    getBank(),
    getChoices(resumeId),
  ]);
  const name = resumes.data?.find((r) => r.id === resumeId)?.name ?? "Resume";
  const error = rendered.error ?? bank.error ?? choices.error;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">{name}</h1>
      {rendered.data && bank.data && choices.data ? (
        <Editor
          resumeId={resumeId}
          initial={rendered.data}
          initialBank={bank.data}
          initialChoices={choices.data}
        />
      ) : (
        <EmptyState
          Icon={CloudOff}
          title="This Resume Isn't Loading Right Now"
          className="mt-4"
          action={
            <a
              href={`/resumes/${encodeURIComponent(resumeId)}`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Try Again
            </a>
          }
        >
          {error}
        </EmptyState>
      )}
    </div>
  );
}
