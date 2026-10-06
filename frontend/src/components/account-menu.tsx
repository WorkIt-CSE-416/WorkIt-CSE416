"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { SignOutIcon, UserIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

/**
 * The account cluster's menu — everything that is about you rather than about
 * the work. Both bars use it. The company bar's trigger is the bare 32px
 * avatar; the seeker bar passes its own (the 40px photo with the name and
 * email beside it) as `children`, so the block people already click on is
 * the one that opens it (see (seeker)/account-status.tsx).
 *
 * Settings used to be a bare gear beside the bell, then a row in here: the
 * trade this component exists to make, a slot of top-bar width for a click
 * of depth. Both shells have since moved it to the foot of their panel, where
 * a dashboard keeps the controls for how the app works, so neither passes it.
 *
 * Profile made the same move and came back out to the nav, which is the
 * useful half of the story: the trade turns on how often you return to a
 * screen, not on whether it is "about you". A seeker reopens their profile
 * throughout a hunt; nobody reopens settings. Same menu, same reasoning,
 * opposite answer.
 *
 * `items` is a prop rather than a constant so each shell's layout owns its
 * rows, and the routes a shell can reach are declared in that shell and
 * nowhere else. Neither shell passes any today, which leaves the header and
 * Sign Out.
 *
 * A client component: a menu needs open state, focus management and a portal.
 * It is a leaf, so the bar around it still renders on the server.
 *
 * `icon` is a rendered element, not a component. Both shells are server
 * components and this one is not, so an item crosses the RSC boundary: a
 * component is a function, and functions cannot be serialised into a client
 * component's props — React throws rather than rendering. An element is data by
 * the time it is handed over, so it makes the trip. Sizing it at the call site
 * is the cost, which is why the shells pass `className="size-4"` themselves.
 *
 * The menu opens on who you are: the photo, the name and the email, since
 * below xl the bar shows the photo alone and nothing else on a phone says
 * which account is signed in. A plain block rather than DropdownMenuLabel,
 * which Base UI only allows inside a Group. The header needs a `name`; Sign
 * Out needs only `onSignOut`, so a seeker whose /auth/me failed can still get
 * out. Without `onSignOut` the one row is Sign In instead.
 *
 * The dropdown itself is stock shadcn from @/components/shadcn — unedited, so
 * `shadcn add` can regenerate it. It looks like WorkIt because globals.css maps
 * shadcn's role names onto WorkIt's tokens (--popover is --color-panel, and the
 * highlighted row's --accent is --color-hover), not because it was
 * restyled here.
 */
export type AccountMenuItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

type AccountMenuProps = {
  /** The account's full name. Omit when nobody is signed in (or the API is
   *  down), and the trigger shows a person glyph rather than a made-up name. */
  name?: string;
  /** The sign-in email, printed under the name in the menu's header. */
  email?: string;
  /** The profile photo's signed URL; initials when absent. */
  src?: string | null;
  items: readonly AccountMenuItem[];
  /**
   * A Server Action, passed down from the shell's layout — see
   * src/app/actions.ts. Pass it whenever someone is signed in, even if the
   * API could not name them; without it the menu offers Sign In instead.
   */
  onSignOut?: () => void | Promise<void>;
  /** What the trigger shows, in place of the default 32px avatar. */
  children?: ReactNode;
};

export function AccountMenu({ name, email, src, items, onSignOut, children }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        /* Starts with the visible name, so a voice user who says it reaches
         * the button (WCAG 2.5.3). */
        aria-label={name ? `${name}, account menu` : "Your Account"}
        /* cursor-pointer is not redundant: Tailwind v4's preflight sets
         * `cursor: default` on buttons, so a <button> trigger shows an arrow
         * where the <Link> this replaced showed a hand. */
        className={cn(
          "focus-visible:ring-brand-ring flex cursor-pointer items-center rounded-full focus-visible:ring-2 focus-visible:outline-none",
          children && "min-w-0 gap-3 text-left",
        )}
      >
        {children ??
          (name ? (
            <Avatar name={name} src={src} className="text-note size-8" />
          ) : (
            <span className="bg-brand-tint text-brand flex size-8 items-center justify-center rounded-full">
              <UserIcon className="size-4" />
            </span>
          ))}
      </DropdownMenuTrigger>

      {/* align="end" because the trigger is the last thing in the bar: a menu
          anchored to its start would hang off the right edge. The width
          override replaces the stock w-(--anchor-width), which would otherwise
          size the menu to the 32px avatar and leave min-w-32 to rescue it;
          224px fits a name and an email beside the header's photo. */}
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        {name && (
          <>
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar name={name} src={src} className="text-note size-8" />
              <div className="min-w-0">
                <p className="text-label text-ink truncate">{name}</p>
                {email && <p className="text-note text-ink-meta truncate">{email}</p>}
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {items.map(({ href, label, icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />}>
            <span className="text-ink-meta flex shrink-0">{icon}</span>
            {label}
          </DropdownMenuItem>
        ))}

        {/* The rule only between rows: with Settings in both panels' footers,
            Sign Out is usually the one row under the header, which already
            has its own. */}
        {onSignOut ? (
          <>
            {items.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => {
                void onSignOut();
              }}
            >
              <span className="text-ink-meta flex shrink-0">
                <SignOutIcon className="size-4" />
              </span>
              Sign Out
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {items.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem render={<Link href="/login" />}>
              <span className="text-ink-meta flex shrink-0">
                <LogIn aria-hidden className="size-4" />
              </span>
              Sign In
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
