import type { ReactNode } from "react";

/**
 * One row of the Sent card: the name and its line, the buttons, then the
 * icon actions. (A resume is a card of its own since KAN-258, drawn as My
 * Profile's rows are.) From @xl/main they share one line, the actions at
 * the right. Narrower, the icons stay at the top right beside the name, as a
 * bank entry's Edit and Delete do, and the buttons take the line under it:
 * wrapped as one row, Delete sat alone on a line of its own on a 375px
 * phone (KAN-258). The grid moves only what is drawn, so the tab order stays
 * the buttons, then the icons, at every width.
 */
export function RowLayout({
  head,
  buttons,
  icons,
}: {
  head: ReactNode;
  buttons: ReactNode;
  icons: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @xl/main:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0">{head}</div>
      <div className="col-span-2 flex flex-wrap items-center gap-3 @xl/main:col-span-1">
        {buttons}
      </div>
      {/* h-6 is the name's line, so a narrow row's icons sit level with it. */}
      <div className="col-start-2 row-start-1 flex h-6 items-center gap-3 self-start @xl/main:col-start-3 @xl/main:self-center">
        {icons}
      </div>
    </div>
  );
}
