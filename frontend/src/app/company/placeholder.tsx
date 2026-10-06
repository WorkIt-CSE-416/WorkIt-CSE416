import type { ComponentType, ReactNode } from "react";

import { ArrowLeftIcon, ClockIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The body of a company screen that has a route but not a design yet.
 *
 * Four stubs would otherwise hand-roll the same header and the same empty box,
 * and the point of scaffolding the routes ahead of the screens is that the
 * shell, the nav and the URLs can be reviewed now. Keeping the stub in one
 * place means the four pages differ only by what they say they are for.
 *
 * It lives beside the routes rather than in src/components because nothing
 * outside /company uses it, and because it should be deleted rather than
 * generalised: every page that grows a real layout stops importing it, and the
 * file goes when the last one does.
 *
 * The heading block matches what the built seeker screens use (text-heading
 * over text-body in ink-meta, inside the same max-w-app container and the same
 * gutter as every built company page), so a stub and a finished screen line
 * up when you click between them.
 *
 * THE BODY IS FOR THE RECRUITER WHO LANDS HERE, not for whoever builds the
 * page next: the seeker /settings page's <EmptyState>, saying the page is
 * coming and offering the way back to the Overview. It said "Not built yet:
 * route and shell only." once, which is a note to a developer.
 *
 * It is a <div> rather than a <main>: the company shell's SidebarInset is the
 * <main> for every screen under /company, and a page cannot nest a second one
 * inside it. Seeker pages still own their own, because that shell provides no
 * landmark of its own.
 */
type PlaceholderProps = {
  title: string;
  description: string;
  /** The empty state's glyph. A clock, for "later", unless the page has a
   *  glyph of its own (Settings' gear, say). */
  Icon?: ComponentType<{ className?: string }>;
  /** The empty state's line, for the person using the app: what will be here,
   *  in a sentence. Defaults to a plain "still building it". */
  children?: ReactNode;
};

export function Placeholder({ title, description, Icon = ClockIcon, children }: PlaceholderProps) {
  return (
    <div className="max-w-app mx-auto w-full flex-1 px-4 py-6 sm:px-8 lg:px-12">
      <h1 className="text-heading text-ink">{title}</h1>
      <p className="text-body text-ink-meta mt-1">{description}</p>

      <EmptyState
        Icon={Icon}
        title="Coming Soon"
        className="mt-4"
        action={
          <ButtonLink href="/company" variant="secondary" size="sm">
            <ArrowLeftIcon className="size-3.5" />
            Back to Overview
          </ButtonLink>
        }
      >
        {children ?? "We're still building this page."}
      </EmptyState>
    </div>
  );
}
