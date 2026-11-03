import { cn } from "@/lib/cn";

import { SEEKER_GUTTER } from "../(seeker)/gutter";

/**
 * The column every company page draws in: the seeker's (2026-10-27), so both
 * shells start their pages at the same left edge and stop at
 * `max-w-dashboard` (1440px) inside the same gutter. Pages sat in a centred
 * `max-w-app` (1024px) column until KAN-582, with wide empty margins beside
 * the panel, the layout the user ruled flawed on the seeker side. The gutter
 * is read from the seeker's module so the two cannot drift.
 */
export const COMPANY_PAGE = cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER);
