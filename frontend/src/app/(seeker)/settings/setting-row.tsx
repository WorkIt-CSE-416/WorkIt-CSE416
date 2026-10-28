import type { ComponentType, ReactNode } from "react";

/**
 * One setting: its glyph, name and value on the left, its action on the
 * right. Sign-In & Security's rows and Integrations' apps (KAN-413) draw
 * through this one row, so a sign-in provider and a connected app look
 * alike: a brand logo sits in the same tile as a plain glyph.
 */
export function SettingRow({
  Icon,
  label,
  value,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  /** The setting's name; may carry a badge after it (Coming Soon). */
  label: ReactNode;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="bg-surface text-ink-muted rounded-control flex size-9 shrink-0 items-center justify-center">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-label text-ink flex flex-wrap items-center gap-2 font-semibold">
          {label}
        </div>
        <div className="text-meta text-ink-meta break-all">{value}</div>
      </div>
      {children}
    </li>
  );
}
