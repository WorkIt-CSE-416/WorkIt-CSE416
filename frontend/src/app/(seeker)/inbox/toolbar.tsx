"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  CheckIcon,
  EnvelopeOpenIcon,
  EnvelopeSimpleIcon,
  ListPlusIcon,
  MinusIcon,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ChevronDownIcon, EllipsisIcon } from "@/components/icons";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

import { acceptUpdate, dismissUpdate } from "../applications/actions";
import type { Email } from "../applications/tracked";
import type { EmailJob } from "./email-row";

/** A toolbar action's square: Gmail's 32px glyph buttons. */
const TOOL = "size-8 rounded-control hover:bg-hover";

/**
 * The Inbox's toolbar over the list (KAN-427), Gmail's: a select box whose
 * click picks every shown email, or unpicks while any is picked, beside a
 * menu that picks by state (All, None, Read, Unread). While
 * nothing is picked it holds Refresh and More (Mark All as Read); while
 * some are, the count and what can be done to them: Add to Tracker and Set
 * Aside (the status banner's Confirm and Cancel, on the picked ones that need
 * review), and one read toggle, Mark as Read while any picked is unread,
 * else Mark as Unread, as Gmail swaps them. The right end counts the
 * emails shown.
 *
 * Add to Tracker skips a picked email that matched no job: it needs a job
 * picked, which only its own card asks (./reading-pane.tsx), and the toast
 * says how many it left.
 */
export function InboxToolbar({
  shown,
  checked,
  total,
  isRead,
  onPick,
  onMark,
  onDone,
  className,
}: {
  shown: Email[];
  checked: Email[];
  total: number;
  isRead: (email: Email) => boolean;
  onPick: (ids: string[]) => void;
  onMark: (ids: string[], read: boolean) => void;
  onDone: () => void;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [refreshing, startRefresh] = useTransition();
  const [deciding, startDeciding] = useTransition();
  const all = shown.length > 0 && checked.length === shown.length;
  const some = checked.length > 0;
  const ids = (emails: Email[]) => emails.map((email) => email.id);
  const waiting = checked.filter((email) => email.status === "proposed");
  const addable = waiting.filter((email) => email.jobId);
  const anyUnread = checked.some((email) => !isRead(email));

  function decide(
    emails: Email[],
    run: (email: Email) => Promise<{ error: string | null }>,
    verb: string,
  ) {
    startDeciding(async () => {
      const results = await Promise.all(emails.map(run));
      const failed = results.filter((result) => result.error).length;
      const skipped = verb === "added" ? waiting.length - addable.length : 0;
      const notes = [
        failed > 0 && `${failed} couldn't be ${verb}.`,
        skipped > 0 && `${skipped} need a job picked: open each to link it.`,
      ].filter(Boolean);
      if (notes.length) toast.show({ message: notes.join(" ") });
      onDone();
      router.refresh();
    });
  }

  return (
    <div
      role="toolbar"
      aria-label="Inbox Actions"
      className={cn(
        "border-border-subtle flex min-h-12 items-center gap-1 border-b px-2 py-1.5",
        className,
      )}
    >
      <div className="flex items-center">
        <span className="flex size-8 items-center justify-center">
          <CheckboxPrimitive.Root
            checked={all}
            indeterminate={some && !all}
            disabled={shown.length === 0}
            onCheckedChange={() => onPick(some ? [] : ids(shown))}
            aria-label={some ? "Unselect All" : "Select All"}
            className="border-ink-meta data-checked:bg-brand data-checked:border-brand data-indeterminate:bg-brand data-indeterminate:border-brand text-on-brand focus-visible:ring-brand-ring flex size-4 items-center justify-center rounded-[4px] border transition-colors outline-none focus-visible:ring-2 disabled:opacity-50"
          >
            <CheckboxPrimitive.Indicator
              keepMounted={false}
              className="grid place-content-center [&>svg]:size-3"
            >
              {some && !all ? <MinusIcon weight="bold" /> : <CheckIcon weight="bold" />}
            </CheckboxPrimitive.Indicator>
          </CheckboxPrimitive.Root>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Select By"
            disabled={shown.length === 0}
            className="text-ink-meta hover:text-ink hover:bg-hover rounded-control focus-visible:ring-brand-ring -ml-1 flex h-8 w-5 items-center justify-center focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            <ChevronDownIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={() => onPick(ids(shown))}>All</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPick([])}>None</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPick(ids(shown.filter(isRead)))}>
              Read
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPick(ids(shown.filter((e) => !isRead(e))))}>
              Unread
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {some ? (
        <>
          <span className="text-meta text-ink mr-2 ml-1 tabular-nums">
            {checked.length} selected
          </span>
          <IconButton
            label="Add to Tracker"
            className={TOOL}
            disabled={addable.length === 0 || deciding}
            onClick={() => decide(addable, (email) => acceptUpdate(email.id, null), "added")}
          >
            <ListPlusIcon aria-hidden className="size-[18px]" />
          </IconButton>
          <IconButton
            label="Set Aside"
            className={TOOL}
            disabled={waiting.length === 0 || deciding}
            onClick={() => decide(waiting, (email) => dismissUpdate(email.id), "set aside")}
          >
            <ArchiveIcon aria-hidden className="size-[18px]" />
          </IconButton>
          <IconButton
            label={anyUnread ? "Mark as Read" : "Mark as Unread"}
            className={TOOL}
            onClick={() => onMark(ids(checked), anyUnread)}
          >
            {anyUnread ? (
              <EnvelopeOpenIcon aria-hidden className="size-[18px]" />
            ) : (
              <EnvelopeSimpleIcon aria-hidden className="size-[18px]" />
            )}
          </IconButton>
        </>
      ) : (
        <>
          <IconButton
            label="Refresh"
            className={TOOL}
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <ArrowClockwiseIcon
              aria-hidden
              className={cn("size-[18px]", refreshing && "animate-spin")}
            />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More"
              className={cn(
                TOOL,
                "text-ink-meta hover:text-ink focus-visible:ring-brand-ring flex items-center justify-center focus-visible:ring-2 focus-visible:outline-none",
              )}
            >
              <EllipsisIcon className="size-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem
                disabled={!shown.some((email) => !isRead(email))}
                onClick={() => onMark(ids(shown.filter((e) => !isRead(e))), true)}
              >
                Mark All as Read
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      <span className="text-note text-ink-meta ml-auto pr-2 tabular-nums">
        {shown.length === total ? `${total} emails` : `${shown.length} of ${total}`}
      </span>
    </div>
  );
}

/** A row's select box, beside its link: a box inside a link would open the
 *  email on every pick. Lined up with the row's logo. */
export function RowCheck({
  email,
  job,
  checked,
  onChange,
}: {
  email: Email;
  job: EmailJob | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="flex shrink-0 self-stretch pt-[22px] pl-4">
      <Checkbox
        className="border-ink-meta"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        aria-label={`Select ${job ? job.company : "Unknown sender"}: ${email.title}`}
      />
    </span>
  );
}
