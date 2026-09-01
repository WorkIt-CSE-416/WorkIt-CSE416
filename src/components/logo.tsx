import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The WorkIt logo, in the two forms the app uses.
 *
 * Both assets are complete artwork — the wordmark is drawn into the lockup, not
 * rendered as HTML beside it — so nothing here draws text. Each carries 16px of
 * even padding around its content box and is sized by height with an automatic
 * width, because neither is square and pinning a square box would letterbox it.
 *
 * The two forms are not interchangeable: the top bar is 48px tall and the
 * lockup is 2.8 times as wide as it is tall, so the full logo would eat most of
 * the bar's left side. The icon is the mark on its own, cropped from the same
 * artwork sheet at the 70px gutter that separates mark from wordmark.
 *
 * Classes go through cn() because the size map sets a height: a caller passing
 * `h-10` has to beat the `h-8` below, and plain joining would leave the winner
 * to stylesheet order rather than to the override.
 */
const SIZES = {
  /** App top bar — the mark alone. 32px tall renders ~34px wide. */
  bar: {
    src: "/workit-icon.png",
    intrinsic: { width: 481, height: 448 },
    classes: "h-8 w-auto",
    rendered: "34px",
  },
  /** Auth card — the full lockup. 48px tall renders ~135px wide. */
  card: {
    src: "/workit-logo.png",
    intrinsic: { width: 1256, height: 448 },
    classes: "h-12 w-auto",
    rendered: "135px",
  },
} as const;

type LogoProps = {
  size?: keyof typeof SIZES;
  /** Set on the topmost logo of a route; it is the first brand element painted. */
  priority?: boolean;
  className?: string;
};

export function Logo({ size = "bar", priority = false, className }: LogoProps) {
  const { src, intrinsic, classes, rendered } = SIZES[size];

  return (
    <Image
      src={src}
      alt="WorkIt"
      width={intrinsic.width}
      height={intrinsic.height}
      sizes={rendered}
      priority={priority}
      className={cn("block", classes, className)}
    />
  );
}
