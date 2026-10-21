import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * A company's logo on a white tile, from the Google favicon host
 * `next.config.ts` allows: the applications board, the Auto Apply and
 * Updates stops and the journey cards. The hiring systems pass a file in
 * `public/hiring-systems/` instead, since Google had only blurry copies of
 * some of theirs. Decorative; the company's name sits beside it.
 */
export function FaviconLogo({
  className,
  eager,
  ...logo
}: ({ domain: string } | { src: string }) & {
  className?: string;
  /** Load now rather than on scroll: for a logo the browser cannot see
   * coming, such as one inside a transformed grid. */
  eager?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[10px] bg-white shadow-[inset_0_0_0_1px_rgba(76,39,163,0.12)]",
        className,
      )}
    >
      <Image
        src={
          "src" in logo
            ? logo.src
            : `https://www.google.com/s2/favicons?domain=${logo.domain}&sz=64`
        }
        alt=""
        width={32}
        height={32}
        loading={eager ? "eager" : undefined}
        className="size-[55%] rounded-[4px]"
      />
    </span>
  );
}
