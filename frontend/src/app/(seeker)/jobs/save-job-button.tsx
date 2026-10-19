"use client";

import { useRef, useState, useTransition } from "react";

import { SaveButton } from "@/components/save-button";
import { useToast } from "@/components/ui/toast";

import type { ApplicationStage } from "../auto-apply/actions";
import { saveJob, unsaveJob } from "./actions";

/**
 * A job's Save button on its card and its own page (KAN-261): <SaveButton>
 * with a click that keeps the job as saved through the API (./actions,
 * saveJob), and a second click that takes it back out (unsaveJob). A saved
 * job is a Saved card on My Applications.
 *
 * `stage` is the job's application as the server read it when it drew the
 * page, the same one its Auto Apply button gets: the button starts filled
 * when it is saved. A job already queued or applied has an application, not
 * a bookmark, so a click there changes nothing and a toast says where it is.
 *
 * The bookmark fills the moment it is clicked and empties again if the API
 * refuses, with a toast saying why: a save is cheap and almost never fails,
 * so waiting on it would make the button feel broken.
 */
export function SaveJobButton({
  jobId,
  title,
  stage,
}: {
  jobId: string;
  title: string;
  stage: ApplicationStage | null;
}) {
  const toast = useToast();
  const [saved, setSaved] = useState(stage === "saved");
  const [pending, start] = useTransition();
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
          }
          return;
        }
        const result = await saveJob(jobId);
        if (result.error != null) {
          setSaved(false);
          toast.show({ message: `Couldn't save ${title}. ${result.error}` });
        } else if (result.stage !== "saved") {
          setSaved(false);
          toast.show({
            message:
              result.stage === "applied"
                ? `You already applied to ${title}.`
                : `${title} is already in Auto Apply.`,
          });
        }
      } finally {
        busy.current = false;
      }
    });
  }

  return <SaveButton title={title} saved={saved} onClick={toggle} disabled={pending} />;
}
