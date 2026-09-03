"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * The admin console's left nav, business-side only.
 *
 * A vertical restatement of the top bar's <NavLink>: same active test — exact
 * match or a child route — and the same brand active colour. The bar underlines
 * the active tab; stacked, that underline becomes a left edge, and the chosen
 * row also takes the brand-tint fill the design kit reserves for a selected row
 * (--sidebar-accent / --accent in globals.css).
 *
 * It lives beside the page because only /company/audit-logs renders it. If a
 * second admin screen lands, lift this and the two-pane wrapper into company/
 * (or the layout) then, not before — the same rule the top bars followed.
 *
 * Every item but the first is a route that 404s today: links that 404 rather
 * than controls that do nothing, the placeholder both top bars already use for
 * /settings and /apply.
 */
const ITEMS = [
  { href: "/company/audit-logs", label: "System Audit Logs" },
  { href: "/company/admin/users", label: "User Management" },
  { href: "/company/admin/roles", label: "Roles & Permissions" },
  { href: "/company/admin/integrations", label: "Integrations" },
  { href: "/company/admin/settings", label: "System Settings" },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <aside className="bg-panel border-border w-60 shrink-0 border-r px-3 py-4.5">
      <p className="text-caption text-ink-subtle px-3 pb-2 uppercase">Admin Console</p>
      <nav aria-label="Admin console">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "text-body focus-visible:ring-brand-ring rounded-control block border-l-2 px-3 py-2 font-medium focus-visible:ring-2 focus-visible:outline-none",
                    isActive
                      ? "text-brand border-brand bg-accent"
                      : "text-ink-meta hover:text-ink hover:bg-well border-transparent",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
