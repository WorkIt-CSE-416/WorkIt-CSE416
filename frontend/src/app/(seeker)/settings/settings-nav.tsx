"use client";

import { useEffect, useRef, type ComponentType } from "react";

import { BellIcon, BriefcaseIcon, LockIcon, MailIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/** Settings' sections, in nav order. Each has its own address,
 *  /settings/<key>, which the modal keeps in the address bar. */
export const SECTIONS = [
  { key: "personal", label: "Personal Details", Icon: UserIcon },
  { key: "security", label: "Sign-In & Security", Icon: LockIcon },
  { key: "notifications", label: "Notifications", Icon: BellIcon },
  { key: "email", label: "Email", Icon: MailIcon },
  { key: "preferences", label: "Job Preferences", Icon: BriefcaseIcon },
] as const satisfies readonly {
  key: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[];

export type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * The modal's section nav: a column beside the section from sm, a row that
 * scrolls sideways above it on a phone, where four labels as long as
 * "Sign-In & Security" do not fit a segmented control's equal widths. Each
 * item is a real link to its address (open it in a new tab, copy it), but a
 * plain click switches the section in place (`onSelect`), with no
 * navigation, so the other sections and their unsaved edits stay as they
 * were (../settings-modal.tsx).
 */
export function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
}) {
  const current = useRef<HTMLAnchorElement>(null);

  // On a phone the row scrolls sideways, and a section near its end (Job
  // Preferences) opened out of view.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav aria-label="Settings">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0">
        {SECTIONS.map(({ key, label, Icon }) => {
          const isCurrent = key === active;
          return (
            <li key={key} className="shrink-0">
              <a
                href={`/settings/${key}`}
                ref={isCurrent ? current : undefined}
                aria-current={isCurrent ? "page" : undefined}
                onClick={(event) => {
                  // A modified click still opens the link in a new tab.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onSelect(key);
                }}
                className={cn(
                  "rounded-control text-label focus-visible:ring-brand-ring flex items-center gap-2 px-3 py-2 whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  isCurrent
                    ? "bg-brand-tint text-brand font-semibold"
                    : "text-ink-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
