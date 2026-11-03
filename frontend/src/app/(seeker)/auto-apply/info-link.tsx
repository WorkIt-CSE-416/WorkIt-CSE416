import { ListChecksIcon } from "@phosphor-icons/react/ssr";
import { ArrowRightIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";

/**
 * The Auto Apply page's way to Application Info (./info/page.tsx, KAN-550),
 * after Up Next: one row card, the whole of it the link. It is not a header
 * button, since the page's header keeps its top right for a view switcher
 * (./auto-apply-panel.tsx), and not part of the setup strip, which shows
 * only while the extension is missing: the answers matter after that too.
 * Drawn as My Profile's cards that lead to it (../profile/more-of-you.tsx):
 * ui/card.tsx's link form (KAN-558), a grey glyph, since it only says what
 * the row is, and an ink arrow.
 */
export function InfoLink() {
  return (
    <Card href="/auto-apply/info" padding="lg" className="mt-8 flex items-center gap-4">
      <span className="bg-ink/5 rounded-control grid size-10 shrink-0 place-items-center">
        <ListChecksIcon aria-hidden className="text-ink-meta size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-subtitle text-ink block">Application Info</span>
        <span className="text-body text-ink-meta block">
          What the extension fills in beyond your resume: work authorization, screening answers,
          your transcript and writing samples.
        </span>
      </span>
      <ArrowRightIcon className="text-ink size-4 shrink-0 transition-transform duration-150 group-hover/card:translate-x-0.5" />
    </Card>
  );
}
