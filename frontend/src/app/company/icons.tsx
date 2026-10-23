import { ArrowLineUpIcon, BuildingOfficeIcon, DownloadSimpleIcon } from "@phosphor-icons/react/ssr";

type IconProps = { className?: string };

/**
 * Glyphs the company shell needs and no other route does.
 *
 * Phosphor's, as thin wrappers, on the same terms as src/components/icons.tsx:
 * the regular weight, and the old names and props kept so no call site
 * changed when the drawings did (hand-drawn, then Lucide's until KAN-350).
 *
 * They move to src/components/icons.tsx the moment a second route wants them.
 */

/** The company itself: the job page's tile. Building2, the glyph the panel's
 *  Company Profile row draws, so one company has one mark wherever it shows. */
export function BuildingIcon({ className }: IconProps) {
  return <BuildingOfficeIcon aria-hidden className={className} />;
}

/** Export: the arrow points down because what the button does is put a file
 *  on your disk, not upload one. */
export function DownloadIcon({ className }: IconProps) {
  return <DownloadSimpleIcon aria-hidden className={className} />;
}

/** The Applications chart's busiest point: an arrow up to a ceiling, the
 *  highest the line reached in the window. */
export function PeakIcon({ className }: IconProps) {
  return <ArrowLineUpIcon aria-hidden className={className} />;
}
