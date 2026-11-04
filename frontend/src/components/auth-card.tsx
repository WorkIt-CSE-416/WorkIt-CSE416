import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { SkylineBackdrop } from "@/components/skyline";

/**
 * The one card every auth screen draws (/login, /signup, the two reset pages,
 * /signup/check-email and /signup/choose-account-type): the logo, the h1, a
 * subtitle, the page's own body, and an optional line of links under it.
 *
 * Until KAN-573 each page copied the `<main>` and card strings, and the copies
 * drifted: /signup was 576px wide and /login 360px, so the card jumped between
 * the two doors, and the title sat 10px or 16px under the logo. A new auth page
 * imports this; it never copies the strings.
 *
 * The card is `max-w-auth` (360px) on every screen, over the skyline
 * (components/skyline.tsx). It hangs from the top (12vh down from `lg` up)
 * rather than centring: centred, it moved every time its height changed, and
 * the control just clicked slid out from under the pointer.
 *
 * A form in `children` starts with `mt-5`, the gap under the subtitle. No
 * "use client": a client page (the reset forms) renders it as well as a server
 * one.
 */
export function AuthCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** The line under the card's body, such as "Back to Sign In". */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-start justify-center p-6 lg:pt-[12vh]">
      <SkylineBackdrop />

      <div className="max-w-auth rounded-card border-border-control bg-surface shadow-card w-full border p-6">
        <Logo size="card" className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">{title}</h1>
        <p className="text-body text-ink-muted mt-1 text-center">{subtitle}</p>

        {children}

        {footer && <p className="text-body text-ink-muted mt-6 text-center">{footer}</p>}
      </div>
    </main>
  );
}
