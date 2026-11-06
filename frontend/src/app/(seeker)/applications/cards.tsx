import Link from "next/link";

import { MatchBadge } from "@/components/match-badge";
import { CompanyIcon, PinIcon } from "@/components/icons";
import { Reflow } from "@/components/reflow";
import { Card } from "@/components/ui/card";

import { isClosedSaved, type Application } from "../tracker";
import { StageMenu } from "./[jobId]/tracker-controls";
import { ApplicationTile } from "./application-tile";
import { ClosedSavedControl } from "./closed-saved";
import { applicationHref } from "./query";
import { StageSteps } from "./stage-steps";
import { TailoredChip } from "@/components/tailored-chip";
import { ViewResumeButton } from "./view-resume";

/**
 * The applications as a list of wide cards, one per row, after Simplify's
 * tracker (2026-11-05): who and what on the left, the stages as a line of
 * steps in the middle (./stage-steps.tsx), and the stage menu on the right.
 * It replaced a grid of small cards (2, 3 or 4 a row) that the user found
 * harder to scan than a list; this is the list's richer twin, not a second
 * layout to read.
 *
 * WorkIt's own fields, not Simplify's: the company tile, the role and the
 * company, where the job is and how it is worked, the Jobs page's match
 * score, and View Resume where a resume was sent through WorkIt (KAN-267).
 * Simplify's heart (a favourite) has no WorkIt counterpart, so there is none.
 *
 * THE STAGE MENU CHANGES THE STAGE HERE (../[jobId]/tracker-controls.tsx's
 * StageMenu, the same one as on the application's page), so a student moves
 * an application without opening it. A saved job's menu reads "Saved".
 *
 * Like a list row, the whole card opens the application's own page
 * (./[jobId]): the role is the link, stretched over the card. View Resume
 * and the stage menu sit above that link (relative, z-10), so a
 * click on them, or a near miss in the gap around them, never opens it.
 *
 * THREE LAYOUTS BY THE CARD'S OWN WIDTH (`@container`): a card 1152px wide
 * or more (`@6xl`) puts the three parts on one row, Simplify's layout, with
 * the steps and the controls in fixed columns so every card's steps line up
 * under the next (an `auto` controls column moved them with each card's
 * View Resume); from
 * 576px (`@xl`) the role and the controls share the first line and the steps
 * run the card's width under them; narrower, everything stacks. One row
 * from 768px left the role about 100px beside View Resume, the match and the
 * menu, so the role, the company and the place were cut to nothing. The
 * match pill now sits after the role, not with the controls.
 */
function ApplicationCard({
  item,
  href,
  delay,
}: {
  item: Application;
  href: string;
  delay: number;
}) {
  const where = [item.location, item.workModel].filter(Boolean).join(" · ");
  // A saved job whose posting closed: a grey logo and Remove in place of the
  // stage menu (./closed-saved.tsx). An applied one looks as any other.
  const closed = isClosedSaved(item);

  return (
    <Card
      as="li"
      padding="none"
      // Rises in after the cards before it and lifts under the pointer.
      className="hover:border-ink-meta hover:shadow-lift ease-glide animate-rise @container relative transition-[box-shadow,border-color] duration-200"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="grid grid-cols-1 gap-4 p-4 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center @6xl:grid-cols-[minmax(0,1fr)_24rem_24rem] @6xl:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <ApplicationTile application={item} size="md" muted={closed} />
          <div className="min-w-0">
            {/* The match sits right after the role, the first thing read,
                as how good a fit the job is (2026-11-05); beside the stage
                menu it read as part of the controls. */}
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-subtitle text-ink min-w-0 truncate leading-5">
                <Link
                  href={href}
                  title={item.role}
                  className="after:rounded-card focus-visible:after:ring-brand-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2"
                >
                  {item.role}
                </Link>
              </h2>
              {item.match != null && <MatchBadge score={item.match} />}
            </div>
            <p className="text-note text-ink-meta mt-1 flex items-center gap-1.5">
              <CompanyIcon className="size-3.5 shrink-0" />
              <span className="truncate">{item.company}</span>
            </p>
            {where && (
              <p className="text-note text-ink-meta mt-0.5 flex items-center gap-1.5">
                <PinIcon className="size-3.5 shrink-0" />
                <span className="truncate">{where}</span>
              </p>
            )}
            {/* A resume made for this job, ready to send (KAN-217). */}
            {item.tailored && (
              <div className="mt-1.5">
                <TailoredChip />
              </div>
            )}
          </div>
        </div>

        <StageSteps
          app={item}
          className="@xl:col-span-2 @xl:row-start-2 @6xl:col-span-1 @6xl:col-start-2 @6xl:row-start-1"
        />

        <div className="relative z-10 flex flex-wrap items-center gap-2 @xl:col-start-2 @xl:row-start-1 @xl:justify-end @6xl:col-start-3 @6xl:flex-nowrap">
          {item.sentResume && <ViewResumeButton resume={item.sentResume} />}
          {closed ? (
            <ClosedSavedControl app={item} className="w-40 shrink-0" />
          ) : (
            <StageMenu
              jobId={item.id}
              stage={item.stage}
              placeholder="Saved"
              className="w-40 shrink-0"
            />
          )}
        </div>
      </div>
    </Card>
  );
}

export function ApplicationsCards({ applications }: { applications: Application[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {applications.map((item, i) => (
        <Reflow key={item.id}>
          <ApplicationCard
            item={item}
            href={applicationHref(item.id)}
            // 30ms apart, capped at the eighth card so a long list never waits.
            delay={Math.min(i, 8) * 30}
          />
        </Reflow>
      ))}
    </ul>
  );
}
