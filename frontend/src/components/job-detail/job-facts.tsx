import {
  AwardIcon,
  BriefcaseIcon,
  CalendarIcon,
  CoinIcon,
  MonitorIcon,
  PinIcon,
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
 * The same six facts, in the same order, as `RecommendationCard`'s grid on
 * the seeker feed — location, job type, salary, work style, level, starts —
 * because this is the expanded view of the same posting that card is a row
 * for, and a detail page that describes a job differently than its own card
 * does is the inconsistency a "detail" view exists to resolve, not add.
 */
export function JobFacts({ posting }: { posting: JobPosting }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
      <Fact Icon={PinIcon}>{posting.locationCity}</Fact>
      <Fact Icon={BriefcaseIcon}>{posting.jobType}</Fact>
      <Fact Icon={CoinIcon}>{posting.salary}</Fact>
      <Fact Icon={MonitorIcon}>{posting.workStyle}</Fact>
      <Fact Icon={AwardIcon}>{posting.level}</Fact>
      <Fact Icon={CalendarIcon}>{posting.starts}</Fact>
    </div>
  );
}
