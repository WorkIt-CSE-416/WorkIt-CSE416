"use client";

import Image from "next/image";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { cn } from "@/lib/cn";

/**
 * A company's own logo on a white tile, or its initials when there is none —
 * or when the image fails to load: logo URLs come from job boards and go stale
 * when an employer re-uploads. A client component only for that `onError`.
 *
 * `object-contain` because most logos are wide wordmarks, not square marks;
 * letterboxed on white reads as a logo, cropped reads as a mistake.
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
        className="object-contain p-2"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
