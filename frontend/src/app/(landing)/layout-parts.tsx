import { cn } from "@/lib/cn";

/**
 * The landing pages' shared frame: the content width, the rounded panels
 * every full-width band sits in, and the section heading. The home page,
 * the feature pages and Pricing all draw with these, so the pages read as
 * one site; add a shared piece here rather than copying it into a page.
 */

/** The header's links, Features ▾ and Pricing: one box for both, so their
 *  text lines up. A bare inline link sat 1px below the Features button,
 *  its 14px text on the baseline of the list item's 16px line. */
export const NAV_ITEM =
  "hover:text-ink inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-slate-800 transition-colors";

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
      <h2 className="text-ink mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {subtitle && <p className="text-ink-meta mt-4 text-lg text-pretty">{subtitle}</p>}
    </div>
  );
}
