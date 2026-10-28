"use client";

import { AppWindowIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";

import { EllipsisIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { showRunTab } from "@/lib/autofill-extension";

import { STAGE_ICON } from "../stage-colors";
import type { ActivityItem } from "./activity-list";
import { dequeueJob, markSubmitted, queueJob } from "./actions";

/**
 * Up Next's ⋯ on each row (KAN-424), in its Actions cell: the row's rarer
 * actions, worded, in one menu. It replaced two bare icon buttons side by
 * side (a briefcase for "I submitted this", a cross for Remove), which no
 * one could read at 16px and which put the destructive one next to the
 * other, one slip apart. Each item says what it does:
 *
 *   Go to Its Tab        the row open in one of the extension's batch tabs
 *   I Already Applied    any row not applied or skipped: an application the
 *                        student sent that the extension didn't see. It
 *                        finishes it as submitted (markSubmitted); the row
 *                        leaves Up Next, and the Tracker shows it Applied.
 *   Remove From Queue    a queued row (destructive, last): takes the job out
 *                        of the queue (dequeueJob), with Undo in its toast,
 *                        which queues it again, at the bottom. A row past
 *                        queued (Needs You) is a record, and the API's 409
 *                        would refuse it, so it has no Remove.
 *
 * The row leaves a click on a button alone (components/clickable-row.tsx),
 * so opening the menu never opens the job posting. One action per row at a
 * time (`busy`, a ref): `pending` lands a render late, and a fast double
 * press sent two removals, the second one's 404 raising a second toast.
 */
export function RowMenu({ item }: { item: ActivityItem }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const busy = useRef(false);

  function once(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        await work();
      } finally {
        busy.current = false;
      }
    });
  }

  const markApplied = () =>
    once(async () => {
      const result = await markSubmitted(item.id);
      if (result.error) return void toast.show({ message: result.error });
      router.refresh();
      toast.show({
        message: (
          <>
            <span className="font-medium">{item.role}</span> is marked Applied.
          </>
        ),
      });
    });

  async function undoRemove() {
    const result = await queueJob(item.id);
    if (result.error) {
      toast.show({ message: `Couldn't put ${item.role} back in the queue. ${result.error}` });
      return;
    }
    router.refresh();
  }

  const remove = () =>
    once(async () => {
      const result = await dequeueJob(item.id);
      if (result.error) return void toast.show({ message: result.error });
      router.refresh();
      toast.show({
        message: (
          <>
            <span className="font-medium">{item.role}</span> from{" "}
            <span className="font-medium">{item.company}</span> is removed from Auto Apply.
          </>
        ),
        action: { label: "Undo", onClick: undoRemove },
      });
    });

  const Applied = STAGE_ICON.applied;
  const canApply = item.status !== "applied" && item.status !== "skipped";
  const canRemove = item.status === "queued";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            label={`More actions for ${item.role}`}
            tooltip="More actions"
            className="size-8"
            disabled={pending}
          >
            <EllipsisIcon className="size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {item.status === "browser" && (
          <DropdownMenuItem onClick={() => void showRunTab(item.id)}>
            <AppWindowIcon aria-hidden className="text-ink-meta size-4" />
            Go to Its Tab
          </DropdownMenuItem>
        )}
        {canApply && (
          <DropdownMenuItem onClick={markApplied}>
            <Applied className="text-ink-meta size-4" />I Already Applied
          </DropdownMenuItem>
        )}
        {canRemove && (
          <DropdownMenuItem variant="destructive" onClick={remove}>
            <XIcon aria-hidden className="size-4" />
            Remove From Queue
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
