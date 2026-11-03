import type { ComponentType, ReactNode } from "react";

import { ArrowLeftIcon, ClockIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { COMPANY_PAGE } from "./frame";

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
 * The bar holds the section's title (./bar-title.tsx), so a section's own stub
 * draws no heading. A stub under a section (one applicant) passes `title`, its
 * h1, since the bar's line there names the section, not the page. Either way
 * it sits in the column every company page uses (./frame.ts), so a stub and a
 * finished screen line up when you click between them.
 *
 * THE BODY IS FOR THE RECRUITER WHO LANDS HERE, not for whoever builds the
 * page next: an <EmptyState> saying the page is coming and offering the way
 * back to the Overview. It said "Not built yet:
 * route and shell only." once, which is a note to a developer.
 *
 * It is a <div> rather than a <main>: the company shell's SidebarInset is the
 * <main> for every screen under /company, and a page cannot nest a second one
 * inside it.
 */
type PlaceholderProps = {
  /** The page's h1, for a page under a section only. */
  title?: string;
  /** The empty state's glyph. A clock, for "later", unless the page has a
   *  glyph of its own (Settings' gear, say). */
  Icon?: ComponentType<{ className?: string }>;
  /** The empty state's line, for the person using the app: what will be here,
   *  in a sentence. Defaults to a plain "still building it". */
  children?: ReactNode;
};

export function Placeholder({ title, Icon = ClockIcon, children }: PlaceholderProps) {
  return (
    <div className={COMPANY_PAGE}>
      {title && <h1 className="text-heading text-ink mb-4">{title}</h1>}

      <EmptyState
        Icon={Icon}
        title="Coming Soon"
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
