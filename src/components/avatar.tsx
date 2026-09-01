import { cn } from "@/lib/cn";

type AvatarProps = { name: string; className?: string };

/**
 * Initials stand-in for a profile photo.
 *
 * Used by both shells' account clusters — a person on the seeker side, a
 * recruiter on the company side; initials work the same for either.
 *
 * The mockup shows a photograph, but KAN-43 ships no image asset. Initials on
 * a brand tint keep the circle the right size and weight until real uploads
 * exist; swap the span for next/image once there is something to point it at.
 */
export function Avatar({ name, className }: AvatarProps) {
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
        "bg-brand-tint text-brand inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        className,
      )}
    >
      {initials}
    </span>
  );
}
