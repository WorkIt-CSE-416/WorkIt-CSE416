import { SectionLink } from "@/components/ui/section-link";

/**
 * An open section's heading, with its one way onward as a short link at the
 * top right: "View All", "All Jobs", "Follow Up". One component so every
 * section puts its link in the same place, at the same weight: they had
 * drifted to the bottom of one list and into a sentence-long button on
 * another. The link itself is ui/section-link.tsx, which the company
 * Dashboard uses too.
 *
 * `link.label` is for a screen reader when the visible words lean on the
 * heading for context ("View All" of what).
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
        <SectionLink href={link.href} label={link.label}>
          {link.text}
        </SectionLink>
      )}
    </div>
  );
}
