import { ProhibitIcon } from "@phosphor-icons/react/ssr";

import { IconButton } from "@/components/ui/icon-button";

/** Not Interested, on the large card (36px and outlined, as Save is beside it)
 *  and, `quiet`, on the compact card as a bare glyph. Still inert: nothing
 *  stores the choice yet. */
export function NotInterestedButton({ title, quiet = false }: { title: string; quiet?: boolean }) {
  return (
    <IconButton
      label={`Not interested in ${title}`}
      tooltip="Not interested"
      variant={quiet ? "quiet" : "outline"}
      className={quiet ? undefined : "size-9"}
    >
      <ProhibitIcon aria-hidden className="size-4" />
    </IconButton>
  );
}
