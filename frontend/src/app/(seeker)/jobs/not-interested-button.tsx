import { ProhibitIcon } from "@phosphor-icons/react/ssr";

import { IconButton } from "@/components/ui/icon-button";

/** Not Interested, on the large card (36px and outlined, as Save is beside it)
 *  and, `quiet`, on the compact card as a bare glyph. Nothing stores the
 *  choice yet, so it is `soon` (KAN-569): faded, and its tooltip says
 *  "Coming Soon". It looked live and did nothing until then. */
export function NotInterestedButton({ title, quiet = false }: { title: string; quiet?: boolean }) {
  return (
    <IconButton
      label={`Not Interested in ${title}`}
      tooltip="Not Interested"
      variant={quiet ? "quiet" : "outline"}
      soon
      className={quiet ? undefined : "size-9"}
    >
      <ProhibitIcon aria-hidden className="size-4" />
    </IconButton>
  );
}
