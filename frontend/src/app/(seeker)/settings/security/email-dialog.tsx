"use client";

import { useActionState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/shadcn/dialog";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { changeEmail, type EmailState } from "@/lib/account-actions";

const INITIAL: EmailState = { error: null, sentTo: null };

/**
 * Change Email behind a button. Nothing changes when the form is sent:
 * Supabase emails a confirm link, so the dialog then says where to look,
 * and Sign-In & Security says so again when the link brings the student
 * back (./page, `notice`).
 */
export function EmailDialog({ current }: { current: string }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            Change
          </Button>
        }
      />
      <DialogContent>
        <EmailForm current={current} />
      </DialogContent>
    </Dialog>
  );
}

function EmailForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(changeEmail, INITIAL);

  if (state.sentTo) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Check Your Email</DialogTitle>
          <DialogDescription>
            We sent a link to <span className="text-ink font-medium">{state.sentTo}</span>. Your
            sign-in email changes after you open it. If a link also comes to {current}, open that
            one too.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button>Done</Button>} />
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-subtitle font-semibold">Change Sign-In Email</DialogTitle>
        <DialogDescription>
          You sign in with {current} now. The email employers see is on My Profile, under Contact
          &amp; Links.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="flex flex-col gap-4">
        <TextField
          id="new-email"
          name="email"
          type="email"
          label="New Email"
          autoComplete="email"
          maxLength={100}
          required
          defaultValue=""
        />
        {state.error && (
          <p role="alert" className="text-meta text-danger">
            {state.error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send Link"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
