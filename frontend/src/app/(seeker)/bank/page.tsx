import { CloudOff, FileText } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { OpenScoutButton } from "@/components/scout/scout-buttons";
import { buttonClasses, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { BankScreen } from "./bank-screen";

export const metadata: Metadata = {
  title: "Experience Bank",
  description: "Everything you have done, stored once.",
};

/**
 * /bank, the experience bank (KAN-206): every entry in the seven sections,
 * kept once, that built resumes draw from. It sits beside the resume upload
 * on My Profile, with no feature flag. Live from the API's
 * `GET /applicants/{id}/bank`; when that fails the page says so and offers a
 * retry, never fixture rows. The page is the bank itself: the sections and
 * Skills. The resumes it makes are on My Resumes (/resumes, KAN-249), which
 * the title's My Resumes button opens. Intake, with Import inside its chat,
 * lives in Scout's panel (bank-screen.tsx), opened by the title's Fill With
 * Scout.
 */
export default async function BankPage({ searchParams }: PageProps<"/bank">) {
  await connection();
  // The Jobs page's "Import Your Resume" (?import=1) starts the import here.
  const autoImport = (await searchParams).import === "1";
  const { data, error } = await getBank();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-heading text-ink">Experience Bank</h1>
          <p className="text-body text-ink-meta mt-1">
            Add each thing you did once. Every resume you make draws from here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/resumes" variant="secondary" size="sm">
            <FileText /> My Resumes
          </ButtonLink>
          {data && <OpenScoutButton>Fill With Scout</OpenScoutButton>}
        </div>
      </div>

      {data ? (
        <BankScreen initial={data} autoImport={autoImport} />
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
          detail={process.env.NODE_ENV === "development" ? error : undefined}
        >
          We couldn&apos;t reach your experience bank. Try again in a few minutes.
        </EmptyState>
      )}
    </div>
  );
}
