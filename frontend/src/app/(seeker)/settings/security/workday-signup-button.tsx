"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { openWorkdaySignup } from "@/lib/autofill-extension";

/**
 * Settings' Workday Sign-Up row action: opens the WorkIt Autofiller's own
 * Workday Sign-Up page (autofiller_extension/src/options/), where the
 * student sets one email and password for every company's Workday. The
 * password lives in the extension's storage in this browser only, so it is
 * never typed on this page or sent to WorkIt.
 */
export function WorkdaySignupButton() {
  const [missing, setMissing] = useState(false);

  async function open() {
    setMissing(!(await openWorkdaySignup()));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={open}>
        Set Up
      </Button>
      {missing && (
        <p role="alert" className="text-meta text-danger max-w-56 text-right">
          Add the WorkIt Autofiller to Chrome first.
        </p>
      )}
    </div>
  );
}
