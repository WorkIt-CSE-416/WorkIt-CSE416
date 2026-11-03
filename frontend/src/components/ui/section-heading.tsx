import type { ReactNode } from "react";

import { Skeleton } from "@/components/shadcn/skeleton";
import { cn } from "@/lib/cn";

/**
 * The title of a section inside a card: 16px at 600, the weight that names
 * a block (docs/design.md, Type weights). Every seeker card wears it,
 * Home's tiles included (KAN-558); it was 20px at 700 until then, beside
 * Home's 16px at 500 and the link cards' 16px at 700.
 *
 * `text-title text-ink` was written out at nine call sites, which made the
 * section-title type style a convention held in memory rather than in one
 * place. It lives here now, so restyling section titles is one edit.
 *
 * `action` is the trailing control some sections carry: profile's Add and
 * Edit. It is a slot rather than a prop pair because what goes there is a
 * <Button variant="section"> on one card and nothing on the next, and the row
 * only becomes a flex pair when something is actually in it. Baseline
 * alignment is what keeps the action's text sitting on the title's baseline
 * rather than centred against the taller box.
 *
 * `text-balance` evens out a title that wraps, so a long one on a phone does
 * not leave its last word alone on a line.
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
    <Tag id={id} className={cn("text-subtitle text-ink text-balance", className)}>
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

/** A title while its section loads: a bar on the title's 22px line, since a
 *  real title among the bars stood out as the one finished thing on the page.
 *  Hidden from a screen reader, so the section names itself with `aria-label`. */
export function SectionHeadingSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-5.5 items-center">
      <Skeleton className="h-4 w-40" />
    </div>
  );
}
