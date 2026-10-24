import { CloudSlashIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";

import { OpenScoutButton } from "@/components/scout/scout-buttons";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getBank } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../gutter";
import { ResumesHeader } from "../resumes/header";
import { BankScreen } from "./bank-screen";

export const metadata: Metadata = {
  title: "Experiences",
  description: "Everything you have done, stored once.",
};

/**
 * /bank, the experience bank (KAN-206), shown as the Experiences view of
 * Resumes & Experiences (KAN-249; the header's switcher leads to Resumes at
 * /resumes): every entry in the seven sections, kept once, that built
 * resumes draw from. Live from the API's `GET /applicants/{id}/bank`; when
 * that fails the page says so and offers a retry, never fixture rows. The
 * page is the bank itself: the sections and Skills. Intake, with Import
 * inside its chat, lives in Scout's panel (bank-screen.tsx), opened by Fill
 * With Scout, the view's primary action beside the switcher. The route
 * stays /bank, so the Jobs page's /bank?import=1 still lands.
 */
export default async function BankPage({ searchParams }: PageProps<"/bank">) {
  await connection();
  // The Jobs page's "Import Your Resume" (?import=1) starts the import here.
  const params = await searchParams;
  const autoImport = params.import === "1";
  // The Showing card's pick (KAN-343, KAN-361): a resume id or "none".
  const resumeParam = typeof params.resume === "string" ? params.resume : undefined;
  const { data, error } = await getBank();

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <ResumesHeader
        view="experiences"
        action={data && <OpenScoutButton>Fill With Scout</OpenScoutButton>}
      />

      {data ? (
        <BankScreen initial={data} autoImport={autoImport} resumeParam={resumeParam} />
      ) : (
        <EmptyState
          Icon={CloudSlashIcon}
          title="Your Bank Isn't Loading Right Now"
          className="mt-4"
          /* A plain link, not <Link>: a full reload is what re-runs the fetch. */
          action={
            // eslint-disable-next-line @next/next/no-html-link-for-pages -- the reload is the point
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
