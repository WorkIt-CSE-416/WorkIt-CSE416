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

export const metadata: Metadata = {
  title: "My Resumes",
  description: "The resumes you made from your experience bank, and the ones you sent.",
};

/**
 * /resumes, My Resumes (KAN-249): the base resumes the bank makes (KAN-207)
 * and the Sent list (KAN-208), each a card. They sat at the foot of the
 * Experience Bank until KAN-249; there, a student editing entries scrolled
 * past every section to reach a resume, and the bank page read as two pages
 * in one. Each resume opens in the editor at /resumes/[resumeId], so the
 * editor's way back lands here. Live from the API; when either list fails
 * the page says so and offers a retry.
 */
export default async function ResumesPage() {
  await connection();
  const [resumes, sent] = await Promise.all([listBuiltResumes(), listSentResumes()]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">My Resumes</h1>
      <p className="text-body text-ink-meta mt-1">
        Every resume you make from your experience bank, and every one you sent.
      </p>

      {resumes.data && sent.data ? (
        <BuiltResumes initial={resumes.data} initialSent={sent.data} />
      ) : (
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
      )}
    </div>
  );
}
