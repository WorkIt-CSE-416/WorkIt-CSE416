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
 *
 * The title may break mid-word, because a caller can echo user input in it
 * (/search puts the query there): an unbroken one, a pasted URL say, would
 * otherwise widen the card past a phone's screen and scroll the page sideways.
 *
 * `titleAs` is h1 where the state is the whole view, a 404 under a section
 * whose bar title is then a plain line; an h2 under the page's h1 otherwise.
 */
export function EmptyState({
  Icon,
  title,
  children,
  detail,
  action,
  titleAs: Title = "h2",
  className,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  titleAs?: "h1" | "h2";
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
        <Icon aria-hidden className="size-5" />
      </span>
      <Title className="text-subtitle text-ink mt-3 max-w-full break-words">{title}</Title>
      {children && <p className="text-body text-ink-meta mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
      {detail && <p className="text-note text-ink-meta mt-3 max-w-md">{detail}</p>}
    </Card>
  );
}
