"use client";

import { signOut } from "@/app/actions";
import { SignOutIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { clearLocalDrafts } from "@/lib/local-drafts";

/** Settings' Sign Out, the same two steps as the account menu's row:
 *  this student's drafts leave the browser (lib/local-drafts.ts), then the
 *  session ends. */
export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="self-start"
      onClick={() => {
        clearLocalDrafts();
        void signOut();
      }}
    >
      <SignOutIcon />
      Sign Out
    </Button>
  );
}
