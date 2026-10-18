import { CompanyLogo } from "@/components/company-logo";

import type { Application } from "../tracker";

/** The logo's box at each size: CompanyTile's own `sm` and `md` boxes, which
 *  the board, grid, list and panel were laid out around. */
const LOGO = {
  sm: "text-meta size-8 rounded",
  md: "text-meta size-10 rounded-control",
} as const;

/**
 * An application's company tile on the board, grid, list and detail panel:
 * the company's own logo (KAN-261), drawn as the job card draws it, with
 * initials when there is none. It sits on white, so it never reads as a
 * stage colour.
 */
export function ApplicationTile({
  application,
  size,
}: {
  application: Pick<Application, "company" | "logoUrl">;
  size: keyof typeof LOGO;
}) {
  return (
    <CompanyLogo name={application.company} src={application.logoUrl} className={LOGO[size]} />
  );
}
