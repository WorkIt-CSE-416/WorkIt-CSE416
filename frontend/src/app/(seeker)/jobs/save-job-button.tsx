"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";

import { SaveButton } from "@/components/save-button";
import { useToast } from "@/components/ui/toast";

import { hasApplied } from "../applied";
import type { ApplicationStage } from "../auto-apply/actions";
import { saveJob, unsaveJob } from "./actions";
import { readShownList, rememberStage, subscribe } from "./shown-list";

/**
 * A job's Save button on its card and its own page (KAN-261): <SaveButton>
 * with a click that keeps the job as saved through the API (./actions,
 * saveJob), and a second click that takes it back out (unsaveJob). A saved
 * job is on the Tracker, and off the Jobs page (KAN-217): a
 * save there takes its card off the list at once (./feed-stages).
 *
 * A SAVE SAYS WHERE THE JOB WENT (KAN-217): a toast, "Saved to your
 * Tracker.", with two buttons side by side, View (the
 * application's own page) and Undo,
 * which takes the save back and so puts the card back on the list. The toast
 * outlives the card it came from (it lives in the root layout), so its Undo
 * works from the shown list, never this button's state alone.
 *
 * `stage` is the job's application as the server read it when it drew the
 * page, the same one its Auto Apply button gets: the button starts filled
 * when it is saved. A job already queued or applied has an application, not
 * a bookmark, so a click there changes nothing and a toast says where it is.
 *
 * The bookmark fills the moment it is clicked and empties again if the API
 * refuses, with a toast saying why: a save is cheap and almost never fails,
 * so waiting on it would make the button feel broken.
 *
 * ONE JOB CAN SHOW TWO OF THESE (KAN-519): its compact card and its page, side
 * by side. A click writes the job's stage into the shown list (./shown-list),
 * and every Save for that job follows it.
 */
export function SaveJobButton({
  jobId,
  title,
  stage,
  quiet,
}: {
  jobId: string;
  title: string;
  stage: ApplicationStage | null;
  /** The compact card's bare glyph (`SaveButton`). */
  quiet?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [saved, setSaved] = useState(stage === "saved");
  const [pending, start] = useTransition();
  const kept = useSyncExternalStore(
    subscribe,
    () => readShownList()?.stages?.[jobId],
    () => undefined,
  );
  const [followed, setFollowed] = useState(kept);
  if (followed !== kept) {
    setFollowed(kept);
    if (kept !== undefined) setSaved(kept === "saved");
  }
  // One click at a time: `disabled={pending}` lands a render late.
  const busy = useRef(false);

  function toggle() {
    if (busy.current) return;
    busy.current = true;
    const saving = !saved;
    setSaved(saving);
    start(async () => {
      try {
        if (!saving) {
          const result = await unsaveJob(jobId);
          if (result.error) {
            setSaved(true);
            toast.show({ message: `Couldn't remove ${title} from saved. ${result.error}` });
          } else {
            rememberStage(jobId, null);
          }
          return;
        }
        const result = await saveJob(jobId);
        if (result.error != null) {
          setSaved(false);
          toast.show({ message: `Couldn't save ${title}. ${result.error}` });
        } else {
          rememberStage(jobId, result.stage);
          if (result.stage === "saved") {
            toast.show({
              message: "Saved to your Tracker.",
              actions: [
                {
                  label: "View",
                  onClick: () => router.push(`/applications/${encodeURIComponent(jobId)}`),
                },
                { label: "Undo", onClick: () => undo() },
              ],
            });
          } else {
            setSaved(false);
            toast.show({
              message: hasApplied(result.stage)
                ? `You already applied to ${title}.`
                : `${title} is already in Auto Apply.`,
            });
          }
        }
      } finally {
        busy.current = false;
      }
    });
  }

  /** The toast's Undo: unsaves, and the job comes back to every list. */
  async function undo() {
    const result = await unsaveJob(jobId);
    if (result.error) {
      toast.show({ message: `Couldn't take ${title} back. ${result.error}` });
      return;
    }
    rememberStage(jobId, null);
    setSaved(false);
  }

  return (
    <SaveButton title={title} saved={saved} onClick={toggle} disabled={pending} quiet={quiet} />
  );
}
