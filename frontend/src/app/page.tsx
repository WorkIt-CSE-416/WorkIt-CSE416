import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  /**
   * Spelled out in full, unlike every other page. The root layout's
   * title.template only applies to *child* route segments, and this page shares
   * a segment with that layout, so it never sees the template. Keep the suffix
   * here if you rename this.
   */
  title: "Welcome · WorkIt",
  description: "Choose how you want to use WorkIt.",
};

export default function Home() {
  return (
    <main className="bg-app flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <Logo size="card" priority />

      <div>
        <h1 className="text-title text-ink">Welcome to WorkIt</h1>
        <p className="text-body text-ink-muted mt-1">Where do you want to go?</p>
      </div>

      <div className="grid w-full max-w-md gap-4 sm:grid-cols-2">
        <ButtonLink href="/applications" size="lg" className="h-auto flex-col gap-1 py-4">
          I&apos;m a Job Seeker
          <span className="text-note font-normal opacity-80">Find and track applications</span>
        </ButtonLink>

        <ButtonLink
          href="/company"
          variant="secondary"
          size="lg"
          className="h-auto flex-col gap-1 py-4"
        >
          I&apos;m Hiring
          <span className="text-note text-ink-muted font-normal">Manage roles and applicants</span>
        </ButtonLink>
      </div>
    </main>
  );
}
