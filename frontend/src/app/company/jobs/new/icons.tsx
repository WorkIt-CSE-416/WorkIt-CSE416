import { DotsSixVerticalIcon, EyeIcon as Eye } from "@phosphor-icons/react/ssr";

type IconProps = { className?: string };

/**
 * Glyphs the job composer needs and no other route does.
 *
 * Phosphor's, as thin wrappers, on the same terms as src/components/icons.tsx:
 * the regular weight, and the old names and props kept so no call site changed
 * when the drawings did. Removing a question uses the shared TrashIcon.
 *
 * They move to src/components/icons.tsx the moment a second route wants them.
 */

/** Live preview: an open eye. */
export function EyeIcon({ className }: IconProps) {
  return <Eye aria-hidden className={className} />;
}

/** The reorder handle: six dots, the conventional drag mark. */
export function GripIcon({ className }: IconProps) {
  return <DotsSixVerticalIcon aria-hidden className={className} />;
}
