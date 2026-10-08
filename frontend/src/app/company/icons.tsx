import { ArrowUpToLine, Building2, Download } from "lucide-react";

type IconProps = { className?: string };

/**
 * Glyphs the company shell needs and no other route does.
 *
 * Lucide's, as thin wrappers, on the same terms as src/components/icons.tsx:
 * the default stroke, and the old names and props kept so no call site changed
 * when the drawings did. These were hand-drawn at a 1.4 stroke to match that
 * file while it was hand-drawn too; it is Lucide now, and so are the panel's
 * nav rows, so these follow.
 *
 * They move to src/components/icons.tsx the moment a second route wants them.
 */

/** The company itself: the job page's tile. Building2, the glyph the panel's
 *  Company Profile row draws, so one company has one mark wherever it shows. */
export function BuildingIcon({ className }: IconProps) {
  return <Building2 aria-hidden className={className} />;
}

/** Export: the arrow points down because what the button does is put a file
 *  on your disk, not upload one. */
export function DownloadIcon({ className }: IconProps) {
  return <Download aria-hidden className={className} />;
}

/** The Applications chart's busiest point: an arrow up to a ceiling, the
 *  highest the line reached in the window. */
export function PeakIcon({ className }: IconProps) {
  return <ArrowUpToLine aria-hidden className={className} />;
}
