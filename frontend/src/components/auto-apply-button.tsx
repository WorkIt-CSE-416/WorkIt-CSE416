import { Zap } from "lucide-react";

import { Button } from "@/components/ui/button";

/** A job posting's "Auto Apply", on its card and its own page, between Ask
 *  Scout and Apply Now. Ask Scout's secondary design, with the sidebar's
 *  Auto Apply glyph. Inert until the API can queue one job posting
 *  (KAN-223, auto-apply/architecture.md). */
export function AutoApplyButton() {
  return (
    <Button variant="secondary" size="sm">
      <Zap className="size-4" />
      Auto Apply
    </Button>
  );
}
