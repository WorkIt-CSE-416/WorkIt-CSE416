"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

import {
  COLUMNS,
  FROZEN,
  isCustomLayout,
  moveColumn,
  setColumnLayout,
  useColumnLayout,
  type ColumnId,
} from "./column-layout";
import { ColumnsIcon } from "./icons";

/**
 * The list's Columns menu, at the right end of the filter bar's second row
 * while the list is shown (KAN-282). A menu of checkbox rows
 * (ui/check-row.tsx, the Jobs page's filter rows); a pick leaves it open for
 * the next. The button takes the brand tint while columns are hidden and
 * the menu is closed, as a Jobs page facet does with a pick
 * (jobs/filters.tsx).
 */
const IN_USE = "border-brand bg-brand-tint text-brand hover:bg-brand-tint";

const LABEL = Object.fromEntries(COLUMNS.map(({ id, label }) => [id, label])) as Record<
  ColumnId,
  string
>;

/** A row's Move Left and Move Right: menu items, so the menu's arrow keys
 *  reach them, 24px square. */
const MOVE =
  "data-highlighted:bg-accent flex size-6 shrink-0 items-center justify-center rounded-md outline-hidden data-disabled:pointer-events-none data-disabled:opacity-30";

/**
 * Shows and hides the list's columns, in the table's own order, moves them
 * and resets the layout: order, hidden columns and widths
 * (./column-layout.ts). Each movable row has Move Left and Move Right, the
 * way to reorder without a drag (WCAG 2.5.7, KAN-577); a move swaps it with
 * the row beside it, hidden or not, as the menu lists them, and the menu
 * stays open. Role is listed but cannot be unticked or moved: it is frozen.
 */
export function ColumnsMenu({ className }: { className?: string }) {
  const layout = useColumnLayout();
  const [open, setOpen] = useState(false);
  const inUse = layout.hidden.length > 0 && !open;

  function toggle(id: ColumnId, shown: boolean) {
    const hidden = layout.hidden.filter((other) => other !== id);
    setColumnLayout({ ...layout, hidden: shown ? hidden : [...hidden, id] });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<Button variant="secondary" size="sm" className={cn(inUse && IN_USE, className)} />}
      >
        <ColumnsIcon className={inUse ? "text-brand" : "text-ink"} />
        Columns
        {layout.hidden.length > 0 && (
          <span className="sr-only">, {layout.hidden.length} hidden</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shown Columns</DropdownMenuLabel>
          {[...FROZEN, ...layout.order].map((id) => {
            const at = layout.order.indexOf(id);
            const left = layout.order[at - 1];
            const right = at < 0 ? undefined : layout.order[at + 1];
            return (
              <div key={id} className="flex items-center gap-0.5">
                <MenuPrimitive.CheckboxItem
                  checked={!layout.hidden.includes(id)}
                  disabled={FROZEN.includes(id)}
                  onCheckedChange={(shown) => toggle(id, shown)}
                  closeOnClick={false}
                  className={checkRowClasses}
                >
                  {LABEL[id]}
                  <CheckRowBox />
                </MenuPrimitive.CheckboxItem>
                {/* Role's row keeps the buttons' room, so the boxes line up. */}
                {at < 0 ? (
                  <span aria-hidden className="w-12.5 shrink-0" />
                ) : (
                  <>
                    <MenuPrimitive.Item
                      aria-label={`Move ${LABEL[id]} Left`}
                      disabled={!left}
                      closeOnClick={false}
                      onClick={() => left && setColumnLayout(moveColumn(layout, id, left))}
                      className={MOVE}
                    >
                      <ArrowLeftIcon className="size-3.5" />
                    </MenuPrimitive.Item>
                    <MenuPrimitive.Item
                      aria-label={`Move ${LABEL[id]} Right`}
                      disabled={!right}
                      closeOnClick={false}
                      onClick={() => right && setColumnLayout(moveColumn(layout, id, right))}
                      className={MOVE}
                    >
                      <ArrowRightIcon className="size-3.5" />
                    </MenuPrimitive.Item>
                  </>
                )}
              </div>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!isCustomLayout(layout)}
          onClick={() => setColumnLayout(null)}
          className="font-medium"
        >
          Reset Columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
