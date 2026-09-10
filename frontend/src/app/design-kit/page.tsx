import Link from "next/link";

import { Card } from "@/components/ui/card";

import { SECTION_ORDER } from "./data";
import { KitPage } from "./specimen";

/**
 * The design kit's front page.
 *
 * It answers two questions without opening a mockup: what is this token called,
 * and what does that component look like beside its siblings. Both keep coming
 * up on the KAN-43 screens, because the mockups disagree with each other in
 * places that only show when the values sit next to one another — the surfaces
 * conflict, the two 11px sizes.
 *
 * The sections are routes rather than anchors, so this page is an index rather
 * than a table of contents pointing at itself. Each card carries the section's
 * own note, which is the same string its page heading uses.
 */
export default function DesignKitIndexPage() {
  return (
    <KitPage
      title="Design kit"
      note="Every token in globals.css and every component in src/components, rendered from the same source the app uses. Nothing here is a screenshot — if a value changes, this page changes with it."
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTION_ORDER.map(({ slug, title, note }) => (
          <li key={slug}>
            <Card
              as="article"
              padding="md"
              /* The whole card is the target, so the link fills it rather than
               * being a few words inside it. */
              className="hover:border-brand/40 h-full transition-colors"
            >
              <Link
                href={`/design-kit/${slug}`}
                className="focus-visible:ring-brand-ring block rounded-xs focus-visible:ring-2 focus-visible:outline-none"
              >
                <h2 className="text-subtitle text-ink">{title}</h2>
                <p className="text-note text-ink-meta mt-1">{note}</p>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </KitPage>
  );
}
