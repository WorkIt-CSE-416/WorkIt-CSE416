import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * A company's logo on a white tile, from the Google favicon host
 * `next.config.ts` allows: the applications route's piles and the Auto
 * Apply and Updates stops. The hiring systems pass a file in
 * `public/hiring-systems/` instead, since Google had only blurry copies of
 * some of theirs. Decorative; the company's name sits beside it.
 *
 * A favicon is loaded as it is (`unoptimized`): it is already a small
 * PNG, and the home page shows some 60, each of which went through
 * /_next/image as a request and a resize of its own.
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
        unoptimized={!("src" in logo)}
        className="size-[55%] rounded-[4px]"
      />
    </span>
  );
}
