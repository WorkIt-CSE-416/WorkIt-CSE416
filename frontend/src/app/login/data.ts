import type { ComponentType } from "react";

import { AwardIcon, BriefcaseIcon, SearchIcon } from "@/components/icons";

/**
 * The copy the login screen's brand half renders.
 *
 * NO MOCKUP EXISTS FOR THIS HALF. KAN-43 drew the card and nothing beside it,
 * so what is written here is the product as the built screens describe it —
 * one line per pillar, each pointing at a route that exists: /search, the
 * applications board, and /company for the other account type. Copy a
 * designer has not seen is the one thing on this page worth replacing first.
 *
 * The third point names companies deliberately. Both account types sign in
 * through the one form on the right, so a panel that only spoke to seekers
 * would tell half of the people reading it they were on the wrong screen.
 */
export type Pillar = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
};

export const pillars: Pillar[] = [
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
