import { cn } from "@/lib/cn";

/**
 * The landing pages' shared frame: the content width, the rounded panels
 * every full-width band sits in, and the section heading. The home page,
 * the feature pages, Pricing and the Resources pages all draw with these, so the pages read as
 * one site; add a shared piece here rather than copying it into a page.
 */

/** The header's links, Features ▾, Resources ▾ and Pricing: one box for
 *  all three, so their text lines up. A bare inline link sat 1px below the
 *  Features button, its 14px text on the baseline of the list item's 16px
 *  line. A hover tints the box, as in the menus' items: the slate-800 text
 *  darkening to ink was too slight to see. */
export const NAV_ITEM =
  "text-ink inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-900/[0.04]";

/** The site's `container-page` utility. */
export const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/**
 * A full-width band drawn as a rounded panel inset from the window's edges,
 * after Calendly: the inset on the outer element, the fill and corners on
 * the panel inside it. The footer and the product tour use the same inset
 * and radii.
 */
export const PANEL_INSET = "px-2 sm:px-6";
export const PANEL = "rounded-[2rem] lg:rounded-[3rem]";

/**
 * How far the hiring-systems section slides up over the pinned tour's last
 * stop, in vh, from lg up with motion: the tour keeps that much pin after
 * its last stop, and the section starts that far up the page, over it
 * (KAN-368). One number for both, or the tour unpins under the section or
 * the section leaves a gap.
 */
export const TOUR_COVER_VH = 100;

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && <p className="text-landing-brand-700 text-sm font-semibold">{eyebrow}</p>}
      <h2 className="text-ink mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {subtitle && <p className="text-ink-meta mt-4 text-lg text-pretty">{subtitle}</p>}
    </div>
  );
}

/**
 * "Coming soon" beside something the product does not do yet. The tracker
 * stores no employer replies, so the tour's Updates stop and the
 * applications route's Interview and Job Offers stops carry it: once the
 * "How it works" section went, which had carried it on its Hear back card,
 * the page showed replies as working.
 */
export function SoonChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-surface text-ink-muted shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold ring-1 ring-slate-900/5",
        className,
      )}
    >
      Coming soon
    </span>
  );
}
