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
 * The icon-and-label facts under the header's title, always two columns —
 * the inspiration screenshot's three rows of two, not a wrapping row. Plain,
 * no rule or fill of its own: `JobDetailHeader` supplies both, since the rule
 * now separates the title from this row and the rail beside it together,
 * rather than each owning a fragment of it.
 *
 * Capped at the same 68ch measure as the company line under it, counted in
 * that line's text-note so the two end on one edge. Without a cap a job with
 * no rail (nothing has scored it) spread its two columns across the whole
 * card, about 455px apart, so a value and its neighbour no longer read as a
 * pair. With the cap the facts sit the same way whether a rail is beside them
 * or not.
 *
 * Location, job type, salary, work style and level draw the same glyphs as
 * `JobPostingCard` on the seeker feed (see the job facts note in
 * components/icons.tsx), because this is the expanded view of the same
 * posting that card is a row for, and a detail page that describes a job
 * differently than its own card does is the inconsistency a "detail" view
 * exists to resolve, not add. The sixth fact is when it starts.
 */
export function JobFacts({ posting }: { posting: JobPosting }) {
  return (
    <div className="text-note grid max-w-[68ch] grid-cols-2 gap-x-6 gap-y-2">
      <JobFact Icon={PinIcon} value={posting.locationCity} />
      <JobFact Icon={BriefcaseIcon} value={posting.jobType} />
      <JobFact Icon={CoinIcon} value={posting.salary} />
      <JobFact Icon={workStyleIcon(posting.workStyle)} value={posting.workStyle} />
      <JobFact Icon={LevelIcon} value={posting.level} />
      <JobFact Icon={CalendarIcon} value={posting.starts} />
    </div>
  );
}

/** A `Fact` whose value also rides in a title, so one its column truncates
 *  (a long live location on a phone) can still be read whole on hover. */
function JobFact({ Icon, value }: { Icon: ComponentType<{ className?: string }>; value: string }) {
  // A live posting can leave a fact unstated (no salary, no start date); its
  // place is left out rather than drawn as a glyph beside nothing.
  if (!value) return null;
  return (
    <Fact Icon={Icon}>
      <span title={value}>{value}</span>
    </Fact>
  );
}
