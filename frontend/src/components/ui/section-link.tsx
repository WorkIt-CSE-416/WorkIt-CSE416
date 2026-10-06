import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRightIcon } from "@/components/icons";

/**
 * A section's one way onward: "View all →", short, muted, at the top right of
 * the section's heading row. Pass it as <SectionHeading>'s `action`.
 *
 * The rule lived as inline classes in the seeker Dashboard's SectionHeader, so
 * the company Dashboard had nothing to reuse and drew its own as solid primary
 * buttons. These are the same classes, in one place both dashboards can reach.
 *
 * `label` is for a screen reader when the visible words lean on the heading
 * for context ("View all" of what).
 */
export function SectionLink({
  href,
  label,
  children,
}: {
  href: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="text-label text-ink-muted hover:text-ink focus-visible:ring-brand-ring inline-flex shrink-0 items-center gap-1 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
      <ArrowRightIcon className="size-3.5" />
    </Link>
  );
}
