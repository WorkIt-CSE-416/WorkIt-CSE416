import type { Metadata } from "next";

import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { getCurrentAccount } from "@/lib/session";

export const metadata: Metadata = { title: "Page Not Found" };

/**
 * The 404 for a URL no route matches, and for notFound() anywhere a closer
 * not-found file does not catch it. It renders outside both shells, so it
 * borrows the sign-in screen's frame instead: the same card on the grey
 * canvas, the violet lockup, a title-sized heading and one line under it.
 * That is still WorkIt, with a way back in, where Next's stock page was black
 * on white with neither.
 *
 * The way back is the account's own home. A company account goes to its
 * Overview, and everyone else, signed in or not, to the seeker Dashboard.
 * getCurrentAccount() is cached per render and returns null when the API is
 * down, so this page never fails for want of it.
 */
export default async function NotFound() {
  const account = await getCurrentAccount();
  const home =
    account?.account_type === "company"
      ? { href: "/company", label: "Back to Overview" }
      : { href: "/dashboard", label: "Back to Dashboard" };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6 text-center">
        <Logo size="card" priority className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5">Page Not Found</h1>
        <p className="text-body text-ink-meta mt-1">
          The link may be broken, or the page may have moved.
        </p>

        <ButtonLink href={home.href} size="lg" className="mt-6 w-full">
          {home.label}
        </ButtonLink>
      </div>
    </main>
  );
}
