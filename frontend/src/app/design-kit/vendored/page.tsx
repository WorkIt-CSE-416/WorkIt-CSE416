import { SECTIONS } from "../data";
import { MatchBadge } from "@/components/match-badge";
import { Skeleton } from "@/components/shadcn/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { Button } from "@/components/ui/button";

import { DialogSpecimen, DropdownSpecimen, SwitchSpecimen } from "../interactive";
import { CheckboxStates, PopoverSpecimen } from "../parts";
import { KitPage, Row } from "../specimen";

export const metadata = { title: SECTIONS.vendored.title };

export default function VendoredPage() {
  return (
    <KitPage {...SECTIONS.vendored}>
      <div>
        <Row
          name="<Dialog>"
          role="Focus trap, Escape to close, scroll lock, focus restored on close"
        >
          <DialogSpecimen />
        </Row>
        <Row
          name="<DropdownMenu>"
          role="Roving focus, typeahead, arrow-key navigation; rows are medium, like every control"
        >
          <DropdownSpecimen />
        </Row>
        <Row name="<Switch>" role="An on/off setting (Settings' Notifications)">
          <SwitchSpecimen />
        </Row>
        <Row
          name="<Skeleton>"
          role="A wait, at the height of what replaces it: see-through ink (bg-ink/6), so it shows on white and on the grey ground"
        >
          <div aria-hidden="true" className="flex w-full max-w-sm flex-col gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </Row>
        <Row
          name="<Tooltip>"
          role="A short line on hover or focus; IconButton draws one from its label"
        >
          <Tooltip>
            <TooltipTrigger render={<Button variant="secondary" size="sm" />}>Copy</TooltipTrigger>
            <TooltipContent>Copy the link</TooltipContent>
          </Tooltip>
        </Row>
        <Row
          name="<Checkbox>"
          role="One yes or no inside a form, its label beside it (Create Event's All Day). Disabled does not fade yet: Base UI draws a span, which its disabled: classes never match"
        >
          <CheckboxStates />
        </Row>
        <Row
          name="<Popover>"
          role="A small question asked in place, under its trigger (Delete on a resume)"
        >
          <PopoverSpecimen />
        </Row>
        <Row name="<Table>" role="A plain table: Auto Apply's two tables, which add sort headings">
          <div className="border-border-subtle bg-panel rounded-card w-full overflow-hidden border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Software Engineer Intern</TableCell>
                  <TableCell>
                    <MatchBadge score={92} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Data Analyst, New Grad</TableCell>
                  <TableCell>
                    <MatchBadge score={71} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Row>
      </div>
    </KitPage>
  );
}
