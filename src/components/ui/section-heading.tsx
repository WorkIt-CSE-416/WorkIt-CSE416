import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The title of a section inside a card.
 *
 * `text-title text-ink` was written out at nine call sites, which made the
 * section-title type style a convention held in memory rather than in one
 * place. It lives here now, so restyling section titles is one edit.
 *
 * `action` is the trailing control some sections carry — profile's "+ Add" and
 * "Edit". It is a slot rather than a prop pair because what goes there is a
 * <Button variant="quiet"> on one card and nothing on the next, and the row
 * only becomes a flex pair when something is actually in it. Baseline
 * alignment is what keeps the action's text sitting on the title's baseline
 * rather than centred against the taller box.
 *
 * Headings that carry more than one trailing element — the board's column
 * header, with a count and a menu — build their own row. Bending this to fit
 * them would cost more than the duplication saves.
 */
type SectionHeadingProps = {
  /** Pick the level that fits the outline, not the size — the size is fixed. */
  as?: "h1" | "h2" | "h3";
  id?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SectionHeading({
  as: Tag = "h2",
  id,
  action,
  className,
  children,
}: SectionHeadingProps) {
  const heading = (
    <Tag id={id} className={cn("text-title text-ink", className)}>
      {children}
    </Tag>
  );

  if (!action) return heading;

  return (
    <div className="flex items-baseline justify-between gap-4">
      {heading}
      {action}
    </div>
  );
}
