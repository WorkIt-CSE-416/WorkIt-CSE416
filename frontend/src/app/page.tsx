import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/logo";

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

/**
 * A choice of two, each a whole card that is one link: it lifts 2px onto
 * --shadow-lift under the pointer and settles on the press, as every card
 * that is one target does (docs/motion.md). They were two lg buttons
 * stretched to a card's height with a second line inside, the only buttons
 * of their size in the app (KAN-251). Drawn alike: neither is the default.
 */
const CHOICE =
  "rounded-card bg-panel border-border-subtle shadow-panel hover:border-brand/40 hover:shadow-lift ease-glide focus-visible:ring-brand-ring flex flex-col gap-1 border p-5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:outline-none active:translate-y-0 active:scale-[0.99]";

export default function Home() {
  return (
    <main className="bg-app flex flex-1 flex-col items-center justify-center gap-8 p-8 text-center">
      <Logo size="card" />

      <div>
        <h1 className="text-title text-ink">Welcome to WorkIt</h1>
        <p className="text-body text-ink-muted mt-1">Where do you want to go?</p>
      </div>

      <div className="grid w-full max-w-md gap-4 sm:grid-cols-2">
        <Link href="/dashboard" className={CHOICE}>
          <span className="text-subtitle text-ink font-semibold">I&apos;m a Job Seeker</span>
          <span className="text-note text-ink-meta">Find and track applications</span>
        </Link>

        <Link href="/company" className={CHOICE}>
          <span className="text-subtitle text-ink font-semibold">I&apos;m Hiring</span>
          <span className="text-note text-ink-meta">Manage roles and applicants</span>
        </Link>
      </div>
    </main>
  );
}
