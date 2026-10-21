import { cn } from "@/lib/cn";

/**
 * The WorkIt logo: a lowercase w drawn as a figure with its arms up and a head
 * above it, beside "workit" in Figtree Bold. It was picked from a set of logo
 * explorations for what the product is for: the moment someone gets the job.
 *
 * All of it is drawn here, with no image files. The word is Figtree's own
 * outlines (OFL), kerned and tracked -1.5% at a 100-unit type size, so it
 * renders the same everywhere without loading the font. Every part shares one
 * box, 91 units tall (the mark's height), with the word's baseline at 77.7:
 * the mark is 1.3 times the word's ascender and centred 46% of the way up it.
 * The lockup, the mark alone and the word alone all use that box, so the two
 * halves of <LogoLockup> sit on one baseline just by being the same height,
 * and every size below is only a height.
 *
 * Colour is currentColor, set with text-* classes, so the tokens drive it. The
 * figure is violet everywhere, the word ink: the auth card, both shells'
 * panel and bar. The shells drew the whole logo in ink until KAN-300, so a
 * coloured mark would not compete with the one coloured thing on the page
 * below it; the team chose the violet figure in the shells too (2026-10-20),
 * so the logo reads the same wherever it shows.
 *
 * Classes go through cn() because the size map sets a height: a caller passing
 * `h-8` has to beat the `h-6.5` below, and plain joining would leave the
 * winner to stylesheet order rather than to the override.
 */

/** The shared box's height, in units of the word's 100-unit type size. */
const HEIGHT = 91;
const MARK_WIDTH = 118.48;
/** Mark to word: 30% of the mark's height. */
const GAP = 27.3;
const WORD_WIDTH = 289;
const LOCKUP_WIDTH = MARK_WIDTH + GAP + WORD_WIDTH;

/** "workit", Figtree Bold outlined, its baseline at y 77.7. */
const WORD =
  "M18 77.7 1 27.7H14.4L24.8 59.9L35.3 27.7H48.3L58.6 59.4L69.1 27.7H82.5L65.5 77.7H52.5L41.8 43.9L31 77.7H18ZM109.6 78.9Q102 78.9 96 75.5Q90.1 72.2 86.8 66.3Q83.4 60.4 83.4 52.7Q83.4 45 86.7 39.1Q90 33.2 95.9 29.9Q101.8 26.5 109.4 26.5Q117.1 26.5 123 29.9Q128.9 33.2 132.2 39.1Q135.5 45 135.5 52.7Q135.5 60.4 132.2 66.3Q128.9 72.2 123.1 75.5Q117.2 78.9 109.6 78.9ZM109.6 66.7Q113.3 66.7 116.1 64.9Q118.9 63.1 120.4 60Q122 56.8 122 52.7Q122 48.6 120.4 45.4Q118.8 42.3 116 40.5Q113.1 38.7 109.4 38.7Q105.8 38.7 102.9 40.5Q100.1 42.3 98.5 45.4Q96.9 48.6 96.9 52.7Q96.9 56.8 98.5 60Q100.1 63.1 103 64.9Q105.9 66.7 109.6 66.7ZM142.7 77.7V27.7H155.9V36.9Q159 32.2 163.7 29.8Q168.5 27.5 173.6 27.5V40.3Q169 40.3 165 41.4Q160.9 42.5 158.4 45Q155.9 47.5 155.9 51.4V77.7H142.7ZM179.1 77.7V7.7H192.3V46.3L209.4 27.7H225.1L206.2 48.8L226.6 77.7H211.1L197.8 58.3L192.3 64.3V77.7H179.1ZM232.2 77.7V27.7H245.4V77.7H232.2ZM238.8 19.6Q235.8 19.6 233.5 17.3Q231.2 15.1 231.2 12Q231.2 8.9 233.5 6.7Q235.8 4.4 238.8 4.4Q241.9 4.4 244.2 6.7Q246.4 8.9 246.4 12Q246.4 15.1 244.2 17.3Q241.9 19.6 238.8 19.6ZM276.7 78.9Q268.4 78.9 264.1 74.8Q259.9 70.7 259.9 63.1V38.9H251.8V27.7H259.9V12.1H273.1V27.7H285.6V38.9H273.1V60.2Q273.1 63.4 274.5 65.1Q275.9 66.7 278.6 66.7Q279.6 66.7 280.8 66.2Q282 65.8 283.3 64.9L287.9 74.8Q285.5 76.6 282.5 77.8Q279.6 78.9 276.7 78.9Z";

const SIZES = {
  /** Company bar's corner cell: the lockup, the figure in violet. 26px tall
   *  renders ~124px wide, the word's letters 20px tall. */
  bar: { part: "lockup", figure: "text-brand", classes: "h-6.5" },
  /** The mark alone, in violet, in the bar's 26px box: ~34px wide. */
  mark: { part: "mark", figure: "text-brand", classes: "h-6.5" },
  /** The word alone, in the same 26px box, so beside the mark it sits on the
   *  lockup's baseline: ~83px wide. */
  wordmark: { part: "word", figure: "text-ink", classes: "h-6.5" },
  /** Auth card: the lockup with the figure in violet. 32px tall renders
   *  ~153px wide. */
  card: { part: "lockup", figure: "text-brand", classes: "h-8" },
} as const;

const WIDTHS = { lockup: LOCKUP_WIDTH, mark: MARK_WIDTH, word: WORD_WIDTH };

type LogoProps = {
  size?: keyof typeof SIZES;
  /** Hidden from assistive tech, for the word beside a mark that already says
   *  "WorkIt", so the name is not read twice. */
  decorative?: boolean;
  className?: string;
};

export function Logo({ size = "bar", decorative = false, className }: LogoProps) {
  const { part, figure, classes } = SIZES[size];

  return (
    <svg
      viewBox={`0 0 ${WIDTHS[part]} ${HEIGHT}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "WorkIt"}
      aria-hidden={decorative || undefined}
      className={cn("block w-auto shrink-0", classes, className)}
    >
      {part !== "word" && (
        <g className={figure}>
          <path
            d="M7.94 26.87 L33.59 83.06 L59.24 45.19 L84.89 83.06 L110.54 26.87"
            fill="none"
            stroke="currentColor"
            strokeWidth={15.88}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={59.24} cy={13.44} r={13.44} fill="currentColor" />
        </g>
      )}
      {part !== "mark" && (
        <path
          d={WORD}
          fill="currentColor"
          className="text-ink"
          transform={part === "lockup" ? `translate(${MARK_WIDTH + GAP} 0)` : undefined}
        />
      )}
    </svg>
  );
}

/**
 * The seeker shell's logo: the mark and the word drawn as two pieces, so the
 * panel can fade only the word when it collapses to its rail
 * (`wordmarkHidden`) and keep the mark where it is. Both share the lockup's
 * box, so equal heights put the word on the mark's baseline, and gap-2 (8px)
 * is the lockup's own gap at 26px (7.8px).
 */
export function LogoLockup({
  wordmarkHidden = false,
  className,
}: {
  wordmarkHidden?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo size="mark" />
      <Logo
        size="wordmark"
        decorative
        className={cn("transition-opacity duration-200 ease-linear", wordmarkHidden && "opacity-0")}
      />
    </span>
  );
}
