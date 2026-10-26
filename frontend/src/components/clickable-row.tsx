"use client";

import { useRouter } from "next/navigation";
import { useTransition, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { TableRow } from "@/components/shadcn/table";
import { cn } from "@/lib/cn";

/**
 * A table row that opens `href` on a click anywhere in it: an application
 * on the Applications list (KAN-256), a job posting in Auto Apply's Live
 * Activity (KAN-285).
 *
 * The role's link used to be stretched over the row (an absolute ::after),
 * but the frozen Role cell is `position: sticky`, and a sticky
 * cell is the containing block for an absolute child, so the stretch shrank
 * to the role's own cell. The row handles the click instead. The role stays
 * a real link, which a keyboard reaches and a middle click opens in a new
 * tab; a click on any link or button inside the row is left to it. A Cmd or
 * Ctrl click opens it in a new tab, as a link would.
 *
 * `group/row` lets the frozen cells, which paint their own background so the
 * scrolled cells pass under them, follow the row's hover tint.
 *
 * THE ROW HOLDS ITS TINT UNTIL THE PAGE CHANGES. The push runs in a
 * transition, and while it is pending the row is marked `data-pending` and
 * keeps the hover tint (`bg-hover`, the tint both tables give their rows),
 * every cell included, so the frozen ones too. A click on a page the router
 * has not prefetched yet waits for the server, and the pointer may have
 * left the row by then; without a mark the click looked ignored.
 */
export function ClickableRow({
  href,
  className,
  style,
  children,
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function open(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else start(() => router.push(href));
  }

  return (
    <TableRow
      onClick={open}
      data-pending={pending || undefined}
      className={cn(
        "group/row data-pending:bg-hover data-pending:*:bg-hover cursor-pointer",
        className,
      )}
      style={style}
    >
      {children}
    </TableRow>
  );
}
