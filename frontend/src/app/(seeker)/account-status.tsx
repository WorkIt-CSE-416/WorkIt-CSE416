import Link from "next/link";

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
 * A label, not a control. It used to open the account menu, whose only row
 * was Sign Out; that now lives in the panel's General group, so there is
 * nothing left for a menu to hold, and a block that looks clickable and does
 * nothing is worse than one that plainly isn't.
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
 * the email, rather than leaving the corner empty.
 */
export async function SeekerAccount() {
  const account = await getCurrentAccount();

  if (!account) {
    const user = await getSessionUser();
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-brand-tint text-brand flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <UserIcon className="size-4" />
        </span>
        <div className="sr-only min-w-0 lg:not-sr-only">
          <p className="text-label text-ink max-w-48 truncate font-semibold">Signed In</p>
          {user?.email && <p className="text-note text-ink-meta max-w-48 truncate">{user.email}</p>}
        </div>
      </div>
    );
  }

  const avatar = await getAvatar();

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={account.full_name} src={avatar.url} className="text-label size-10" />
      <div className="sr-only min-w-0 lg:not-sr-only">
        <p className="text-label text-ink max-w-48 truncate font-semibold">{account.full_name}</p>
        <p className="text-note text-ink-meta max-w-48 truncate">{account.email}</p>
      </div>
    </div>
  );
}
