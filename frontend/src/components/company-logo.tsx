"use client";

import Image from "next/image";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";

/** A logo this close to square is a mark (an app-icon-like square, often on
 *  its own colour), not a wordmark. */
const SQUARE = { min: 0.8, max: 1.25 };

/**
 * A company's own logo, or its initials when there is none —
 * or when the image fails to load: logo URLs come from job boards and go stale
 * when an employer re-uploads. A client component only for `onLoad` and
 * `onError`.
 *
 * TWO SHAPES, MEASURED ON LOAD. A square mark fills the tile edge to edge,
 * clipped by its rounded corners, as an app icon is: framed on white with
 * padding, Figma's black square and Cloudflare's orange one sat shrunk in a
 * white border. A wide wordmark (Hadrian, Clockwork) is `object-contain` on
 * white with padding, since cropped it reads as a mistake. The padding is a
 * share of the tile, so the 32px tile on a job posting's page keeps room for
 * its logo. The image stays hidden until its shape is known, so it never
 * jumps from framed to filled.
 */
export function CompanyLogo({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [square, setSquare] = useState<boolean | null>(null);

  if (!src || failed) return <Avatar name={name} className={className} />;

  return (
    <span
      className={cn(
        "border-border-subtle bg-panel relative block overflow-hidden border",
        className,
      )}
    >
      <Image
        src={src}
        alt={`${name} logo`}
        fill
        sizes="80px"
        className={cn(
          square ? "object-cover" : "object-contain p-[10%]",
          square == null && "opacity-0",
        )}
        onLoad={(e) => {
          const ratio = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
          setSquare(ratio >= SQUARE.min && ratio <= SQUARE.max);
        }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
