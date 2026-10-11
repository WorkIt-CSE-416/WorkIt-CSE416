import type { ElementType, HTMLAttributes, Ref } from "react";

import { cn } from "@/lib/cn";

/**
 * The tile every Dashboard section sits in. One component so every tile is
 * drawn identically, and so a change to one is a change to all of them.
 *
 * White, with no outline, on the white page panel, set apart by
 * --shadow-tile alone. Not ui/card.tsx: that is the outlined panel the other
 * screens build on, and an outline on every tile read as a grid of grey boxes.
 * A 20px corner (rounded-shell) and 20px inside, so every tile's heading
 * lines up across a row.
 *
 * `tone="brand"` is the one filled tile in a row: solid violet with white
 * type, as the first headline number is.
 */
export function SectionCard({
  as = "section",
  tone = "plain",
  className,
  ...props
}: {
  as?: "section" | "div";
  tone?: "plain" | "brand";
  className?: string;
  ref?: Ref<HTMLElement>;
} & Omit<HTMLAttributes<HTMLElement>, "className">) {
  const Tag = as as ElementType;

  return (
    <Tag
      className={cn(
        "rounded-shell shadow-tile relative p-5",
        tone === "brand" ? "bg-brand text-on-brand" : "bg-panel",
        className,
      )}
      {...props}
    />
  );
}
