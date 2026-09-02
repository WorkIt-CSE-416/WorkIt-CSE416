"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";

/**
 * The account cluster's menu — everything that is about you rather than about
 * the work.
 *
 * Settings used to be a bare gear beside the bell. It moved in here, which is
 * the trade this component exists to make: a slot of top-bar width for a click
 * of depth. That is the right trade for settings, because it is not a place you
 * go while working — you go there to change something and come back — and an
 * avatar is where people already look for it.
 *
 * Profile made the same move and came back out to the nav bar, which is the
 * useful half of the story: the trade turns on how often you return to a
 * screen, not on whether it is "about you". A seeker reopens their profile
 * throughout a hunt; nobody reopens settings. Same menu, same reasoning,
 * opposite answer.
 *
 * `items` is a prop rather than a constant because the two shells point the
 * same two rows at different routes: /profile for a seeker, /company/profile
 * for a company. Each shell's layout owns its list, so the routes a shell can
 * reach are declared in that shell and nowhere else. Nothing else about the
 * menu differs, which is why this is parametrised where the bar around it is
 * duplicated — see the note in src/app/company/layout.tsx.
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

type AccountMenuProps = { name: string; items: readonly AccountMenuItem[] };

export function AccountMenu({ name, items }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Your account"
        /* cursor-pointer is not redundant: Tailwind v4's preflight sets
         * `cursor: default` on buttons, so a <button> trigger shows an arrow
         * where the <Link> this replaced showed a hand. */
        className="focus-visible:ring-brand-ring cursor-pointer rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        <Avatar name={name} className="text-note size-8" />
      </DropdownMenuTrigger>

      {/* align="end" because the trigger is the last thing in the bar: a menu
          anchored to its start would hang off the right edge. The width
          override replaces the stock w-(--anchor-width), which would otherwise
          size the menu to the 28px avatar and leave min-w-32 to rescue it. */}
      <DropdownMenuContent align="end" sideOffset={8} className="w-44">
        {items.map(({ href, label, icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />}>
            <span className="text-ink-meta flex shrink-0">{icon}</span>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
