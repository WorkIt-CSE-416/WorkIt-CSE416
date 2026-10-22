import { cn } from "@/lib/cn";

import { CONTAINER, PANEL, PANEL_INSET } from "./layout-parts";
import { SocialSignUpButton } from "./social-sign-up";

/**
 * The closing call to action a marketing page ends on, just above the
 * footer: a headline, a line and the hero's sign-up pair, on a rounded panel
 * in the page's own colour. The home page and every feature page draw it.
 * Its own file, not layout-parts.tsx, so the client scenes that import the
 * frame from there do not pull the sign-up's server action in.
 */
export function ClosingCta({
  title,
  subtitle,
  background,
}: {
  title: string;
  subtitle: string;
  /** The panel's fill: a feature's backdrop, or the brand's on the home page. */
  background: string;
}) {
  return (
    <section className={cn(PANEL_INSET, "mb-2 sm:mb-6")}>
      <div className={cn(PANEL, "py-20 text-center sm:py-24")} style={{ background }}>
        <div className={CONTAINER}>
          <h2 className="text-ink mx-auto max-w-2xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
            {title}
          </h2>
          <p className="text-ink-muted mx-auto mt-4 max-w-xl text-lg text-pretty">{subtitle}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <SocialSignUpButton provider="google" />
            <SocialSignUpButton provider="linkedin_oidc" />
          </div>
        </div>
      </div>
    </section>
  );
}
