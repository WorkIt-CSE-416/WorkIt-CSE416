"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";

import { cn } from "@/lib/cn";
import { CheckRowBox, checkRowClasses } from "@/components/ui/check-row";
import {
  Select,
  SelectContent as VendoredSelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/select";

/**
 * The canonical Select: shadcn's, with the one positioning default this app
 * disagrees with, plus a checkbox row it has no part for (SelectCheckboxItem,
 * below). Everything else is re-exported untouched, so screens import the whole
 * primitive from here and the vendored file stays regenerable.
 *
 * Base UI ships `alignItemWithTrigger` defaulting to true, which is macOS's
 * native select: the popup overlaps the trigger so the *selected* row lands on
 * top of the closed control's text. On the web that reads as a menu covering
 * the button that opened it, and the selected row moves — a list opens in a
 * different place depending on which item is currently chosen.
 *
 * It is also conditional, which is the part that reads as a glitch rather than
 * a style. Base UI's own documentation lists three ways it silently reverts to
 * ordinary below-the-trigger positioning: touch was used to open it, the popup
 * would be squeezed too short, or the trigger sits within 20px of the top or
 * bottom of the viewport. So the same select overlaps or drops down depending
 * on where the page happens to be scrolled.
 *
 * Turning it off is also what makes the `side="bottom"` the vendored component
 * already asks for mean anything: the docs are explicit that `side` and `align`
 * are ignored entirely while this mode is on. The component read as though it
 * were configured to open downward and was not.
 *
 * `align="start"` because a dropdown hangs from the trigger's leading edge —
 * that is what our menus already do (shadcn's DropdownMenu defaults to it) and
 * what centring only matches while the popup is exactly the trigger's width.
 *
 * One thing this cannot express: "below, even when there is no room below."
 * That is the Positioner's `collisionAvoidance`, and the vendored SelectContent
 * forwards a fixed list of positioner props that does not include it — the rest
 * of its props go to the Popup instead. Reaching it would mean forking the
 * vendored markup. Flipping above a trigger that has no space under it is
 * standard behaviour and keeps the list usable, so it is left alone.
 */
function SelectContent({
  alignItemWithTrigger = false,
  align = "start",
  ...props
}: React.ComponentProps<typeof VendoredSelectContent>) {
  return (
    <VendoredSelectContent alignItemWithTrigger={alignItemWithTrigger} align={align} {...props} />
  );
}

/**
 * A row that reads as a checkbox (./check-row) for a `multiple` Select, where
 * the vendored SelectItem's lone check mark does not say "you can pick more
 * than one". Written here rather than in shadcn/ because it has no registry
 * counterpart to regenerate from.
 */
function SelectCheckboxItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(checkRowClasses, className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <CheckRowBox />
    </SelectPrimitive.Item>
  );
}

export {
  Select,
  SelectCheckboxItem,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
