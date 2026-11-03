"use client";

import { useState } from "react";

import { FieldFacet } from "@/components/field-facet";
import { BriefcaseIcon } from "@/components/icons";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/shadcn/popover";
import { SortMenu } from "@/components/sort-menu";
import { Button } from "@/components/ui/button";
import { Select, SelectCheckboxItem, SelectContent, SelectTrigger } from "@/components/ui/select";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { StateCell, StateCells } from "./states";

/**
 * Specimens added with KAN-564 for parts the kit had no page for, the most
 * used first. Client components because each holds a pick or takes a
 * function, which a server page cannot pass.
 */

const TYPES = [
  { value: "internship", label: "Internship" },
  { value: "new-grad", label: "New Grad" },
  { value: "co-op", label: "Co-op" },
];

/** The filter dropdown in each state: no pick, holding a pick (the brand
 *  tint, shown only while closed), focused, and disabled (no options). */
export function FieldFacetStates() {
  const [empty, setEmpty] = useState<string[]>([]);
  const [picked, setPicked] = useState(["internship"]);

  return (
    <StateCells>
      <StateCell label="No Pick">
        <FieldFacet
          label="Job Type"
          Icon={BriefcaseIcon}
          options={TYPES}
          values={empty}
          onChange={setEmpty}
        />
      </StateCell>
      <StateCell label="Holding a Pick">
        <FieldFacet
          label="Job Type"
          Icon={BriefcaseIcon}
          options={TYPES}
          values={picked}
          onChange={setPicked}
        />
      </StateCell>
      <StateCell label="Hover" state="hover">
        <FieldFacet
          label="Job Type"
          Icon={BriefcaseIcon}
          options={TYPES}
          values={[]}
          onChange={() => {}}
        />
      </StateCell>
      <StateCell label="Focus" state="focus">
        <FieldFacet
          label="Job Type"
          Icon={BriefcaseIcon}
          options={TYPES}
          values={[]}
          onChange={() => {}}
        />
      </StateCell>
      <StateCell label="No Options">
        <FieldFacet
          label="Job Type"
          Icon={BriefcaseIcon}
          options={[]}
          values={[]}
          onChange={() => {}}
        />
      </StateCell>
    </StateCells>
  );
}

const SORTS = [
  { value: "edited", label: "Last Edited" },
  { value: "oldest", label: "Oldest First" },
  { value: "name", label: "Name, A to Z" },
] as const;

export function SortMenuSpecimen() {
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("edited");
  return <SortMenu value={sort} options={[...SORTS]} onChange={setSort} />;
}

const ROLES = ["Software Engineer", "Data Scientist", "Product Manager"];

/** ui/select's own row for a `multiple` Select, under a WorkIt field box. */
export function MultiSelectSpecimen() {
  const [roles, setRoles] = useState<string[]>(["Software Engineer"]);
  return (
    <div className="w-64">
      <Select multiple value={roles} onValueChange={setRoles}>
        <SelectTrigger
          aria-label="Roles"
          className={cn(FIELD_CONTROL, "h-auto py-2.5 pr-3 pl-3.5 data-[size=default]:h-auto")}
        >
          <span className="truncate">
            {roles.length === 0 ? "Any role" : `${roles.length} picked`}
          </span>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((role) => (
            <SelectCheckboxItem key={role} value={role}>
              {role}
            </SelectCheckboxItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A checkbox with its label, as Create Event's All Day draws it. */
function LabelledCheckbox({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="text-label text-ink flex w-fit cursor-pointer items-center gap-2">
      <Checkbox
        className="border-ink-meta"
        checked={checked}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
        disabled={disabled}
      />
      All Day
    </label>
  );
}

export function CheckboxStates() {
  const [on, setOn] = useState(true);
  return (
    <StateCells>
      <StateCell label="Off">
        <LabelledCheckbox checked={false} />
      </StateCell>
      <StateCell label="On">
        <LabelledCheckbox checked={on} onCheckedChange={setOn} />
      </StateCell>
      <StateCell label="Focus" state="focus">
        <LabelledCheckbox checked={false} />
      </StateCell>
      <StateCell label="Disabled">
        <LabelledCheckbox checked disabled />
      </StateCell>
    </StateCells>
  );
}

/** A small question asked in place, as Delete asks under a resume's trash. */
export function PopoverSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="secondary" size="sm" />}>Delete</PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-72 gap-3">
        <PopoverHeader>
          <PopoverTitle>Delete This Resume?</PopoverTitle>
          <PopoverDescription>Applications sent with it keep their copy.</PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Keep It
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setOpen(false)}>
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
