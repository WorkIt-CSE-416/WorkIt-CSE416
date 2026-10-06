import { Eye, GripVertical } from "lucide-react";

type IconProps = { className?: string };

/**
 * Glyphs the job composer needs and no other route does.
 *
 * Lucide's, as thin wrappers, on the same terms as src/components/icons.tsx:
 * the default stroke, and the old names and props kept so no call site changed
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
  return <GripVertical aria-hidden className={className} />;
}
