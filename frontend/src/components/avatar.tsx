import { cn } from "@/lib/cn";

type AvatarProps = { name: string; src?: string | null; className?: string };

/**
 * A profile photo, or initials when there is none.
 *
 * Used by both shells' account clusters — a person on the seeker side, a
 * recruiter on the company side; initials work the same for either. Only the
 * seeker profile passes `src` so far.
 *
 * `src` is a signed Supabase Storage URL from the API. A plain <img>, not
 * next/image: the file is already a 512px WebP, and the signed URL changes on
 * every page load, so Next's optimizer would re-fetch and re-cache a new copy
 * each time for no gain. It would also need the Supabase host in
 * `images.remotePatterns`.
 *
 * LAZY, SO NO NAVIGATION WAITS FOR IT. Inside a <ViewTransition> (every
 * seeker page, and the Settings modal, sit in (seeker)/template.tsx's), React
 * holds a navigation's commit for an <img> still loading, up to 800ms, unless
 * the image has `loading="lazy"` or an onLoad. The photo's signed URL is new
 * on every load, so it is never cached, and Settings opened only once the
 * photo had downloaded. Lazy, the modal opens and the photo lands a moment
 * after, over the circle's own tint (initials show only when there is no
 * photo at all).
 */
export function Avatar({ name, src, className }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-brand-tint text-brand inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none",
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- see the docblock
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
