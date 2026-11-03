"use client";

import { ListBulletsIcon, RowsIcon, SidebarSimpleIcon } from "@phosphor-icons/react/ssr";
import { useOptimistic, useTransition } from "react";

import { SegmentedToggle } from "@/components/ui/segmented-control";

import { setJobsView } from "./actions";
import type { JobsView } from "./view";

/**
 * The Jobs page's choice of view, at the heading's right end (KAN-519). Glyphs,
 * named by their tooltips: in words it read as one kind of choice with the Sort
 * By pills that sat beside it. The thumb moves at once, and the action's answer
 * draws the page in the new view.
 *
 * Below `@4xl/main` there is no room for two panes, so the same choice is a
 * list of compact cards and draws one. /search has no open job beside its list
 * at any width (`listOnly`, ../search/page.tsx).
 */
export function ViewSwitch({ view, listOnly = false }: { view: JobsView; listOnly?: boolean }) {
  const [shown, show] = useOptimistic(view);
  const [, start] = useTransition();
  return (
    <SegmentedToggle
      label="View"
      value={shown}
      onValueChange={(next) =>
        start(async () => {
          show(next as JobsView);
          await setJobsView(next as JobsView);
        })
      }
      options={[
        {
          value: "cards",
          label: "Cards View",
          icon: <RowsIcon aria-hidden className="size-4" />,
        },
        {
          value: "split",
          label: listOnly ? "List View" : "Split View",
          icon: listOnly ? (
            <ListBulletsIcon aria-hidden className="size-4" />
          ) : (
            <>
              <ListBulletsIcon aria-hidden className="size-4 @4xl/main:hidden" />
              <SidebarSimpleIcon aria-hidden className="hidden size-4 @4xl/main:block" />
            </>
          ),
        },
      ]}
    />
  );
}
