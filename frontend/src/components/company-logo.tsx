"use client";

import Image from "next/image";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { BRANDFETCH, type LogoSrc } from "@/lib/job-logo";

/** A logo this close to square is a mark (an app-icon-like square, often on
 *  its own colour), not a wordmark. */
const SQUARE = { min: 0.8, max: 1.25 };

/**
 * A company's own logo, or its initials when there is none —
 * or when every source fails to load: logo URLs come from job boards and go
 * stale when an employer re-uploads. Given several sources, it shows the
 * first that loads. A client component only for `onLoad` and `onError`.
 *
 * TWO SHAPES, MEASURED ON LOAD. A square mark fills the tile edge to edge,
 * clipped by its rounded corners, as an app icon is: framed on white with
 * padding, Figma's black square and Cloudflare's orange one sat shrunk in a
 * white border. A wide wordmark (Hadrian, Clockwork) is `object-contain` on
 * white with padding, since cropped it reads as a mistake. The padding is a
 * share of the tile, so the 32px tile on a job posting's page keeps room for
 * its logo. The image stays hidden until its shape is known, so it never
 * jumps from framed to filled.
 *
 * BRANDFETCH LOADS STRAIGHT FROM THE BROWSER (`unoptimized`). Its terms allow
 * hotlinking only, with the page's Referer, and refuse a server fetching the
 * image, which is what the `next/image` optimizer does wherever it is on.
 */
export function CompanyLogo({
  name,
  src,
  className,
}: {
  name: string;
  src?: LogoSrc;
  className?: string;
}) {
  const sources = (typeof src === "string" ? [src] : (src ?? [])).filter((url): url is string =>
    Boolean(url),
  );
  const key = sources.join(" ");
  // Which source failed, and each one's shape, are kept against the list they
  // were for, so a tile reused for another company starts again.
  const [failed, setFailed] = useState({ key, count: 0 });
  const [shape, setShape] = useState<{ url: string; square: boolean } | null>(null);
  const url = sources[failed.key === key ? failed.count : 0];

  if (!url) return <Avatar name={name} className={className} />;
  const square = shape?.url === url ? shape.square : null;

  return (
    <span
      className={cn(
        "border-border-subtle bg-panel relative block overflow-hidden border",
        className,
      )}
    >
      <Image
        key={url}
        src={url}
        alt={`${name} logo`}
        fill
        sizes="80px"
        unoptimized={url.startsWith(BRANDFETCH)}
        className={cn(
          square ? "object-cover" : "object-contain p-[10%]",
          square == null && "opacity-0",
        )}
        onLoad={(e) => {
          const ratio = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
          setShape({ url, square: ratio >= SQUARE.min && ratio <= SQUARE.max });
        }}
        onError={() => setFailed((was) => ({ key, count: (was.key === key ? was.count : 0) + 1 }))}
      />
    </span>
  );
}
