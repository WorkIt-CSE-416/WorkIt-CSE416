/**
 * Re-export, not a component.
 *
 * `shadcn add` writes components that import their Button from this path, and
 * regenerating one would overwrite whatever sits here. WorkIt has a single
 * Button — src/components/ui/button.tsx — that answers to shadcn's variant and
 * size names, so pointing this file at it keeps generated components working
 * without a second implementation to keep in step.
 *
 * If `shadcn add` ever replaces this file with the stock Button, restore these
 * two lines. `npx shadcn@latest add <name> --dry-run` warns before it happens.
 */
export { Button, buttonVariants } from "@/components/ui/button";
