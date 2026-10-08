import { CircleHelp, Settings } from "lucide-react";

import { signOut } from "@/app/actions";
import { AccountMenu, type AccountMenuItem } from "@/components/account-menu";
import { Avatar } from "@/components/avatar";
import { UserIcon } from "@/components/icons";
import { getAvatar } from "@/lib/avatar-actions";
import { getCurrentAccount, getSessionUser } from "@/lib/session";

/**
 * The seeker bar's account, at its right-hand end. It streams in behind its
 * own <Suspense>, so a slow API holds up only it, never the page.
 */

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
 * the search field. Below that the photo stands alone and the two lines stay in the
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
