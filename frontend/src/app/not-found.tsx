import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page Not Found" };

/**
 * The 404 for a URL no route matches, and for notFound() anywhere a closer
 * not-found file does not catch it. It renders outside both shells, so it
 * borrows the sign-in screen's frame instead: the same card on the grey
 * canvas, the violet lockup, a title-sized heading and one line under it.
 * That is still WorkIt, with a way back in, where Next's stock page was black
 * on white with neither.
 *
 * THIS PAGE READS NOTHING FROM THE REQUEST: no cookies, no headers, no
 * session. Next renders the root not-found into the tree of every page under
 * the root layout, as the fallback the layout router holds, even when no 404
 * happens. So one cookies() read here (it used to call getCurrentAccount())
 * made every route dynamic (all 63 on 2026-10-24), the landing page and the
 * legal pages included: each visit ran a server render, and for a signed-in
 * visitor a GET /auth/me to the API, instead of coming from the CDN. A build
 * with the Supabase keys set (the deploy's) lists / as ○ (static) while this
 * holds; a build with no env file (CI's check) shows ○ either way, because
 * the Supabase client throws before it reaches cookies(), so it cannot catch
 * a regression.
 *
 * The way back is still the account's own home, decided when the button is
 * clicked rather than when the page renders: /go-home (app/go-home/route.ts) reads
 * the session and redirects with homePath(), so a company account goes to
 * its Overview, an applicant mid-onboarding to onboarding, and everyone else,
 * signed in or not, to Home. The label says Home, which
 * is where nearly everyone lands while the business side is hidden
 * (KAN-239). No prefetch: a prefetch of /go-home would run that session lookup
 * on every 404 view, for a click that rarely comes.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6 text-center">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5">Page Not Found</h1>
        <p className="text-body text-ink-meta mt-1">
          The link may be broken, or the page may have moved.
        </p>

        <ButtonLink href="/go-home" prefetch={false} size="lg" className="mt-6 w-full">
          Back to Home
        </ButtonLink>
      </div>
    </main>
  );
}
