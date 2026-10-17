import { CloudOff } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";
import { listSentResumes } from "@/lib/sent-resume-actions";

import { SEEKER_GUTTER } from "../gutter";
import { BuiltResumes } from "./built-resumes";
import { ResumesHeader } from "./header";

export const metadata: Metadata = {
  title: "Resumes",
  description: "The resumes you made from your experiences, and the ones you sent.",
};

/**
 * /resumes, the Resumes view of Resumes & Experiences (KAN-249; /bank is
 * the other view, behind the header's switcher): the base resumes the bank
 * makes (KAN-207) and the Sent list (KAN-208), each a card. They sat at the
 * foot of the Experience Bank until KAN-249; there, a student editing
 * entries scrolled past every section to reach a resume. Each resume opens
 * in the editor at /resumes/[resumeId], so the editor's way back lands here.
 * Live from the API; when either list fails the page says so and offers a
 * retry, under the same header with no action.
 */
export default async function ResumesPage() {
  await connection();
  const [resumes, sent] = await Promise.all([listBuiltResumes(), listSentResumes()]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {resumes.data && sent.data ? (
        <BuiltResumes initial={resumes.data} initialSent={sent.data} />
      ) : (
        <>
          <ResumesHeader view="resumes" />
          <EmptyState
            Icon={CloudOff}
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
              process.env.NODE_ENV === "development" ? (resumes.error ?? sent.error) : undefined
            }
          >
            We couldn&apos;t reach your resumes. Try again in a few minutes.
          </EmptyState>
        </>
      )}
    </div>
  );
}
