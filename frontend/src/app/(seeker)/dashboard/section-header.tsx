import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";

/**
 * An open section's heading, with its one way onward as a short link at the
 * top right — "View all", "All jobs", "Follow up". One component so every
 * section puts its link in the same place, at the same weight: they had
 * drifted to the bottom of one list and into a sentence-long button on
 * another.
 *
 * `linkLabel` is for a screen reader when the visible words lean on the
 * heading for context ("View all" of what).
 */
export function SectionHeader({
  id,
  title,
  link,
}: {
  id: string;
  title: string;
  link?: { href: string; text: string; label?: string };
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-title text-ink">
        {title}
      </h2>
      {link && (
        <Link
          href={link.href}
          aria-label={link.label}
          className="text-label text-ink-muted hover:text-ink focus-visible:ring-brand-ring inline-flex shrink-0 items-center gap-1 rounded-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          {link.text}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
