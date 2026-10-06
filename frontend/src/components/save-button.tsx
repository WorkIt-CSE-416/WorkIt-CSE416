import { BookmarkIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

/**
 * Save a job, or take it back out of saved: the one Save control on every job
 * surface (the listing card on /jobs and /search, and the job page).
 *
 * It was drawn four ways, as a 32px outline button, a borderless 32px glyph, a
 * 36px outline button and a bare 14px glyph, so a seeker met a different Save
 * on each screen, and one surface could disagree with another about whether
 * the job was saved. One component means one look, one label and one state
 * per job.
 *
 * Bordered at 32px, the `sm` button height, so it lines up with the actions
 * beside it. Saved is a filled bookmark in brand, a step deeper on hover
 * rather than the outline button's ink, which would read as the save undone.
 * The label names the job for a screen reader, which meets the button without
 * its card, while the tooltip stays short for a pointer already inside that
 * card.
 */
export function SaveButton({
  title,
  saved = false,
  className,
}: {
  /** The job's title, for the accessible name: "Save Staff Frontend Engineer". */
  title: string;
  saved?: boolean;
  className?: string;
}) {
  return (
    <IconButton
      variant="outline"
      className={cn("size-8 shrink-0", saved && "text-brand hover:text-brand-hover", className)}
      label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      tooltip={saved ? "Remove from saved" : "Save"}
    >
      <BookmarkIcon filled={saved} className="size-4" />
    </IconButton>
  );
}
