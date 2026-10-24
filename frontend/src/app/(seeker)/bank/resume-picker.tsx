"use client";

import { StarIcon } from "@phosphor-icons/react/ssr";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import type { BankResume } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

import { NONE, type Pick } from "./holdings";

const GROUPS: { label: string; kinds: BankResume["kind"][] }[] = [
  { label: "Uploaded", kinds: ["uploaded"] },
  { label: "Built", kinds: ["base", "tailored"] },
];

function label(resume: BankResume): string {
  return resume.posting ? `${resume.name} · ${resume.posting}` : resume.name;
}

/**
 * The Experiences view's resume dropdown (KAN-343): every uploaded and built
 * resume, grouped, in the API's order, the starred one marked as on the
 * Resumes view, then Not From an Upload while anything no upload owns
 * exists (or it is the pick). All Experiences went with ADR 0005. Drawn as
 * <SelectField>'s trigger is, with its label beside it.
 */
export function ResumePicker({
  resumes,
  value,
  showNone,
  onChange,
}: {
  resumes: BankResume[];
  value: Pick;
  /** Whether any entry or skill is owned by no upload. */
  showNone: boolean;
  onChange: (pick: Pick) => void;
}) {
  const none = showNone || value === NONE;
  const items = [
    ...resumes.map((r) => ({ value: r.id, label: label(r) })),
    ...(none ? [{ value: NONE, label: "Not From an Upload" }] : []),
  ];
  // A group with no resume is left out.
  const groups = GROUPS.map(({ label: heading, kinds }) => ({
    heading,
    members: resumes.filter((r) => kinds.includes(r.kind)),
  })).filter((g) => g.members.length > 0);
  const labelOf = (pick: Pick) => items.find((item) => item.value === pick)?.label;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label id="bank-resume-label" htmlFor="bank-resume" className={FIELD_LABEL}>
        Show
      </label>
      <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
        {/* The height override is written twice, as in <SelectField>, so
            cn() drops the stock trigger's pinned 32px. A long resume name
            ends in an ellipsis (KAN-351), with the whole of it on hover:
            the stock value is a flex box, which never draws one, so the
            label goes in a span of its own. */}
        <SelectTrigger
          id="bank-resume"
          aria-labelledby="bank-resume-label"
          title={labelOf(value)}
          className={cn(
            FIELD_CONTROL,
            "h-auto w-auto max-w-full min-w-56 py-2 pr-3 pl-3.5 data-[size=default]:h-auto sm:max-w-md",
          )}
        >
          <SelectValue>
            {(pick: Pick) => <span className="truncate">{labelOf(pick)}</span>}
          </SelectValue>
        </SelectTrigger>
        {/* The list is as wide as its longest name allows, never narrower
            than the trigger nor wider than the screen or 28rem. */}
        <SelectContent className="w-auto max-w-[min(var(--available-width),28rem)] min-w-(--anchor-width)">
          {groups.map(({ heading, members }, i) => {
            return (
              <SelectGroup key={heading}>
                {i > 0 && <SelectSeparator />}
                <SelectLabel>{heading}</SelectLabel>
                {members.map((r) => (
                  // The stock item text never shrinks; here it may, so the
                  // name inside it can truncate.
                  <SelectItem key={r.id} value={r.id} className="*:first:min-w-0 *:first:shrink">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {r.primary && (
                        <>
                          <StarIcon
                            aria-hidden
                            className="text-brand size-3.5 shrink-0"
                            weight="fill"
                          />
                          <span className="sr-only">Primary resume:</span>
                        </>
                      )}
                      <span className="truncate" title={label(r)}>
                        {label(r)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
          {/* In a group of its own, so it takes the groups' padding and
              lines up with the resumes above it. */}
          {none && (
            <SelectGroup>
              <SelectSeparator />
              <SelectItem value={NONE}>Not From an Upload</SelectItem>
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
