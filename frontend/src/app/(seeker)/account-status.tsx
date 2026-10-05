import Link from "next/link";

import { signOut } from "@/app/actions";
import { AccountMenu } from "@/components/account-menu";
import { ArrowRightIcon, UploadIcon } from "@/components/icons";
import { getAvatar } from "@/lib/avatar-actions";
import { cn } from "@/lib/cn";
import { getCurrentAccount } from "@/lib/session";

import { Greeting } from "./greeting";
import { getSeekerStatus } from "./status";

/**
 * The seeker bar's right-hand side: one line of status, then the account.
 * Two async components rather than one so the layout can put the bell
 * between them; getCurrentAccount is cache()d, so they share one /auth/me.
 * Each streams in behind its own <Suspense>, so a slow API holds up only
 * these, never the page.
 */

/**
 * HOW LOUD IT IS MATCHES HOW USEFUL IT IS. News is a brand pill with a dot
 * that pulses three times on load and then rests; a nudge is an amber pill
 * with the action's own glyph; a greeting is plain meta text with no pill at
 * all. The pill only appears when there is something to click, so it keeps
 * meaning something: a bar that always shows one is a bar people stop
 * reading. Both pills are links to where the news is, with a trailing arrow
 * so they read as a way in rather than a label.
 *
 * From lg only. Below that the bar's width goes to the search field, and the
 * status is a convenience rather than the only route to anything.
 */
const PILL =
  "text-note focus-visible:ring-brand-ring hidden h-8 shrink-0 items-center gap-2 rounded-full px-3 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none lg:inline-flex";

export async function SeekerStatusLine() {
  const account = await getCurrentAccount();
  if (!account) return null;

  const status = await getSeekerStatus();

  if (status.kind === "news") {
    return (
      <Link href="/jobs" className={cn(PILL, "bg-brand-tint text-brand-ink hover:bg-brand-pale")}>
        <span aria-hidden="true" className="relative flex size-2">
          <span className="bg-brand motion-safe:animate-status-ping absolute inset-0 rounded-full" />
          <span className="bg-brand relative size-2 rounded-full" />
        </span>
        <span>
          <span className="font-bold">{status.count}</span> new{" "}
          {status.count === 1 ? "role" : "roles"} since yesterday
        </span>
        <ArrowRightIcon className="size-3.5" />
      </Link>
    );
  }

  if (status.kind === "nudge") {
    return (
      <Link href="/profile" className={cn(PILL, "bg-warning-tint text-ink hover:brightness-95")}>
        <UploadIcon className="text-warning size-3.5" />
        Upload a resume to get matched
        <ArrowRightIcon className="text-ink-meta size-3.5" />
      </Link>
    );
  }

  return (
    <Greeting
      firstName={account.full_name.split(" ")[0]}
      className="text-label text-ink-meta hidden whitespace-nowrap lg:block"
    />
  );
}

/** The photo and full name, which open the account menu. Settings moved to
 *  the panel's footer, so Sign out is the menu's one item. */
export async function SeekerAccount() {
  const account = await getCurrentAccount();
  const avatar = account ? await getAvatar() : null;

  return (
    <AccountMenu
      name={account?.full_name}
      src={avatar?.url}
      showName
      items={[]}
      onSignOut={signOut}
    />
  );
}
