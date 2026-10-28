import type { ReactNode } from "react";

/** The date both drafts show. Change it with every edit to either page. */
export const LEGAL_UPDATED = "2026-10-27";

/**
 * The shell of /privacy and /terms: one readable column of text. The
 * group's layout draws the header and the footer around it, as on every
 * marketing page, so the shell draws neither. Both pages are drafts for the
 * team to review; Google's OAuth brand verification needs them public on
 * the site's own domain, so they render signed out.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="flex-1">
      <article className="text-ink-muted [&_a]:text-brand [&_h2]:text-ink [&_strong]:text-ink mx-auto w-full max-w-3xl px-6 pt-12 pb-20 text-base leading-7 sm:px-10 [&_a]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-2 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6">
        <h1 className="text-ink text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="text-ink-meta">
          Draft — last updated {LEGAL_UPDATED}. This draft is awaiting review by the WorkIt team.
        </p>
        {children}
      </article>
    </main>
  );
}

/** A business decision the draft leaves open, marked so a reviewer finds it. */
export function TeamToDecide({ children }: { children: ReactNode }) {
  return (
    <mark className="bg-warning-tint text-ink rounded px-1">[TEAM TO DECIDE: {children}]</mark>
  );
}
