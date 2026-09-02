import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Layout for one section of the kit, and for one labelled specimen inside it.
 *
 * Both are deliberately plain: a design kit that styles itself with anything
 * other than the tokens it is documenting stops being evidence of what the
 * tokens do. Everything here is built from --color-*, --text-* and the two
 * radii, the same as any screen.
 */

export function KitPage({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <>
      <header>
        <h1 className="text-heading text-ink">{title}</h1>
        {note && <p className="text-body text-ink-muted mt-1.5 max-w-prose">{note}</p>}
      </header>
      <div className="mt-6 flex flex-col gap-10">{children}</div>
    </>
  );
}

/** A sub-heading inside a page — "Surfaces" under "Colour". */
export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-caption text-ink-meta uppercase">{title}</h3>
      {note && <p className="text-note text-ink-meta mt-1.5 max-w-prose">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * One specimen: the thing itself on the left, what to call it on the right.
 *
 * The demo cell is not padded or centred — a button has to sit on the page the
 * way it will sit on a screen, or the kit lies about its metrics.
 */
export function Row({
  name,
  role,
  className,
  children,
}: {
  name: string;
  role?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border-subtle grid grid-cols-1 items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0 sm:grid-cols-[1fr_18rem]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      <div className="min-w-0">
        <code className="text-note text-ink block font-mono break-all">{name}</code>
        {role && <p className="text-meta text-ink-meta mt-0.5">{role}</p>}
      </div>
    </div>
  );
}
