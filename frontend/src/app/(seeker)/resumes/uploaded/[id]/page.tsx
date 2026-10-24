import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { listResumes, readResumePdf } from "@/lib/resume-actions";

import { BackLink } from "../../../back-link";
import { SEEKER_GUTTER } from "../../../gutter";
import { UploadedViewer } from "./viewer";

export const metadata: Metadata = { title: "Resume" };

/**
 * /resumes/uploaded/[id], an uploaded resume's own page (KAN-366), opened
 * from its card on the Resumes view or the Experiences view's Showing card,
 * its Back returning to whichever opened it. A built resume opens the editor
 * (../../[resumeId]); an upload opened a short-lived Storage link in a new
 * tab until then, and a DOCX simply downloaded, so the three kinds of
 * resume acted three ways and an upload left the app. The static
 * `uploaded` segment wins over `[resumeId]`, so the editor's route is
 * untouched.
 *
 * The server reads the PDF (`readResumePdf`, base64) and the page draws it
 * with the editor's pdf.js preview (./viewer.tsx). A DOCX cannot be drawn
 * that way, so its page offers Download alone. An upload the student does
 * not have is a 404; a list or file that fails to load shows the error
 * state with Try Again, as the editor does.
 */
export default async function UploadedResumePage({ params }: PageProps<"/resumes/uploaded/[id]">) {
  await connection();
  const { id } = await params;
  const { resumes, error: listError } = await listResumes();
  const resume = resumes.find((r) => r.id === id);
  if (!listError && !resume) notFound();
  const isPdf = resume?.storage_path.endsWith(".pdf") ?? false;
  const file = resume && isPdf ? await readResumePdf(id) : { data: null, error: null };
  const error = listError ?? file.error;

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {/* Back to the page that opened it, else the list (../../../back-link.tsx). */}
      <BackLink parent={{ href: "/resumes", name: "Resumes" }} />
      {resume && !error ? (
        <UploadedViewer resume={resume} pdf={file.data} />
      ) : (
        <>
          <h1 className="text-heading text-ink">{resume?.original_filename ?? "Resume"}</h1>
          <EmptyState
            Icon={CloudSlashIcon}
            title="This Resume Isn't Loading Right Now"
            className="mt-4"
            action={
              // A plain link, not <Link>: a full reload is what re-runs the fetch.
              <a
                href={`/resumes/uploaded/${encodeURIComponent(id)}`}
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                Try Again
              </a>
            }
          >
            {error}
          </EmptyState>
        </>
      )}
    </div>
  );
}
