import { TailorIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

/**
 * "Tailored": the student has a resume tailored to this job posting
 * (KAN-217), on a job's feed card and its Tracker row and card.
 * A fact WorkIt reads from the resumes (a built resume with the posting's id),
 * never a stage: a tailored job is saved, and its stage menu stays the
 * tracker's own. Tailor's glyph, so it reads as the button that made it.
 */
export function TailoredChip() {
  return (
    <Badge tone="brand">
      <span className="flex items-center gap-1">
        <TailorIcon className="size-3.5" />
        Tailored
      </span>
    </Badge>
  );
}
