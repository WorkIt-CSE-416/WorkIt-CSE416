"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { rememberReturnTo } from "../jobs/[jobId]/page-actions";

/**
 * A Top Matches row's link to its job posting page. The click remembers the
 * Dashboard, range and all, as where that page's Back returns
 * (rememberReturnTo), as a tailored resume's link does from /resumes: Back
 * went to the Jobs page, which the seeker had not come from. Set on the
 * click, not the visit, so a job opened from anywhere else after a look at
 * the Dashboard does not go Back here.
 */
export function TopMatchLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        rememberReturnTo(window.location.pathname + window.location.search);
        props.onClick?.(e);
      }}
    />
  );
}
