import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

/**
 * A profile section's own action: Add and Edit at the top right of their
 * headings, and Remove Photo on the name's line, beside the photo it removes.
 * It wears the Dashboard's section link (ui/section-link.tsx): 13px, muted ink
 * that darkens on hover, the glyph 14px. So a section's one control sits at
 * the same weight on both seeker pages. These were brand ghost buttons at
 * 12px, which read as links in another kit beside "View All".
 *
 * A Button rather than a link, because it acts on this page instead of going
 * somewhere. The look is ui/button.tsx's `section` variant, which brings the
 * focus ring and the widened hit area too; this wrapper only fixes the
 * variant so the three call sites cannot drift.
 *
 * Pass `aria-label` when the visible word leans on the heading for context
 * ("Add" of what), as SectionLink's `label` does for "View All". Start it with
 * the visible word, so a voice command that says what it sees still works.
 */
export function SectionAction({
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size" | "className">) {
  return (
    <Button variant="section" {...props}>
      {children}
    </Button>
  );
}
