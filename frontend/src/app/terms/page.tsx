import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using WorkIt.",
};

const LAST_UPDATED = "October 6, 2026";

/**
 * Paired with src/app/privacy/page.tsx — Google's OAuth consent screen asks
 * for both links before it'll leave Testing mode, same requirement, same
 * reasoning (see that file's docblock).
 */
export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="inline-block">
        <Logo size="bar" priority />
      </Link>

      <h1 className="text-title text-ink mt-8">Terms of Service</h1>
      <p className="text-meta text-ink-faint mt-1">Last updated {LAST_UPDATED}</p>

      <p className="text-body text-ink-muted mt-6">
        WorkIt is a student project built for Stony Brook University&apos;s CSE 416 course. It
        isn&apos;t a commercial product, and using it means agreeing to the terms below.
      </p>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">What WorkIt is</h2>
        <p className="text-body text-ink-muted mt-2">
          WorkIt connects job applicants and companies: applicants can build a profile, upload a
          resume, and apply to postings; companies can post jobs and review applicants. It&apos;s
          provided for coursework and demonstration purposes, not as a production hiring service.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Your account</h2>
        <p className="text-body text-ink-muted mt-2">
          You&apos;re responsible for the accuracy of what you submit — your profile, resume, and
          any company information — and for keeping your account credentials to yourself. One
          email address is tied to one account.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Acceptable use</h2>
        <p className="text-body text-ink-muted mt-2">
          Use WorkIt the way it&apos;s meant to be used: real applicants applying to real-looking
          postings, and companies posting jobs in good faith. Don&apos;t use it to submit false
          information, scrape or misuse other users&apos; data, or attempt to disrupt the service.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">No warranty</h2>
        <p className="text-body text-ink-muted mt-2">
          WorkIt is provided as-is, as a work in progress built by students. We make no guarantee
          it&apos;s available, bug-free, or fit for any particular purpose, and we&apos;re not
          liable for any outcome from using it.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Changes</h2>
        <p className="text-body text-ink-muted mt-2">
          We may update these terms or the product itself as the project develops. Continuing to
          use WorkIt after a change means you accept the updated terms.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Contact</h2>
        <p className="text-body text-ink-muted mt-2">
          Questions about these terms? Open an issue on{" "}
          <a
            href="https://github.com/WorkIt-CSE-416/WorkIt-CSE416"
            className="text-brand hover:text-brand-hover underline-offset-4 hover:underline"
          >
            the project&apos;s GitHub repository
          </a>{" "}
          and a team member will respond.
        </p>
      </section>
    </main>
  );
}
