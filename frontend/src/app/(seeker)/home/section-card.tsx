import type { ElementType, HTMLAttributes, Ref } from "react";

import { cn } from "@/lib/cn";

/**
 * The tile every Home section sits in. One component so every tile is
 * drawn identically, and so a change to one is a change to all of them.
 *
 * White, with no outline, on the white page panel, set apart by
 * --shadow-tile alone. Not ui/card.tsx: that is the outlined panel the other
 * screens build on, and an outline on every tile read as a grid of grey boxes.
 * A 20px corner (rounded-shell) and 20px inside, so every tile's heading
 * lines up across a row.
 *
 * A tinted tile passes its ground as a `bg-*` class, which `cn` lets win
 * over the white: the four headline numbers each wear their colour's tint
 * (KAN-423, ./headline.tsx). A `tone="brand"` prop filled the one violet
 * tile until then.
 */
export function SectionCard({
  as = "section",
  className,
  ...props
}: {
  as?: "section" | "div";
  className?: string;
  ref?: Ref<HTMLElement>;
} & Omit<HTMLAttributes<HTMLElement>, "className">) {
  const Tag = as as ElementType;

  return (
    <Tag className={cn("rounded-shell shadow-tile bg-panel relative p-5", className)} {...props} />
  );
}
