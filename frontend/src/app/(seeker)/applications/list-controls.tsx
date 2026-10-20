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
import { Button } from "@/components/ui/button";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import { cn } from "@/lib/cn";

import {
  COLUMNS,
  FROZEN,
  isCustomLayout,
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
const IN_USE = "border-brand/50 bg-brand/10 text-brand hover:bg-brand/10";

const LABEL = Object.fromEntries(COLUMNS.map(({ id, label }) => [id, label])) as Record<
  ColumnId,
  string
>;

/**
 * Shows and hides the list's columns, in the table's own order, and resets
 * the layout: order, hidden columns and widths (./column-layout.ts). Role
 * is listed but cannot be unticked: it is frozen.
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
        <ColumnsIcon className={inUse ? "text-brand" : "text-ink-meta"} />
        Columns
        {layout.hidden.length > 0 && (
          <span className="sr-only">, {layout.hidden.length} hidden</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shown Columns</DropdownMenuLabel>
          {[...FROZEN, ...layout.order].map((id) => (
            <MenuPrimitive.CheckboxItem
              key={id}
              checked={!layout.hidden.includes(id)}
              disabled={FROZEN.includes(id)}
              onCheckedChange={(shown) => toggle(id, shown)}
              closeOnClick={false}
              className={checkRowClasses}
            >
              {LABEL[id]}
              <CheckRowBox />
            </MenuPrimitive.CheckboxItem>
          ))}
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
