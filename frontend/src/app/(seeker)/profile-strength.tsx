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
 * matched without one. Each step links to where it is done: the upload on
 * Resumes, the photo on My Profile.
 *
 * Lavender (--color-rail) on the white panel, the one tinted block in it,
 * so it reads as a card set apart from the rows above without the weight of
 * a solid fill.
 *
 * Gone once complete — a full bar is a card with nothing to say — and when
 * signed out or the loads fail, since a failure is not the same as a missing
 * resume.
 *
 * TWO FORMS: the card in the phone's sheet, and on the 88px rail a tile
 * like the rows above it, a ring filled to the share done around the count,
 * named Setup, which goes to the next step (2026-10-27). Its accessible
 * name says the whole card's line: the count and the next step.
 */
export async function ProfileStrength() {
  // All three at once: neither read waits on /auth/me's answer, and the card
  // used to wait on it before asking for the other two. With no account the
  // other answers are not used (both report their own errors, never throw).
  const [account, resumes, avatar] = await Promise.all([
    getCurrentAccount(),
    listResumes(),
    getAvatar(),
  ]);
  if (!account) return null;
  if (resumes.error != null || avatar.error != null) return null;

  const steps = [
    { done: resumes.resumes.length > 0, todo: "Upload Your Resume", href: "/resumes" },
    { done: avatar.url != null, todo: "Add a Profile Photo", href: "/profile" },
  ];
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  if (!next) return null;

  const share = (done / steps.length) * 100;
  return (
    <>
      <Link
        href={next.href}
        aria-label={`Setup: ${done} of ${steps.length} done. Next: ${next.todo}`}
        className="text-note text-ink-meta hover:text-ink focus-visible:ring-brand-ring hover:bg-rail-hover hidden h-16 flex-col items-center justify-center gap-1 rounded-md font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none md:flex"
      >
        {/* A conic fill under a white disc: the ring. */}
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full"
          style={{
            background: `conic-gradient(var(--color-brand) ${share}%, var(--color-rail-selected) 0)`,
          }}
        >
          <span className="bg-panel text-caption text-ink grid size-5 place-items-center rounded-full tabular-nums">
            {done}/{steps.length}
          </span>
        </span>
        Setup
      </Link>
      <Card done={done} total={steps.length} next={next} />
    </>
  );
}

function Card({
  done,
  total,
  next,
}: {
  done: number;
  total: number;
  next: { todo: string; href: string };
}) {
  return (
    <div className="border-rail-border bg-rail rounded-card border p-3 md:hidden">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label text-ink">Profile Strength</p>
        <p className="text-note text-ink-meta tabular-nums">
          {done} of {total} done
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Profile Strength"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="bg-rail-selected mt-2 h-1.5 overflow-hidden rounded-full"
      >
        {/* Fills from the left as the panel arrives. */}
        <span
          className="bg-brand animate-draw-x block h-full origin-left rounded-full"
          style={{ width: `${(done / total) * 100}%`, animationDelay: "200ms" }}
        />
      </div>

      <Link
        href={next.href}
        // The underline fades in and the arrow leans on, as a section link's
        // does.
        className="group/strength text-note text-brand-ink focus-visible:ring-brand-ring mt-2 inline-flex items-center gap-1 rounded-xs font-medium underline decoration-transparent underline-offset-2 transition-[text-decoration-color] duration-150 hover:decoration-current focus-visible:ring-2 focus-visible:outline-none"
      >
        {next.todo}
        <ArrowRightIcon className="ease-glide size-3 transition-transform duration-200 group-hover/strength:translate-x-0.5" />
      </Link>
    </div>
  );
}
