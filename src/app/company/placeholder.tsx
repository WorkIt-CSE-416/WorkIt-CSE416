import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

/**
 * The body of a company screen that has a route but not a design yet.
 *
 * Four stubs would otherwise hand-roll the same header and the same empty box,
 * and the point of scaffolding the routes ahead of the screens is that the
 * shell, the nav and the URLs can be reviewed now. Keeping the stub in one
 * place means the four pages differ only by what they say they are for.
 *
 * It lives beside the routes rather than in src/components because nothing
 * outside /company uses it, and because it should be deleted rather than
 * generalised: every page that grows a real layout stops importing it, and the
 * file goes when the last one does.
 *
 * The heading block matches what the built seeker screens use — text-heading
 * over text-body in ink-meta, inside the same max-w-app container — so a stub
 * and a finished screen line up when you click between them.
 */
type PlaceholderProps = {
  title: string;
  description: string;
  /** What this screen is expected to hold. Written for the person who picks the
   *  ticket up, so keep it to the shape of the screen, not a feature list. */
  children?: ReactNode;
};

export function Placeholder({ title, description, children }: PlaceholderProps) {
  return (
    <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
      <h1 className="text-heading text-ink">{title}</h1>
      <p className="text-body text-ink-meta mt-1">{description}</p>

      <Card className="mt-4 border-dashed" elevated={false}>
        <p className="text-note text-ink-faint">Not built yet — route and shell only.</p>
        {children ? <div className="text-body text-ink-meta mt-2">{children}</div> : null}
      </Card>
    </main>
  );
}
