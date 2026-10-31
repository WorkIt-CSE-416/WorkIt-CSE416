"use client";

import { FileTextIcon, XIcon } from "@phosphor-icons/react/ssr";
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

import { STAGE_ICON } from "../stage-colors";
import type { ActivityItem } from "./activity-list";
import { markSubmitted } from "./actions";

/**
 * Up Next's ⋯ on each row (KAN-424), in its own column: the row's rarer
 * actions, worded, in one menu, the same three on every row so none goes
 * missing. Going to a row's tab is not here: its Next Step button (Go to
 * Tab, Review, Finish) already does it.
 * It replaced two bare icon buttons side by side (a briefcase for "I
 * submitted this", a cross for Remove), which no one could read at 16px and
 * which put the destructive one next to the other, one slip apart:
 *
 *   Change Resume        the row's resume picker (./resume-dialog.tsx), as
 *                        its Resume cell opens
 *   I Already Applied    an application the student sent that the
 *                        extension didn't see. It finishes it as submitted
 *                        (markSubmitted); the row leaves Up Next, and the
 *                        Tracker shows it Applied.
 *   Remove From Queue    destructive, last, on every row (`onRemove`,
 *                        ./up-next.tsx): a queued job leaves the queue with
 *                        Undo, a started one whose tab closed is skipped, and one open
 *                        in a tab has its tab closed first.
 *
 * The row leaves a click on a button alone (components/clickable-row.tsx),
 * so opening the menu never opens the job posting. One action per row at a
 * time (`busy`, a ref): `pending` lands a render late, and a fast double
 * press sent two requests.
 */
export function RowMenu<T extends ActivityItem>({
  item,
  onResume,
  onRemove,
}: {
  item: T;
  onResume: (item: T) => void;
  onRemove: (item: T) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const markApplied = () => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
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
      } finally {
        busy.current = false;
      }
    });
  };

  const Applied = STAGE_ICON.applied;

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
        <DropdownMenuItem onClick={() => onResume(item)}>
          <FileTextIcon aria-hidden className="text-ink-meta size-4" />
          Change Resume
        </DropdownMenuItem>
        <DropdownMenuItem onClick={markApplied}>
          <Applied className="text-ink-meta size-4" />I Already Applied
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(item)}>
          <XIcon aria-hidden className="size-4" />
          Remove From Queue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
