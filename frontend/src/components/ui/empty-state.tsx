import type { ComponentType, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * What a screen shows in place of content it doesn't have: nothing to list
 * yet, or a load that failed. One shape for both, so a failed fetch reads as
 * a calm, finished part of the page rather than a stray line of red text, and
 * an empty list says what will fill it instead of leaving a blank.
 *
 * `detail` is for the reader who can act on the cause — the raw API message
 * during development, say. The `title` and `children` are always for the
 * seeker, so they never carry instructions like "run the scraper".
 *
 * role="status" rather than "alert": by the time this renders the page has
 * finished loading, and nothing here is urgent enough to interrupt a screen
 * reader mid-sentence.
 */
export function EmptyState({
  Icon,
  title,
  children,
  detail,
  action,
  className,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      role="status"
      padding="none"
      elevated={false}
      className={cn("flex flex-col items-center px-6 py-10 text-center", className)}
    >
      <span className="bg-brand-tint text-brand rounded-control flex size-10 items-center justify-center">
        <Icon className="size-5" />
      </span>
      <h2 className="text-subtitle text-ink mt-3">{title}</h2>
      {children && <p className="text-body text-ink-meta mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
      {detail && <p className="text-note text-ink-meta mt-3 max-w-md">{detail}</p>}
    </Card>
  );
}
