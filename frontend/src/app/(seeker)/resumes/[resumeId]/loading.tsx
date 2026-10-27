import { cn } from "@/lib/cn";

import { BackLink } from "../../back-link";
import { SEEKER_GUTTER } from "../../gutter";
import { EDITOR_PARENT } from "./back";
import { EditorSkeleton } from "./editor";

/**
 * The resume editor while its plain reads land (KAN-368): the resume list
 * (for the title), the bank, the choices and the profile. The PDF itself
 * streams in after (./page.tsx), so this stands in only until the editor's
 * frame can draw, and it is that frame: Back (live), then the editor's
 * title row, its slim bar and a page's skeleton (EditorSkeleton), which
 * the editor keeps over its page area while the compile runs. ../../home/loading.tsx says why only the slow pages
 * have one.
 *
 * On a phone the editor covers the screen with its own layout once it
 * mounts, as it always has after the desktop first paint.
 */
export default function ResumeEditorLoading() {
  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <BackLink parent={EDITOR_PARENT} />
      <div role="status">
        <span className="sr-only">Loading the resume</span>
        <EditorSkeleton />
      </div>
    </div>
  );
}
