import { BriefcaseIcon, FileTextIcon, ListChecksIcon } from "@phosphor-icons/react/ssr";
import { ArrowRightIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";

/** The rest of what WorkIt knows about the student, each where it is kept. */
const PLACES = [
  {
    href: "/resumes",
    title: "Resumes",
    line: "The resumes you upload and build, and the one each application sends.",
    Icon: FileTextIcon,
  },
  {
    href: "/experiences",
    title: "Experiences",
    line: "Your jobs, projects, clubs and skills, which every resume draws from.",
    Icon: BriefcaseIcon,
  },
  {
    href: "/auto-apply/info",
    title: "Application Info",
    line: "Work authorization, screening answers, your transcript and writing samples.",
    Icon: ListChecksIcon,
  },
];

/**
 * My Profile's last row (KAN-550): a card for each other part of the
 * student's profile, which link to where each is kept and edited, so the
 * profile stays what an employer sees while saying where the rest went.
 * Three across where they fit: stacked on a phone, and stacked beside the
 * identity card until the page reaches @6xl/main. A whole card is
 * the link: ui/card.tsx's `href` form, titled as every card is (KAN-558). The glyph only says what a card is, so it is grey; the arrow says
 * the card goes somewhere, so it is ink (docs/design.md, an icon's colour
 * says its job). It replaced the Resumes & Experiences section, a paragraph
 * and two buttons, and it shows no counts: each would be another API read on
 * every visit to a page that reads two today.
 */
export function MoreOfYou() {
  return (
    <ul
      aria-label="More of Your Profile"
      className="grid gap-4 @3xl/main:grid-cols-3 @4xl/main:grid-cols-1 @6xl/main:grid-cols-3"
    >
      {PLACES.map(({ href, title, line, Icon }) => (
        <li key={href} className="min-w-0">
          <Card href={href} padding="lg" className="flex h-full flex-col gap-3">
            <span className="flex items-center justify-between">
              <span className="bg-ink/5 rounded-control grid size-10 place-items-center">
                <Icon aria-hidden className="text-ink-meta size-5" />
              </span>
              <ArrowRightIcon className="text-ink size-4 transition-transform duration-150 group-hover/card:translate-x-0.5" />
            </span>
            <span className="text-subtitle text-ink">{title}</span>
            <span className="text-body text-ink-meta">{line}</span>
          </Card>
        </li>
      ))}
    </ul>
  );
}
