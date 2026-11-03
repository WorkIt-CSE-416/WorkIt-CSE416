import { SectionHeading } from "@/components/ui/section-heading";
import { SectionLink } from "@/components/ui/section-link";

/**
 * A Home tile's heading (ui/section-heading.tsx, the one card title), with
 * its one way onward as a short link at the
 * top right: "View All", "Newest Jobs", "Follow Up". One component so every
 * section puts its link in the same place, at the same weight: they had
 * drifted to the bottom of one list and into a sentence-long button on
 * another. The link itself is ui/section-link.tsx, which the company
 * Home uses too.
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
    <SectionHeading
      id={id}
      action={
        link && (
          <SectionLink href={link.href} label={link.label}>
            {link.text}
          </SectionLink>
        )
      }
    >
      {title}
    </SectionHeading>
  );
}
