import { Building2, Search, SquareKanban } from "lucide-react";
import type { ComponentType } from "react";

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
 * screen. It says "sign in here too", not "the same account": they are two
 * account types, and signing in on the other type's tab is refused.
 *
 * The icons are the ones the signed-in app uses for the same ideas: the
 * search glass, the Applications board's SquareKanban, and the company's
 * Building2.
 */
type Pillar = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

const pillars: Pillar[] = [
  {
    Icon: Search,
    title: "Search by what the job asks for",
    body: "Filter on the skills, pay and location in the posting — not on its title.",
  },
  {
    Icon: SquareKanban,
    title: "Every application on one board",
    body: "Follow each role from applied through to offer without a spreadsheet.",
  },
  {
    Icon: Building2,
    title: "Hiring? Sign in here too",
    body: "Company accounts sign in on this page and land in their applicant pipeline.",
  },
];

/**
 * The left half of an auth screen (login, signup) — what WorkIt is, beside
 * the form.
 *
 * It is hidden below `lg` rather than stacked above the card. Stacked, it
 * would push the form off a phone screen and make a returning user scroll
 * past the pitch to type a password they already know; the card on its own
 * is the screen KAN-43 shipped with, so narrow viewports lose nothing.
 *
 * The split is 5:7 on both screens: this panel is `lg:flex-[5]` and each
 * page's right column is `lg:flex-[7]`, both with a 0 basis, so neither
 * side's content moves the divide. The panel's share is set here rather than
 * at the call sites so /login and /signup cannot disagree; at 1:1 and 5:7
 * they put the violet edge 91px apart. The ratio divides what is left after
 * each side's padding, so at 1280px the panel is about 569px wide. The card
 * keeps its own border and shadow: it is the same card, moved, not a panel
 * welded to a wall.
 *
 * No logo here. The card carries the lockup 40px to the right of this text,
 * and the artwork is dark ink drawn for a light ground — it would need a
 * reversed asset to sit on brand blue, and two logos on one screen is one too
 * many.
 *
 * Its text is paragraphs, not headings. The copy is decorative, and as an h2
 * and three h3s it came before the card's h1, so a screen reader moving by
 * heading started in the pitch instead of at "Welcome Back".
 *
 * Promoted from login/brand-panel.tsx the day signup became a second
 * consumer — same reasoning as this file's siblings (nav-link, account-menu).
 */
export function BrandPanel() {
  return (
    <section className="bg-brand text-on-brand hidden flex-col justify-center gap-9 p-12 lg:flex lg:flex-[5]">
      <div className="max-w-md">
        <p className="text-display">Find the work. Track the search.</p>
        {/* 80% white rather than a token: the ink scale is built for light
         * grounds and has no role for secondary text on a brand fill. */}
        <p className="text-body text-on-brand/80 mt-3">
          One place for the people applying and the teams hiring.
        </p>
      </div>

      <ul className="flex max-w-md flex-col gap-6">
        {pillars.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3.5">
            <span className="bg-on-brand/15 rounded-control flex size-9 shrink-0 items-center justify-center">
              <Icon className="size-4.5" />
            </span>
            <div>
              <p className="text-subtitle">{title}</p>
              <p className="text-body text-on-brand/80 mt-1">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
