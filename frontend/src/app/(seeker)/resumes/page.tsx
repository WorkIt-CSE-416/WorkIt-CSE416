import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { listResumes } from "@/lib/resume-actions";

import { SEEKER_GUTTER } from "../gutter";
import { BuiltResumes } from "./built-resumes";
import { ResumesHeader } from "./header";

export const metadata: Metadata = {
  title: "Resumes",
  description: "The resumes you uploaded or made from your experiences.",
};

/**
 * /resumes, the Resumes view of Resumes & Experiences (KAN-249; /bank is
 * the other view, behind the header's switcher): the base resumes the bank
 * makes (KAN-207) and the student's uploads, in one card with the upload
 * dropzone (My Profile's until 2026-10-18). The Sent list (KAN-208) sat
 * under them until 2026-10-18. They sat at the foot of the Experience Bank until KAN-249; there, a
 * student editing entries scrolled past every section to reach a resume. Each resume opens
 * in the editor at /resumes/[resumeId], so the editor's way back lands here.
 * Live from the API; when any list fails the page says so and offers a
 * retry, under the same header with no action.
 */
export default async function ResumesPage() {
  await connection();
  const [resumes, uploaded] = await Promise.all([listBuiltResumes(), listResumes()]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {resumes.data && !uploaded.error ? (
        <BuiltResumes initial={resumes.data} initialUploaded={uploaded.resumes} />
      ) : (
        <>
          <ResumesHeader view="resumes" />
          <EmptyState
            Icon={CloudSlashIcon}
            title="Your Resumes Aren't Loading Right Now"
            className="mt-4"
            action={
              // A plain link, not <Link>: a full reload is what re-runs the fetch.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/resumes" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Try Again
              </a>
            }
            detail={
              process.env.NODE_ENV === "development" ? (resumes.error ?? uploaded.error) : undefined
            }
          >
            We couldn&apos;t reach your resumes. Try again in a few minutes.
          </EmptyState>
        </>
      )}
    </div>
  );
}
