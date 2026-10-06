import Link from "next/link";

import { ArrowRightIcon } from "@/components/icons";
import { getAvatar } from "@/lib/avatar-actions";
import { listResumes } from "@/lib/resume-actions";
import { getCurrentAccount } from "@/lib/session";

/**
 * How complete the seeker's profile is, as a small card at the foot of the
 * panel: a bar, "1 of 2 done", and the one next step as a link. It sits where
 * dashboards keep a plan or trial meter, because it is the same kind of thing
 * — always there, never urgent, one click from fixing.
 *
 * ONLY STEPS THE API CAN SEE COUNT. A resume and a photo are real; work
 * history and skills are still the profile page's fixtures, and a meter that
 * scores fixtures would congratulate everyone on the same made-up profile.
 * Add a step here when its data is live. The resume leads: nothing can be
 * matched without one.
 *
 * Lavender (--color-rail) on the white panel, the one tinted block in it,
 * so it reads as a card set apart from the rows above without the weight of
 * a solid fill.
 *
 * Gone once complete — a full bar is a card with nothing to say — and when
 * signed out or the loads fail, since a failure is not the same as a missing
 * resume. Hidden on the collapsed rail, which has no room for it.
 */
export async function ProfileStrength() {
  const account = await getCurrentAccount();
  if (!account) return null;

  const [resumes, avatar] = await Promise.all([listResumes(), getAvatar()]);
  if (resumes.error != null || avatar.error != null) return null;

  const steps = [
    { done: resumes.resumes.length > 0, todo: "Upload Your Resume" },
    { done: avatar.url != null, todo: "Add a Profile Photo" },
  ];
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  if (!next) return null;

  return (
    <div className="border-rail-border bg-rail rounded-card border p-3 group-data-[collapsible=icon]:hidden">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label text-ink">Profile Strength</p>
        <p className="text-note text-ink-meta tabular-nums">
          {done} of {steps.length} done
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Profile Strength"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className="bg-rail-selected mt-2 h-1.5 overflow-hidden rounded-full"
      >
        <span
          className="bg-brand block h-full rounded-full"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>

      <Link
        href="/profile"
        className="text-note text-brand-ink focus-visible:ring-brand-ring mt-2 inline-flex items-center gap-1 rounded-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {next.todo}
        <ArrowRightIcon className="size-3" />
      </Link>
    </div>
  );
}
