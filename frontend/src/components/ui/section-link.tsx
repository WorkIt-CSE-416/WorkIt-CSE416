import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowRightIcon } from "@/components/icons";

/**
 * A section's one way onward: "View All →", short, muted, at the top right of
 * the section's heading row. Pass it as <SectionHeading>'s `action`.
 *
 * The rule lived as inline classes in the seeker Dashboard's SectionHeader, so
 * the company Dashboard had nothing to reuse and drew its own as solid primary
 * buttons. Both Dashboards now render this one link, the seeker's through
 * SectionHeader.
 *
 * `label` is for a screen reader when the visible words lean on the heading
 * for context ("View All" of what).
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
      // The arrow leans the way the link goes when the pointer is on it: a
      // 2px nudge on the glide, back on leaving.
      className="group/section-link text-label text-ink-muted hover:text-ink focus-visible:ring-brand-ring inline-flex shrink-0 items-center gap-1 rounded-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
      <ArrowRightIcon className="ease-glide size-3.5 transition-transform duration-200 group-hover/section-link:translate-x-0.5" />
    </Link>
  );
}
