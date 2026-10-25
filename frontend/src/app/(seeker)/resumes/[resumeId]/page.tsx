import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { getChoices, listBuiltResumes, renderResumePdf } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { getProfile } from "@/lib/profile-actions";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { EDITOR_PARENT } from "./back";
import { Editor } from "./editor";

export const metadata: Metadata = { title: "Resume Editor" };

/**
 * /resumes/[resumeId], the resume editor, opened from a resume's card on the
 * Resumes view (/resumes) or the Experiences view's Showing card, its Back
 * returning to whichever opened it, and where it downloads (KAN-258): the PDF from `GET .../built-resumes/{id}/render`, drawn with
 * pdf.js (loaded on this page only), with a click target from each of the
 * render's boxes (KAN-209), edited in place (KAN-218). It needs the render,
 * the bank, the resume's choices and the profile (the header's fields); if
 * any of the last three fails it shows the error state.
 * On a phone it takes the layout in ./phone.tsx (KAN-219).
 *
 * THE RENDER IS STARTED HERE AND NOT AWAITED (KAN-368). It is a LaTeX
 * compile, the slowest read in the app, and every other read here is a
 * plain one, so awaited together the whole page, Back and the title
 * included, waited on the compile. The editor reads it where the PDF is
 * drawn (./editor.tsx), over a page's skeleton, and a failed render shows
 * its error there. renderResumePdf never rejects, so a page that ends in
 * the error state below, and never reads it, leaves no unhandled rejection.
 * ./loading.tsx stands in until the plain reads are done.
 */
export default async function ResumeEditorPage({ params }: PageProps<"/resumes/[resumeId]">) {
  await connection();
  const { resumeId } = await params;
  const rendered = renderResumePdf(resumeId);
  const [resumes, bank, choices, { profile, error: profileError }] = await Promise.all([
    listBuiltResumes(),
    getBank(resumeId),
    getChoices(resumeId),
    getProfile(),
  ]);
  const name = resumes.data?.find((r) => r.id === resumeId)?.name ?? "Resume";
  const error = bank.error ?? choices.error ?? profileError;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* Back to the page that opened the editor (../../back-link.tsx). The
          editor had no way back but the sidebar until KAN-258; a phone has
          its own arrow in ./phone.tsx. */}
      <BackLink parent={EDITOR_PARENT} />
      <h1 className="text-heading text-ink">{name}</h1>
      {bank.data && choices.data && profile ? (
        <Editor
          resumeId={resumeId}
          initial={rendered}
          initialBank={bank.data}
          initialChoices={choices.data}
          initialHeader={profile}
        />
      ) : (
        <EmptyState
          Icon={CloudSlashIcon}
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
