import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * The WorkIt logo: the full lockup at the two heights the app uses, and
 * <LogoLockup> below, the mark and the wordmark as separate images for the
 * seeker shell.
 *
 * The asset is complete artwork — the wordmark is drawn into the lockup, not
 * rendered as HTML beside it — so nothing here draws text. It carries 16px of
 * even padding around its content box and is sized by height with an automatic
 * width, because it is 2.8 times as wide as it is tall and pinning a square box
 * would letterbox it.
 *
 * The bar used to take an icon-only crop of the same sheet, so the mark in the
 * lockup sits at the scale the bar already showed: setting the lockup to that
 * same 40px height redraws the mark at exactly its old size and adds the
 * wordmark to its right, leaving the mark's height alone (the 2.5px lift below
 * came later, and applies to both halves). That crop still ships as
 * public/workit-icon.png because
 * scripts/make-favicon.mjs builds the favicon from it; the `mark` size renders
 * the same crop of the ink lockup instead, so it matches the bar's ink.
 *
 * The bar size is lifted 2.5px because the artwork is bottom-heavy and a box
 * centred by its edges puts the ink low. Alpha-weighted centroids of the sheet,
 * measured against its 223.5px mid-line: the mark falls 23px, the wordmark 38px,
 * the two together 29px — which at the bar's 40px height is the 2.5px lifted
 * back. Nothing here is a trade-off between the two halves; both sit low, so one
 * lift centres both. The wordmark is the half that shows it, since it is small
 * enough to read as a line of text that should sit on the bar's mid-line.
 * scripts/make-favicon.mjs lifts the mark 5% of its height for the same reason
 * and arrives at 2px on a 40px box, which is the same correction found by eye.
 *
 * The lift is a transform rather than a margin so it stays out of the layout:
 * the bar still reserves the image's honest 40px box, and the focus ring the
 * top bars draw around the link keeps tracking that box.
 *
 * The card size is left alone. It is centred by `mx-auto` above a heading in
 * normal flow, where there is no fixed-height container to read it against and
 * a lift would only retune the gap below it.
 *
 * Classes go through cn() because the size map sets a height: a caller passing
 * `h-8` has to beat the `h-10` below, and plain joining would leave the winner
 * to stylesheet order rather than to the override.
 */
const SIZES = {
  /** App top bar — the full lockup in ink (#121a28, --color-ink), not violet:
   *  the bar's other text is ink, and a coloured mark there competed with the
   *  one coloured thing on the page below it. 40px tall renders ~112px wide,
   *  lifted 2.5px. */
  bar: {
    src: "/workit-logo-ink.png",
    intrinsic: { width: 1256, height: 448 },
    classes: "h-10 w-auto -translate-y-[2.5px]",
    rendered: "112px",
  },
  /** The mark alone: the ink lockup cut at x=481, the edge of the violet
   *  icon's own crop, so it sits in the same 16px of padding. */
  mark: {
    src: "/workit-icon-ink.png",
    intrinsic: { width: 481, height: 448 },
    classes: "h-10 w-auto -translate-y-[2.5px]",
    rendered: "43px",
  },
  /** The wordmark alone, cropped to its letters plus 2px, so its height is
   *  the height of "WorkIt" and nothing else. The lockup artwork sets the
   *  word at about 40% of the mark's height inside 37% of empty padding,
   *  which read as a small word beside a big icon; cut free, <LogoLockup>
   *  sizes it against the mark on its own. 20px tall renders ~83px wide. */
  wordmark: {
    src: "/workit-wordmark-ink.png",
    intrinsic: { width: 709, height: 170 },
    classes: "h-5 w-auto",
    rendered: "84px",
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
  /** Empty alt text, for the wordmark half beside a mark that already says
   *  "WorkIt", so the name is not read twice. */
  decorative?: boolean;
  className?: string;
};

export function Logo({ size = "bar", priority = false, decorative = false, className }: LogoProps) {
  const { src, intrinsic, classes, rendered } = SIZES[size];

  return (
    <Image
      src={src}
      alt={decorative ? "" : "WorkIt"}
      width={intrinsic.width}
      height={intrinsic.height}
      sizes={rendered}
      priority={priority}
      className={cn("block", classes, className)}
    />
  );
}

/**
 * The seeker shell's logo: the mark and the wordmark as two images, so the
 * word can be sized against the mark instead of inheriting the artwork's
 * proportion. The mark's ink is 37px tall and the word's letters 20px, about
 * 55%, where the drawn lockup has the word at 40% of the mark and it read as
 * too small beside it. The mark drops the bar lockup's 2.5px lift (that lift
 * centred a bottom-heavy word and mark together), and the word sits 2px below
 * the mark's box centre instead: the mark's weight is low (its thin handle is
 * on top, its body below), with its alpha-weighted centre about 2px under the
 * middle of the 40px box, and the word centred on the box read as riding high
 * beside it.
 *
 * Two images also let the seeker panel fade only the word when it collapses
 * to its rail (`wordmarkHidden`), keeping the mark where it is.
 */
export function LogoLockup({
  priority = false,
  wordmarkHidden = false,
  className,
}: {
  priority?: boolean;
  wordmarkHidden?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size="mark" priority={priority} className="translate-y-0" />
      <Logo
        size="wordmark"
        decorative
        priority={priority}
        className={cn(
          "translate-y-0.5 transition-opacity duration-200 ease-linear",
          wordmarkHidden && "opacity-0",
        )}
      />
    </span>
  );
}
