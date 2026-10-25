import { GithubLogoIcon, GlobeIcon, LinkedinLogoIcon, LinkIcon } from "@phosphor-icons/react/ssr";

type IconProps = { className?: string };

/* The glyphs only My Profile's contact row draws (KAN-262), one per link
 * field. LinkedIn and GitHub are Phosphor's outline logos: the same stroke as
 * the mail and phone glyphs beside them, not the coloured LinkedIn logo in
 * @/components/icons, which would be the one coloured mark in a grey row.
 * (Under Lucide, which dropped its brand icons in 1.x, they were drawn by
 * hand.) */

export function LinkedInGlyph({ className }: IconProps) {
  return <LinkedinLogoIcon aria-hidden className={className} />;
}

export function GitHubGlyph({ className }: IconProps) {
  return <GithubLogoIcon aria-hidden className={className} />;
}

/** Portfolio or Website. */
export function WebsiteGlyph({ className }: IconProps) {
  return <GlobeIcon aria-hidden className={className} />;
}

/** Other Link, whatever site it is. */
export function OtherLinkGlyph({ className }: IconProps) {
  return <LinkIcon aria-hidden className={className} />;
}
