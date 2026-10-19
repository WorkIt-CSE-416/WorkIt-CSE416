import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Onboarding's way out, at the foot of both its pages: who is signed in, and
 * Sign Out for anyone who is not them.
 *
 * Onboarding sits outside both shells, so it has no account menu, and sign-in
 * sends an applicant who has not finished back here every time: without this
 * the only way off the screen is to finish it. It used to be a Sign Out button
 * at the top right of the form, the first thing in the column, which read as
 * part of the step (KAN-259). Down here, in the 12px of the inline button, it
 * is there for whoever needs it and out of everyone else's way.
 */
export function SignedInAs({ email, className }: { email: string | null; className?: string }) {
  return (
    <form
      action={signOut}
      className={cn(
        "text-note text-ink-meta flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center",
        className,
      )}
    >
      {email && (
        <span>
          Signed in as <span className="text-ink">{email}</span>. Not you?
        </span>
      )}
      <Button type="submit" variant="ghost" size="inline">
        Sign Out
      </Button>
    </form>
  );
}
