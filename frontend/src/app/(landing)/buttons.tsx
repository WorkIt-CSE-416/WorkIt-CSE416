import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * The landing page's main call to action, in the brand glass. Styles live in
 * the `.glass-btn` rules in landing.css; pass Tailwind classes via
 * `className` to change size (e.g. `h-12 px-6 text-base`).
 */
export function GlassButton({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("glass-btn", className)}>
      {label}
    </Link>
  );
}

const VARIANTS = {
  // Transparent with a dark violet edge, so it reads over the hero and light
  // sections alike.
  outline:
    "text-landing-brand-950 ring-1 ring-landing-brand-950/20 ring-inset hover:bg-white/50 hover:ring-landing-brand-950/30",
};

const SIZES = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/** The site's plain link button (its Button.astro), in the one variant the
 *  landing page uses. */
export function OutlineButton({
  href,
  size = "md",
  className,
  children,
}: {
  href: string;
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors",
        VARIANTS.outline,
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}
