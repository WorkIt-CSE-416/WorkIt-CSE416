"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";

type StepApi = {
  /** Shows `step` in place of the section, until Back or `close`. */
  open: (step: ReactNode) => void;
  close: () => void;
};

export const SettingsStepContext = createContext<StepApi | null>(null);

/**
 * A form opened from a Settings row is a step of the modal, never a dialog
 * over it (KAN-563, `docs/design.md`, "Never a dialog over a dialog"): the
 * section's pane swaps to the step, with Back beside its title, and Back,
 * Cancel, Escape or the nav put the section back as it was. Change Email,
 * Change Password and Delete Account opened as dialogs over the modal until
 * then, with no dim of their own, so they overlapped the card behind them.
 */
export function useSettingsStep(): StepApi {
  const api = useContext(SettingsStepContext);
  if (!api) throw new Error("A Settings step opens inside the Settings modal.");
  return api;
}

/** A step's card: Back and its title, the line under them, then the form. */
export function SettingsStep({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const { close } = useSettingsStep();
  const id = useId();

  return (
    <Card as="section" aria-labelledby={id} className="animate-fade flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <IconButton label="Back" className="-ml-1.5 size-8" onClick={close}>
            <ArrowLeftIcon className="size-4" />
          </IconButton>
          <h3 id={id} className="text-subtitle text-ink font-semibold">
            {title}
          </h3>
        </div>
        <p className="text-body text-ink-meta">{description}</p>
      </div>
      {children}
    </Card>
  );
}

/** A step's buttons: a Settings form's, left with the primary first
 *  (`docs/design.md`, Components). */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
