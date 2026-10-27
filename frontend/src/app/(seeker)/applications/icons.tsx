import {
  ArrowBendUpLeftIcon,
  CalendarPlusIcon as CalendarPlus,
  ColumnsIcon as Columns,
  GridFourIcon,
  KanbanIcon,
  ListBulletsIcon,
  RadioButtonIcon,
} from "@phosphor-icons/react/ssr";

type IconProps = { className?: string };

/* The glyphs only this screen draws. Like @/components/icons, they are thin
 * wrappers over Phosphor at its regular weight: they used to be hand-drawn at
 * a 1.4 stroke on a 16-unit grid, a second icon family beside the shared one.
 * The ellipsis, the calendar and the clock live in @/components/icons, since
 * other screens draw them too. */

/* View switcher ----------------------------------------------------------
 * Each glyph draws the shape of its layout: columns, cells, rows.
 * ---------------------------------------------------------------------- */

export function BoardIcon({ className }: IconProps) {
  return <KanbanIcon aria-hidden className={className} />;
}

export function GridIcon({ className }: IconProps) {
  return <GridFourIcon aria-hidden className={className} />;
}

export function ListIcon({ className }: IconProps) {
  return <ListBulletsIcon aria-hidden className={className} />;
}

/* List controls (KAN-282) ------------------------------------------------ */

/** The Columns menu's button: show, hide and reset the list's columns. */
export function ColumnsIcon({ className }: IconProps) {
  return <Columns aria-hidden className={className} />;
}

/** All Filters' Status section: where an application stands. The stages
 *  themselves wear their own glyphs (../stage-colors.ts). */
export function StatusIcon({ className }: IconProps) {
  return <RadioButtonIcon aria-hidden className={className} />;
}

/* Email view (KAN-413) --------------------------------------------------- */

/** The email view's Reply. */
export function ReplyIcon({ className }: IconProps) {
  return <ArrowBendUpLeftIcon aria-hidden className={className} />;
}

/** The email view's Add to Google Calendar. */
export function CalendarPlusIcon({ className }: IconProps) {
  return <CalendarPlus aria-hidden className={className} />;
}
