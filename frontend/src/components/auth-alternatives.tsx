import { GoogleIcon, LinkedInIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signInWithOAuth } from "@/lib/oauth-actions";

/**
 * "Soon", on a control that is shown but not built yet: Join a Company on the
 * signup form.
 *
 * The status pill is 23px, taller than the line it sits on. The negative
 * margin lets it overhang that line instead of growing it, so a marked tile is
 * the same height as its unmarked sibling and the divider keeps its spacing.
 */
export function SoonBadge() {
  return (
    <span className="-my-1 flex">
      <Badge tone="inert">Soon</Badge>
    </span>
  );
}

/**
 * The "Or continue with" divider and the Google and LinkedIn row under the
 * login and signup forms. One component so the two cards cannot drift apart:
 * they used to space it 20/22px and 16/16px.
 *
 * Each button is its own form posting to `signInWithOAuth` (#58,
 * src/lib/oauth-actions.ts), which sends the browser to the provider and back
 * through /auth/callback. A first sign-in there picks Applicant or Company
 * before landing; see that route.
 *
 * The divider's 20px and the row's 20px below it match the gap between the
 * account-type switcher and the form above.
 */
export function AuthAlternatives() {
  return (
    <>
      <div className="mt-5 flex items-center gap-3">
        <span className="bg-border-subtle h-px flex-1" />
        <span className="text-caption text-ink-muted uppercase">Or continue with</span>
        <span className="bg-border-subtle h-px flex-1" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <form action={signInWithOAuth.bind(null, "google")}>
          <Button type="submit" variant="secondary" className="w-full">
            <GoogleIcon className="size-4" />
            Google
          </Button>
        </form>
        <form action={signInWithOAuth.bind(null, "linkedin_oidc")}>
          <Button type="submit" variant="secondary" className="w-full">
            <LinkedInIcon className="size-4" />
            LinkedIn
          </Button>
        </form>
      </div>
    </>
  );
}
