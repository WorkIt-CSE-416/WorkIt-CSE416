import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What WorkIt collects, why, and how to ask about your data.",
};

const LAST_UPDATED = "October 6, 2026";

/**
 * Required before Google will publish the OAuth consent screen out of
 * Testing mode (google/linkedin login's Audience tab asks for this link
 * directly) — not specific to any one deployment, so it lives as a plain
 * route rather than static marketing content. Kept honest rather than
 * aspirational: it describes what the app in this repo actually does,
 * including backend/CLAUDE.md's open item that deleting an account doesn't
 * yet clean up its Storage objects.
 */
export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="inline-block">
        <Logo size="bar" priority />
      </Link>

      <h1 className="text-title text-ink mt-8">Privacy Policy</h1>
      <p className="text-meta text-ink-faint mt-1">Last updated {LAST_UPDATED}</p>

      <p className="text-body text-ink-muted mt-6">
        WorkIt is a student project built for Stony Brook University&apos;s CSE 416 course — a
        job-search and hiring platform connecting applicants and companies. This page explains
        what information WorkIt collects and how it&apos;s used.
      </p>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Information we collect</h2>
        <p className="text-body text-ink-muted mt-2">
          When you create an account, we collect your name and email address. If you sign up as
          an applicant, you may also provide a resume (we extract education, work history, and
          skills from it), a profile photo, and profile links. If you sign up as a company, we
          collect the company&apos;s name, website, contact email and phone, and size.
        </p>
        <p className="text-body text-ink-muted mt-2">
          If you sign in with Google or LinkedIn instead of a password, we receive your name,
          email address, and profile photo from that provider, as shown on their own consent
          screen before you authorize it.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">How we use it</h2>
        <p className="text-body text-ink-muted mt-2">
          Your information is used to operate WorkIt: matching applicants to jobs, letting
          companies review applications, and showing your profile to the company you apply to (if
          you&apos;re an applicant) or to applicants who apply to your postings (if you&apos;re a
          company). We don&apos;t use your data for anything beyond running the product, and we
          don&apos;t sell it.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Where it&apos;s stored</h2>
        <p className="text-body text-ink-muted mt-2">
          Account credentials, profile data, and uploaded files (resumes, profile photos) are
          stored through Supabase, our database and file storage provider. Signing in keeps you
          signed in with a short-lived session cookie, refreshed automatically while you use the
          app.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Who we share it with</h2>
        <p className="text-body text-ink-muted mt-2">
          We share your information with Google or LinkedIn only as needed to sign you in, if you
          choose that option. Beyond that, your profile is visible to the companies you apply to
          (if you&apos;re an applicant) or the applicants who apply to your postings (if
          you&apos;re a company) — that visibility is the core function of the product, not a
          third-party disclosure. We don&apos;t share your data with anyone else.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Deleting your data</h2>
        <p className="text-body text-ink-muted mt-2">
          You can ask us to delete your account and the data tied to it at any time using the
          contact method below. We&apos;re still a student project working out all the edges of
          that process, so if anything about your data isn&apos;t fully removed, reach out and
          we&apos;ll take care of it directly.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Contact</h2>
        <p className="text-body text-ink-muted mt-2">
          Questions about this policy or your data? Open an issue on{" "}
          <a
            href="https://github.com/WorkIt-CSE-416/WorkIt-CSE416"
            className="text-brand hover:text-brand-hover underline-offset-4 hover:underline"
          >
            the project&apos;s GitHub repository
          </a>{" "}
          and a team member will respond.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-label text-ink font-semibold">Changes to this policy</h2>
        <p className="text-body text-ink-muted mt-2">
          If this policy changes, we&apos;ll update the date at the top of this page.
        </p>
      </section>
    </main>
  );
}
