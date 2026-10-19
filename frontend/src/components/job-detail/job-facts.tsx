import type { ComponentType } from "react";

import {
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  LevelIcon,
  PinIcon,
  workStyleIcon,
} from "@/components/icons";
import { Fact } from "@/components/ui/fact";

import type { JobPosting } from "./data";

/**
 * The icon-and-label facts under the header's title, laid out as the feed
 * card's (`JobPostingCard`, KAN-157): two fixed rows of three, location, job
 * type and salary, then work style, level and when it starts, each in the same
 * column on every job. A fact the posting doesn't state leaves its slot empty
 * rather than letting the next fact slide into it. Under 448px of card it is
 * two columns and the empty slots close up, as the card's do.
 *
 * It used to be two columns with empty facts left out, so the six moved around
 * from job to job (Neuralink's location, salary and level stacked in one
 * column) and read differently from the card the seeker had just clicked
 * (2026-10-17). Plain, no rule or fill of its own: `JobDetailHeader` supplies
 * both.
 *
 * Location, job type, salary, work style and level draw the same glyphs as
 * `JobPostingCard` (see the job facts note in components/icons.tsx), because
 * this is the expanded view of the same posting that card is a row for.
 */
export function JobFacts({ posting }: { posting: JobPosting }) {
  return (
    <div className="text-note grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-3">
      <JobFact Icon={PinIcon} value={posting.locationCity} />
      <JobFact Icon={BriefcaseIcon} value={posting.jobType} />
      <JobFact Icon={CoinIcon} value={posting.salary} />
      <JobFact Icon={workStyleIcon(posting.workStyle)} value={posting.workStyle} />
      <JobFact Icon={LevelIcon} value={posting.level} />
      <JobFact Icon={CalendarIcon} value={posting.starts} />
    </div>
  );
}

/** One slot: a stated fact is its glyph and value, with the whole value in a
 *  title in case its column cuts it short. An unstated one is the same slot
 *  drawn invisibly, so its row keeps its height and the facts after it keep
 *  their columns; under 448px of card it steps out of the grid and they close
 *  up, as the feed card's `FactSlot` does. */
function JobFact({ Icon, value }: { Icon: ComponentType<{ className?: string }>; value: string }) {
  if (!value) {
    return (
      <span aria-hidden="true" className="@max-md:hidden">
        <Fact Icon={Icon} className="invisible">
          {" "}
        </Fact>
      </span>
    );
  }
  return (
    <Fact Icon={Icon}>
      <span title={value}>{value}</span>
    </Fact>
  );
}
