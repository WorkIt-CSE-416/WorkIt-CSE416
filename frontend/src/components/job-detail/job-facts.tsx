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
 * Location, job type, salary, work style and level draw the same glyphs as
 * `JobPostingCard` on the seeker feed (see the job facts note in
 * components/icons.tsx), because this is the expanded view of the same
 * posting that card is a row for, and a detail page that describes a job
 * differently than its own card does is the inconsistency a "detail" view
 * exists to resolve, not add. The sixth fact is when it starts.
 */
export function JobFacts({ posting }: { posting: JobPosting }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      <Fact Icon={PinIcon}>{posting.locationCity}</Fact>
      <Fact Icon={BriefcaseIcon}>{posting.jobType}</Fact>
      <Fact Icon={CoinIcon}>{posting.salary}</Fact>
      <Fact Icon={workStyleIcon(posting.workStyle)}>{posting.workStyle}</Fact>
      <Fact Icon={LevelIcon}>{posting.level}</Fact>
      <Fact Icon={CalendarIcon}>{posting.starts}</Fact>
    </div>
  );
}
