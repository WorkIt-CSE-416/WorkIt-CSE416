import { CloudOff } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { listBuiltResumes } from "@/lib/built-resume-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { BankScreen } from "./bank-screen";
import { BuiltResumes } from "./built-resumes";

export const metadata: Metadata = {
  title: "Experience Bank",
  description: "Everything you have done, stored once.",
};

/**
 * /bank, the experience bank (KAN-206): every entry in the seven sections,
 * kept once, that built resumes draw from. It sits beside the resume upload
 * on My Profile, with no feature flag. Live from the API's
 * `GET /applicants/{id}/bank`; when that fails the page says so and offers a
 * retry, never fixture rows. Base resumes (KAN-207) are Generated and
 * downloaded from the card above the sections.
 */
export default async function BankPage() {
  await connection();
  const [{ data, error }, resumes] = await Promise.all([getBank(), listBuiltResumes()]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <h1 className="text-heading text-ink">Experience Bank</h1>
      <p className="text-body text-ink-meta mt-1">
        Add each thing you did once. Every resume you make draws from here.
      </p>

      {data && resumes.data ? (
        <>
          <BuiltResumes initial={resumes.data} />
          <BankScreen initial={data} />
        </>
      ) : (
        <EmptyState
          Icon={CloudOff}
          title="Your Bank Isn't Loading Right Now"
          className="mt-4"
          /* A plain link, not <Link>: a full reload is what re-runs the fetch. */
          action={
            <a href="/bank" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Try Again
            </a>
          }
          detail={process.env.NODE_ENV === "development" ? (error ?? resumes.error) : undefined}
        >
          We couldn&apos;t reach your experience bank. Try again in a few minutes.
        </EmptyState>
      )}
    </div>
  );
}
