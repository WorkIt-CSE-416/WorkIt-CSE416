import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { STAGE_TONE, type Stage } from "./applicants/data";
import { RECENT_APPLICANTS } from "./data";

/**
 * The arrivals feed, as a table.
 *
 * IT WAS A LIST OF CARDS AND IT IS A TABLE NOW because every row carries the
 * same four facts, and four facts repeated down a page are columns whether or
 * not they are drawn as columns. A reader comparing match scores across four
 * applicants had to find the number in a different horizontal position on every
 * row; in a column they are already stacked.
 *
 * NOT ./table.tsx, DELIBERATELY. That is a TanStack shell with sorting,
 * filtering and row selection, and it is the right thing for the two list
 * screens. Four rows with nothing to sort do not need a table engine, a client
 * boundary or a second filter UI a screen away from the real one at
 * /company/applicants. This stays a server component and renders shadcn's
 * <Table> markup directly, which is the part it actually wanted.
 *
 * The last band on the page on purpose: it is the most tempting block and the
 * least actionable, and a dashboard that opens with a feed becomes a place you
 * scroll rather than a place you clear. See the note in ./page.tsx.
 */

/**
 * The match score, as a bar and a number.
 *
 * A METER AND NOT A PROGRESS BAR, which is why this is eight lines of HTML
 * rather than shadcn's <Progress>. Progress measures a task moving toward
 * completion; a match score is a measurement inside a fixed range that is not
 * going anywhere. The vendored Progress was pulled in with the charts and then
 * removed once that distinction was clear, since it would have put
 * role="progressbar" on a value nothing is progressing through — and forced a
 * client boundary on this table to do it.
 *
 * BRAND AT EVERY SCORE, on the precedent (seeker)/jobs/match-rail.tsx sets and
 * for the same two reasons: green would collide with the board, where green
 * means an offer and nothing else, and a red-to-green ramp would tell a
 * recruiter that a 77% applicant is a bad applicant when they are only a
 * lower-ranked one. Length carries the magnitude; the number carries the rest.
 *
 * The track stays, unlike the bars in ./stage-age.tsx — here there genuinely is
 * a limit, because a percentage is a ratio against one.
 */
function MatchMeter({ score }: { score: number }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      <div
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Match score"
        className="bg-well hidden h-1.5 w-16 overflow-hidden rounded-full sm:block"
      >
        <div className="bg-brand h-full rounded-full" style={{ width: `${score}%` }} />
      </div>

      {/* tabular-nums here and not in a stat tile: this IS a column of
          numbers, which is the case those figures are for. */}
      <span className="text-note text-ink w-9 shrink-0 text-right tabular-nums">{score}%</span>
    </div>
  );
}

/** Hours are what the fixture carries; days are what a reader wants past one.
 *  Moved here with the feed it formats. */
function relative(hoursAgo: number) {
  if (hoursAgo < 1) return "Just now";
  if (hoursAgo < 24) return `${hoursAgo}h ago`;

  const days = Math.round(hoursAgo / 24);

  return days === 1 ? "Yesterday" : `${days}d ago`;
}

/**
 * The stage each arrival is in.
 *
 * RECENT_APPLICANTS does not carry one — it is the feed shape, and a feed row
 * shows who arrived rather than where they got to. The four people in it are
 * the same four at the top of applicants/data.ts, so the stage is read from
 * there by name rather than duplicated into a second fixture that would drift.
 */
const STAGE_BY_NAME: Record<string, Stage> = {
  "Amara Osei": "Interview",
  "Devin Park": "Screening",
  "Rosa Iglesias": "Applied",
  "Tom Whitfield": "Applied",
};

export function ApplicantsPreview() {
  return (
    <div className="border-border-subtle mt-4 overflow-hidden rounded-[8px] border">
      <Table className="min-w-[34rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Applicant</TableHead>
            <TableHead className="px-4">Role</TableHead>
            <TableHead className="px-4">Stage</TableHead>
            <TableHead className="px-4">Applied</TableHead>
            <TableHead className="px-4 text-right">Match</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {RECENT_APPLICANTS.map(({ id, name, role, hoursAgo, match }) => {
            const stage = STAGE_BY_NAME[name];

            return (
              <TableRow key={id}>
                <TableCell className="px-4">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={name} className="size-7 shrink-0 text-[0.625rem]" />
                    <span className="text-label text-ink truncate">{name}</span>
                  </span>
                </TableCell>

                {/* Capped and truncating, on the reasoning ./table.tsx records:
                    content sizes the column, and the cap decides how far
                    content may push before it gives up its tail. */}
                <TableCell className="px-4">
                  <span className="text-note text-ink-meta block max-w-[13rem] truncate">
                    {role}
                  </span>
                </TableCell>

                <TableCell className="px-4">
                  {stage && (
                    <Badge variant="status" tone={STAGE_TONE[stage]}>
                      {stage}
                    </Badge>
                  )}
                </TableCell>

                <TableCell className="text-note text-ink-meta px-4 whitespace-nowrap">
                  {relative(hoursAgo)}
                </TableCell>

                <TableCell className="px-4">
                  <MatchMeter score={match} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
