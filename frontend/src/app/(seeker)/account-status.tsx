import { CircleHelp, Settings } from "lucide-react";
import Link from "next/link";

import { signOut } from "@/app/actions";
import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { Avatar } from "@/components/avatar";
import { ArrowRightIcon, UserIcon } from "@/components/icons";
import { getAvatar } from "@/lib/avatar-actions";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

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
 * From xl only. Below that the bar's width goes to the search field and the
 * account's name and email, and the status is a convenience rather than the
 * only route to anything. 40px tall,
 * the height of the bar's round controls and the avatar beside it.
 */
export async function SeekerStatusLine() {
  const account = await getCurrentAccount();
  if (!account) return null;

  const count = await countNewRoles();
  if (count === 0) return null;

  return (
    <Link
      href="/jobs"
      className="text-note focus-visible:ring-brand-ring bg-brand-tint text-brand-ink hover:bg-brand-pale hidden h-10 shrink-0 items-center gap-2 rounded-full px-4 font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none xl:inline-flex"
    >
      <span aria-hidden="true" className="relative flex size-2">
        <span className="bg-brand motion-safe:animate-status-ping absolute inset-0 rounded-full" />
        <span className="bg-brand relative size-2 rounded-full" />
      </span>
      <span>
        <span className="font-bold">{count}</span> New {count === 1 ? "Role" : "Roles"} Since
        Yesterday
      </span>
      <ArrowRightIcon className="size-3.5" />
    </Link>
  );
}

/**
 * Who is signed in: the photo (initials when there is none), then the full
 * name over the email, as the reference dashboard shows its account.
 *
 * The whole block opens the account menu (@/components/account-menu):
 * Settings, Help and Sign Out, everything about the app rather than the
 * work. They were the panel's General group; the photo in the corner is
 * where people look for them, so they live here alone and the panel keeps
 * only the sections of the search. The menu skips the account header where
 * this block already shows the name and email, so it does not repeat it.
 *
 * The name and email show from lg, where the bar has room for them beside
 * the search field (the new-roles pill steps out until xl for the same
 * reason). Below that the photo stands alone and the two lines stay in the
 * accessibility tree, so the bar still says who is signed in. The photo is
 * the bar's 40px, the size of its round bell and search controls.
 *
 * IT IS ALWAYS THERE. The shell only renders for a signed-in seeker (the
 * layout sends anyone else to /login), so there is always someone to show.
 * The name comes from the API's profile row; if /auth/me cannot be reached,
 * the block falls back to what the session itself knows, a person glyph and
 * the email, rather than leaving the corner empty. That fallback still
 * opens the menu with Sign Out, since the session is real even when the API
 * is not answering, and its button is named "Signed In, account menu" after
 * the words it shows.
 *
 * Spans, not a div and paragraphs: the whole block sits inside the menu's
 * <button>, which may only hold inline content.
 */
/** The menu's rows, above Sign Out: what used to be the panel's General
 *  group. Elements, not components, since they cross into the client menu
 *  (see `icon` in @/components/account-menu). */
const MENU_ITEMS: AccountMenuItem[] = [
  { href: "/settings", label: "Settings", icon: <Settings aria-hidden className="size-4" /> },
  { href: "/help", label: "Help", icon: <CircleHelp aria-hidden className="size-4" /> },
];

export async function SeekerAccount() {
  const account = await getCurrentAccount();

  if (!account) {
    const user = await getSessionUser();
    return (
      <AccountMenu items={MENU_ITEMS} onSignOut={signOut} label="Signed In, account menu">
        <span
          aria-hidden="true"
          className="bg-brand-tint text-brand flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <UserIcon className="size-4" />
        </span>
        <span className="sr-only min-w-0 lg:not-sr-only">
          <span className="text-label text-ink block max-w-48 truncate font-semibold">
            Signed In
          </span>
          {user?.email && (
            <span className="text-note text-ink-meta block max-w-48 truncate">{user.email}</span>
          )}
        </span>
      </AccountMenu>
    );
  }

  const avatar = await getAvatar();

  return (
    <AccountMenu
      name={account.full_name}
      email={account.email}
      src={avatar.url}
      items={MENU_ITEMS}
      onSignOut={signOut}
    >
      <Avatar name={account.full_name} src={avatar.url} className="text-label size-10" />
      <span className="sr-only min-w-0 lg:not-sr-only">
        <span className="text-label text-ink block max-w-48 truncate font-semibold">
          {account.full_name}
        </span>
        <span className="text-note text-ink-meta block max-w-48 truncate">{account.email}</span>
      </span>
    </AccountMenu>
  );
}
