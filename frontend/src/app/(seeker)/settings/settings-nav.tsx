"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ComponentType } from "react";

import { BellIcon, BriefcaseIcon, LockIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/** Settings' sections, in nav order. Each is its own route, so a link can
 *  open one and each page loads only its own data. */
const SECTIONS: { href: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { href: "/settings/personal", label: "Personal Details", Icon: UserIcon },
  { href: "/settings/security", label: "Sign-In & Security", Icon: LockIcon },
  { href: "/settings/notifications", label: "Notifications", Icon: BellIcon },
  { href: "/settings/preferences", label: "Job Preferences", Icon: BriefcaseIcon },
];

/**
 * The section nav: a column beside the section from @3xl/main, a row that
 * scrolls sideways above it below that. One list in both places rather than
 * a segmented control on a phone: four labels as long as "Sign-In &
 * Security" do not fit a segmented control's equal widths at 375px.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const current = useRef<HTMLAnchorElement>(null);

  // Below @3xl/main the row scrolls sideways, and a section near its end
  // (Job Preferences on a phone) opened out of view.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Settings">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 @3xl/main:mx-0 @3xl/main:flex-col @3xl/main:overflow-visible @3xl/main:px-0">
        {SECTIONS.map(({ href, label, Icon }) => {
          const isCurrent = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                ref={isCurrent ? current : undefined}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "rounded-control text-label focus-visible:ring-brand-ring flex items-center gap-2 px-3 py-2 whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  isCurrent
                    ? "bg-brand-tint text-brand font-semibold"
                    : "text-ink-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
