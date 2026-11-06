import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";

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
 *
 * `muted` draws it in grey (a saved job whose posting closed, ./closed-saved):
 * the logo, not the words beside it, so the role and company keep their
 * contrast (WCAG 1.4.3), and "Posting closed" says what the grey means.
 */
export function ApplicationTile({
  application,
  size,
  muted = false,
}: {
  application: Pick<Application, "company" | "logoUrl">;
  size: keyof typeof LOGO;
  muted?: boolean;
}) {
  return (
    <CompanyLogo
      name={application.company}
      src={application.logoUrl}
      className={cn(LOGO[size], muted && "opacity-60 grayscale")}
    />
  );
}
