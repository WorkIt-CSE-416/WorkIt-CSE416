import Link from "next/link";

import { signOut } from "@/app/actions";
import { AccountMenu } from "@/components/account-menu";
import { ArrowRightIcon } from "@/components/icons";
import { getAvatar } from "@/lib/avatar-actions";
import { getCurrentAccount } from "@/lib/session";

import { countNewRoles } from "./status";

/**
 * The seeker bar's right-hand side: news when there is some, then the account.
 * Two async components rather than one so the layout can put the bell
 * between them; getCurrentAccount is cache()d, so they share one /auth/me.
 * Each streams in behind its own <Suspense>, so a slow API holds up only
 * these, never the page.
 */

/**
 * New roles, as a brand pill with a dot that pulses three times on load and
 * then rests, linking to Jobs — or nothing. The pill only appears when there
 * is news, so it keeps meaning something: a bar that always shows one is a
 * bar people stop reading. A trailing arrow makes it read as a way in rather
 * than a label. See ./status.ts for why it is the only message left here.
 *
 * From lg only. Below that the bar's width goes to the search field, and the
 * status is a convenience rather than the only route to anything.
 */
export async function SeekerStatusLine() {
  const account = await getCurrentAccount();
  if (!account) return null;

  const count = await countNewRoles();
  if (count === 0) return null;

  return (
    <Link
      href="/jobs"
      className="text-note focus-visible:ring-brand-ring bg-brand-tint text-brand-ink hover:bg-brand-pale hidden h-8 shrink-0 items-center gap-2 rounded-full px-3 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none lg:inline-flex"
    >
      <span aria-hidden="true" className="relative flex size-2">
        <span className="bg-brand motion-safe:animate-status-ping absolute inset-0 rounded-full" />
        <span className="bg-brand relative size-2 rounded-full" />
      </span>
      <span>
        <span className="font-bold">{count}</span> new {count === 1 ? "role" : "roles"} since
        yesterday
      </span>
      <ArrowRightIcon className="size-3.5" />
    </Link>
  );
}

/** The photo and full name, which open the account menu. Settings moved to
 *  the panel's footer, so under the name and email Sign Out is the menu's
 *  one item; signed out, it is Sign In. */
export async function SeekerAccount() {
  const account = await getCurrentAccount();
  const avatar = account ? await getAvatar() : null;

  return (
    <AccountMenu
      name={account?.full_name}
      email={account?.email}
      src={avatar?.url}
      showName
      items={[]}
      onSignOut={signOut}
    />
  );
}
