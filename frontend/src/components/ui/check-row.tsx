import { CheckIcon } from "@phosphor-icons/react/ssr";

/**
 * A row that reads as a checkbox (label on the left, box on the right) for a
 * list that takes several picks: a `multiple` Select (SelectCheckboxItem),
 * the Role filter's searchable Combobox, and a Menu's CheckboxItem (the
 * Applications Filter and Columns menus, KAN-282). One row for all, so a list you can
 * search draws its options exactly as the lists beside it do. Put the classes
 * on the item and the box inside it; the item's own `data-selected` and
 * `data-highlighted` drive them, which Base UI writes on both kinds of item.
 *
 * Medium weight, as the filter buttons above these lists are: at body weight
 * the options read thin beside them (KAN-252).
 *
 * The box is a stand-in, not the real `Checkbox`: the item already tracks
 * selection, so a second stateful control would only have to be kept in sync.
 *
 * Details that look arbitrary and are not:
 * - A Menu's CheckboxItem writes `data-checked` where the others write
 *   `data-selected`, so the box answers to both.
 * - `data-[selected]`, not `data-selected`. The `data-selected` variant from
 *   `shadcn/tailwind.css` only matches `data-selected="true"`, and Base UI
 *   writes the attribute bare, so the short form never checks the box.
 * - No `**:text-accent-foreground` on the highlighted row, unlike the vendored
 *   item. That rule recolours every descendant, which turns the white check
 *   dark on hover; the row's own text colour is all the highlight needs.
 * - `border-ink-meta`, not shadcn's `border-input`. The empty box is what says
 *   a list takes several picks, and the input hairline drew it at 1.19:1 on
 *   the white popup. This is 5.59:1 there and 4.90:1 on the hovered row;
 *   ink-faint would drop to 2.73:1 on hover.
 */
export const checkRowClasses =
  "group/check-row data-highlighted:bg-accent data-highlighted:text-accent-foreground text-body font-medium flex w-full cursor-default items-center justify-between gap-2 rounded-md py-1 pr-1.5 pl-2 outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50";

export function CheckRowBox() {
  return (
    <span
      aria-hidden
      className="border-ink-meta text-primary-foreground group-data-[selected]/check-row:border-primary group-data-[selected]/check-row:bg-primary group-data-[checked]/check-row:border-primary group-data-[checked]/check-row:bg-primary pointer-events-none flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors"
    >
      <CheckIcon
        aria-hidden
        className="size-3.5 opacity-0 group-data-[checked]/check-row:opacity-100 group-data-[selected]/check-row:opacity-100"
      />
    </span>
  );
}
