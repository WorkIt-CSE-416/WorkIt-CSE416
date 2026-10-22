import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * Questions that open one at a time: the home page's FAQ and each feature
 * page's. A shared `name`, so opening one closes the others.
 */
export function FaqList({
  items,
  className,
}: {
  items: readonly { question: string; answer: string }[];
  className?: string;
}) {
  return (
    <div
      className={cn("divide-border border-border mx-auto max-w-3xl divide-y border-y", className)}
    >
      {items.map((item, i) => (
        <details
          key={item.question}
          name="faq"
          className="group py-5"
          // Its place in the list, for the home page's staggered rise.
          style={{ "--i": i } as CSSProperties}
        >
          <summary className="text-ink flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              className="text-ink-meta relative size-4 shrink-0 before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-current after:transition-transform group-open:after:scale-y-0"
              aria-hidden="true"
            />
          </summary>
          {/* Body copy, in the body colour: the meta grey read faint. */}
          <p className="text-ink-muted mt-3 pr-10">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
