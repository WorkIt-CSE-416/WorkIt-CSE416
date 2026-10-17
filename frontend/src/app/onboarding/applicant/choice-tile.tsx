import type { ComponentType, ReactNode } from "react";

import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * One answer to an onboarding question: a filled tile with a box (`check`,
 * any number of the group pressed) or a dot (`radio`, one of the group) in
 * front of its label. A grey well until pressed, then the brand's tint, the
 * same pressed look as the Jobs page's filter chips, so a pick reads the same
 * here and in All Filters. The caller lays the tiles out in a grid.
 */
export function ChoiceTile({
  pressed,
  onClick,
  kind = "check",
  Icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  kind?: "check" | "radio";
  Icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "text-subtitle rounded-control focus-visible:ring-brand-ring flex min-h-11 w-full items-center gap-2.5 border px-3 py-2 text-left font-medium transition-[background-color,border-color,color,scale] duration-150 focus-visible:ring-2 focus-visible:outline-none active:scale-98 lg:min-h-14 lg:gap-3 lg:px-4",
        pressed
          ? "border-brand bg-brand-tint text-brand-ink"
          : "bg-well text-ink hover:border-brand-pale border-transparent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "text-on-brand flex size-4.5 shrink-0 items-center justify-center border transition-colors duration-150 lg:size-5",
          kind === "check" ? "rounded-[5px]" : "rounded-full",
          pressed ? "border-brand bg-brand" : "border-ink-subtle bg-panel",
        )}
      >
        {kind === "check" ? (
          <CheckIcon className={cn("size-3.5", !pressed && "opacity-0")} />
        ) : (
          <span className={cn("bg-on-brand size-1.5 rounded-full", !pressed && "opacity-0")} />
        )}
      </span>
      {Icon && <Icon className={cn("size-4 shrink-0 lg:size-5", !pressed && "text-ink-meta")} />}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
