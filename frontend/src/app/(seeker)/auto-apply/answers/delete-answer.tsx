"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { DeleteConfirm } from "../../resumes/delete-confirm";
import { deleteAnswer } from "./actions";

/**
 * Delete under every answer in Your Answers (KAN-369): the student's own (a
 * Looks right or Save for next time in a batch tab), one pasted with Check
 * and Save, or their Claude's. Not own limits reuse, not removal. It asks
 * first, on the line under the answer (DeleteConfirm, as Resumes does),
 * then takes the answer back (deleteAnswer) and refreshes the route so
 * the server draws the list without it. Later forms no longer fill it; a
 * question the tab still asks comes back above, unanswered, for their
 * Claude or for them. A failed delete keeps the answer and says why.
 * `busy` (a ref) holds a second press: `pending` lands a render late.
 */
export function DeleteAnswer({ jobId, name }: { jobId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  function remove() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await deleteAnswer(jobId, name);
        if (result.error) {
          setError(`WorkIt couldn't delete it. ${result.error}`);
          return;
        }
        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <dd>
      {confirming ? (
        <DeleteConfirm
          label="Delete Answer"
          busy={pending}
          onDelete={remove}
          onKeep={() => {
            setConfirming(false);
            setError(null);
          }}
        >
          Delete this answer? Later forms won&apos;t fill it.
        </DeleteConfirm>
      ) : (
        <Button variant="section" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      )}
      {error && (
        <p role="alert" className="text-note text-danger mt-2">
          {error}
        </p>
      )}
    </dd>
  );
}
