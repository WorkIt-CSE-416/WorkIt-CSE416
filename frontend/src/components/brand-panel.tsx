import type { ComponentType } from "react";

import { AwardIcon, BriefcaseIcon, SearchIcon } from "@/components/icons";

/**
 * The copy the brand half of an auth screen renders.
 *
 * NO MOCKUP EXISTS FOR THIS HALF. KAN-43 drew the login card and nothing
 * beside it, so what is written here is the product as the built screens
 * describe it — one line per pillar, each pointing at a route that exists:
 * /search, the applications board, and /company for the other account type. A
 * designer has not seen this copy either, so it is the one thing worth
 * replacing first.
 *
 * The third point names companies deliberately. Both account types sign in
 * (or sign up) through the one form on the right, so a panel that only spoke
 * to seekers would tell half of the people reading it they were on the wrong
 * screen.
 */
type Pillar = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const pillars: Pillar[] = [
  {
    Icon: SearchIcon,
    title: "Search by what the job asks for",
    body: "Filter on the skills, pay and location in the posting — not on its title.",
  },
  {
    Icon: BriefcaseIcon,
    title: "Every application on one board",
    body: "Follow each role from applied through to offer without a spreadsheet.",
  },
  {
    Icon: AwardIcon,
    title: "Hiring? The same account",
    body: "Companies sign in here too, straight into their applicant pipeline.",
  },
];

/**
 * The left half of an auth screen (login, signup) — what WorkIt is, beside
 * the form.
 *
 * It is hidden below `lg` rather than stacked above the card. Stacked, it
 * would push the form off a phone screen and make a returning user scroll
 * past the pitch to type a password they already know; the card centred on
 * its own is exactly the screen KAN-43 shipped with, so narrow viewports lose
 * nothing.
 *
 * The two halves are `flex-1` siblings, which is `flex: 1 1 0%` — equal
 * widths regardless of which side's content is taller or wider. The card
 * keeps its own border and shadow: it is the same card, moved, not a panel
 * welded to a wall.
 *
 * No logo here. The card carries the lockup 40px to the right of this text,
 * and the artwork is dark ink drawn for a light ground — it would need a
 * reversed asset to sit on brand blue, and two logos on one screen is one too
 * many.
 *
 * Promoted from login/brand-panel.tsx the day signup became a second
 * consumer — same reasoning as this file's siblings (nav-link, account-menu).
 */
export function BrandPanel() {
  return (
    <section className="bg-brand text-on-brand hidden flex-1 flex-col justify-center gap-9 p-12 lg:flex">
      <div className="max-w-md">
        <h2 className="text-display">Find the work. Track the search.</h2>
        {/* 80% white rather than a token: the ink scale is built for light
         * grounds and has no role for secondary text on a brand fill. */}
        <p className="text-body text-on-brand/80 mt-3">
          One account for the people applying and the teams hiring.
        </p>
      </div>

      <ul className="flex max-w-md flex-col gap-6">
        {pillars.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3.5">
            <span className="bg-on-brand/15 rounded-control flex size-9 shrink-0 items-center justify-center">
              <Icon className="size-4.5" />
            </span>
            <div>
              <h3 className="text-subtitle">{title}</h3>
              <p className="text-body text-on-brand/80 mt-1">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
