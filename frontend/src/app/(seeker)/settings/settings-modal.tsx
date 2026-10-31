"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";

import { SECTIONS, SettingsNav, type SectionKey } from "./settings-nav";
import { DiscardDialog, UnsavedChangesProvider, useLeaveGuard } from "./unsaved-changes";

/** The section an address names, /settings/<key>; Personal Details for
 *  bare /settings or anything else. */
function sectionOf(pathname: string): SectionKey {
  const key = pathname.split("/")[2];
  return SECTIONS.find((s) => s.key === key)?.key ?? "personal";
}

/**
 * Settings, always a modal (KAN-364): the title, the section nav fixed on
 * the left (on top below sm), and the section, which alone scrolls.
 *
 * Every section is drawn on the server when the modal opens (./sections.tsx)
 * and stays mounted, hidden when not shown, so switching sections is
 * instant and an unsaved edit in one survives a visit to another. The nav
 * moves the address with `history.replaceState`, which Next's router
 * follows (usePathname), so each section keeps its own address with no
 * navigation, and one history entry stands for the whole modal.
 *
 * Two ways in. A soft navigation from a seeker page (the account menu's
 * Settings) opens it over that page (../@modal/(.)settings), and closing
 * goes back to it. A hard load or a reload of a Settings address opens it
 * over Home (./layout.tsx), and closing goes there (`closeTo`).
 * Escape, the close button and a click outside all close; with unsaved
 * edits they ask first (./unsaved-changes). That question is nested in the
 * modal's content, so the modal's focus trap lets it take focus.
 *
 * The section area is a `@container/main`, as the shell's page is, so the
 * sections' container queries (the name fields' three columns) read the
 * modal's width: the dialog is portalled outside the page.
 */
export function SettingsModal({
  sections,
  closeTo,
}: {
  sections: Record<SectionKey, ReactNode>;
  /** Where closing goes after a hard load, with nothing to go back to. */
  closeTo?: string;
}) {
  return (
    <UnsavedChangesProvider>
      <ModalFrame sections={sections} closeTo={closeTo} />
    </UnsavedChangesProvider>
  );
}

function ModalFrame({
  sections,
  closeTo,
}: {
  sections: Record<SectionKey, ReactNode>;
  closeTo?: string;
}) {
  const router = useRouter();
  const guard = useLeaveGuard();
  const active = sectionOf(usePathname());
  const scroller = useRef<HTMLDivElement>(null);

  function select(key: SectionKey) {
    window.history.replaceState(null, "", `/settings/${key}`);
    scroller.current?.scrollTo({ top: 0 });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        guard(() => (closeTo ? router.replace(closeTo) : router.back()));
      }}
    >
      <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-border-subtle border-b px-6 py-4">
          <DialogTitle className="text-subtitle font-semibold">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Your details, sign-in, notifications, integrations and job preferences.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="border-border-subtle shrink-0 border-b p-3 sm:w-60 sm:border-r sm:border-b-0">
            <SettingsNav active={active} onSelect={select} />
          </div>
          {/* The padding sits on the inner box, not the scroller: a sticky
              Save bar stops at the scroller's padding edge, and with 24px of
              padding there the fields showed through under it. */}
          <div
            ref={scroller}
            className="@container/main min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {SECTIONS.map(({ key }) => (
              <div key={key} hidden={key !== active} className="flex flex-col gap-4 p-4 sm:p-6">
                {sections[key]}
              </div>
            ))}
          </div>
        </div>
        <DiscardDialog />
      </DialogContent>
    </Dialog>
  );
}
