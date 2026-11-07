import {
  BriefcaseIcon,
  CertificateIcon,
  GraduationCapIcon,
  ListBulletsIcon,
  RocketLaunchIcon,
  TrophyIcon,
  UsersThreeIcon,
  WrenchIcon,
} from "@phosphor-icons/react/ssr";
import type { ComponentType } from "react";

import type { Section } from "@/lib/bank-actions";
import { cn } from "@/lib/cn";

/**
 * Each experience group's mark (KAN-440), read wherever the groups are named:
 * the section nav, the section cards and the resume editor's panel, so a
 * group wears one icon everywhere. Skills is the seventh, a list of its own,
 * and every section the student named (KAN-498) wears one mark.
 */
export type SectionMarkId = Section | "skills" | "custom";

export const SECTION_ICONS: Record<
  SectionMarkId,
  ComponentType<{ className?: string; weight?: "regular" | "duotone" }>
> = {
  education: GraduationCapIcon,
  experience: BriefcaseIcon,
  projects: RocketLaunchIcon,
  leadership: UsersThreeIcon,
  awards: TrophyIcon,
  certifications: CertificateIcon,
  skills: WrenchIcon,
  custom: ListBulletsIcon,
};

/** A group's icon on a brand tint, beside its heading: every card's is drawn
 *  the same, Skills too. */
export function SectionMark({ id, className }: { id: SectionMarkId; className?: string }) {
  const Glyph = SECTION_ICONS[id];
  return (
    <span
      aria-hidden
      className={cn(
        "bg-brand-tint text-brand rounded-control flex size-8 shrink-0 items-center justify-center",
        className,
      )}
    >
      <Glyph className="size-4.5" weight="duotone" />
    </span>
  );
}
