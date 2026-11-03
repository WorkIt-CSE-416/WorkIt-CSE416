import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * Every marketing button is one of three roles, in one shape and two
 * heights (KAN-581): primary (`GlassButton`), secondary (`OutlineButton`)
 * and on a fill (`OnFillButton`, white over a coloured or grey panel).
 * A page may change a role's colours for a tier (Pricing's Plus), never
 * its shape or height. The social sign-up buttons keep Google's branded
 * look but take the same shape and height (`BUTTON_SHAPE`, `BUTTON_SIZES`).
 *
 * The shape is the app's control radius, so a button reads the same on the
 * marketing pages and in the app. md is 44px, the touch floor; lg is 48px,
 * for a hero or a closing call to action.
 */
export const BUTTON_SHAPE =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap";

export const BUTTON_SIZES = {
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

type ButtonProps = {
  href: string;
  size?: keyof typeof BUTTON_SIZES;
  /** false for a route handler that reads the session (/go-home). */
  prefetch?: false;
  className?: string;
  children: React.ReactNode;
};

/**
 * The main call to action, in the brand glass. Its fill and edge are the
 * `.glass-btn` rules in landing.css.
 */
export function GlassButton({ href, size = "md", prefetch, className, children }: ButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn("glass-btn", BUTTON_SHAPE, BUTTON_SIZES[size], className)}
    >
      {children}
    </Link>
  );
}

/** The second action beside a glass one: transparent with a dark violet
 *  edge, so it reads over the hero and light sections alike. */
export function OutlineButton({ href, size = "md", prefetch, className, children }: ButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        BUTTON_SHAPE,
        BUTTON_SIZES[size],
        "text-landing-brand-950 ring-landing-brand-950/20 hover:ring-landing-brand-950/30 ring-1 transition-colors ring-inset hover:bg-white/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** White on a fill: a plan card's button. Ink by default; a tier passes its
 *  own text, ring and shadow colours. */
export function OnFillButton({ href, size = "md", prefetch, className, children }: ButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        BUTTON_SHAPE,
        BUTTON_SIZES[size],
        "text-ink hover:bg-surface bg-white shadow-sm transition-colors",
        className,
      )}
    >
      {children}
    </Link>
  );
}
