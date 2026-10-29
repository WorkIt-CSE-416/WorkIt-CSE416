"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DateField } from "@/components/date-field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { When } from "../../local-time";
import { setApplyBy } from "../actions";

/**
 * A saved job's Apply by (KAN-429): the student's own day to apply by,
 * which the Calendar and Upcoming show. It is theirs, not the posting's: a
 * student applies well before a closing date, and most scraped postings
 * publish none. The posting's own closing date, where it has one, is named
 * beside it as the hard limit. Saved on a pick (no Save button), and
 * cleared with the picker's Clear; a refused save puts the field back and says so.
 * Shown only until the job is applied to, as the Calendar shows it.
 */
export function ApplyBy({
  jobId,
  applyBy,
  closesAt,
}: {
  jobId: string;
  /** "YYYY-MM-DD", or null while none is set. */
  applyBy: string | null;
  /** The posting's closing instant, where it says. */
  closesAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(applyBy ?? "");

  function save(next: string) {
    const before = value;
    setValue(next);
    start(async () => {
      const { error } = await setApplyBy(jobId, next || null);
      if (error) {
        setValue(before);
        toast.show({ message: `Couldn't save your Apply By date. ${error}` });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className={cn("mt-4 flex flex-wrap items-center gap-x-3 gap-y-2", pending && "opacity-70")}
    >
      {/* WorkIt's own date picker (@/components/date-field), never the
          browser's: a native date input opened the OS's picker, in none of
          WorkIt's type or colours. Clear is in its popover. */}
      <div className="w-56">
        <DateField
          id="apply-by"
          label="Apply By"
          value={value}
          onValueChange={save}
          placeholder="Pick a day"
          clearable
          disabled={pending}
        />
      </div>
      <p className="text-note text-ink-meta basis-full">
        {closesAt ? (
          <>
            The posting closes <When at={closesAt} />. Pick a day before it to apply by.
          </>
        ) : (
          "The posting gives no closing date. Pick the day you mean to apply by."
        )}
      </p>
    </div>
  );
}
