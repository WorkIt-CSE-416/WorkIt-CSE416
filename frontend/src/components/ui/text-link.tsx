import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * A brand-coloured link inside running text.
 *
 * Distinct from <Button variant="ghost">, which is an action affordance in a
 * card header: this one inherits its type size from the sentence around it and
 * uses the softer focus radius that suits a target the height of one line.
 */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "text-brand hover:text-brand-hover focus-visible:ring-brand-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
