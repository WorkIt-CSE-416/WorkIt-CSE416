"use client";

import { useEffect, useState, type ReactNode } from "react";

import { CheckIcon, ExternalLinkIcon, ToolbarPinIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { extensionState, type ExtensionState } from "@/lib/autofill-extension";

/**
 * Where the student adds the WorkIt extension (KAN-378). Unset until the
 * extension has a Chrome Web Store listing; the step then says where to get
 * it instead of offering a button.
 */
const INSTALL_URL = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL;

/** How often the step asks the extension again, so it sees an install or a pin without a reload. */
const POLL_MS = 1500;

/**
 * The extension as the install step sees it, asked now and every POLL_MS
 * while `active`: null before the first answer.
 */
export function useExtensionState(active: boolean): ExtensionState | null {
  const [state, setState] = useState<ExtensionState | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const ask = async () => {
      const next = await extensionState();
      if (!stopped) setState(next);
    };
    void ask();
    const timer = setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
  return state;
}

/**
 * Onboarding's fourth step (KAN-378): add the extension and pin it. The
 * page asks the extension (`ping`) every POLL_MS, so each line turns done as
 * the student does it, with no reload. Pinning is asked for, not required:
 * the extension is what batch apply runs in, and the pin keeps it one click
 * away on any form; Chrome has no way for a page to pin it.
 */
export function ExtensionStep({ state }: { state: ExtensionState | null }) {
  const installed = state?.installed === true;
  const pinned = installed ? state.pinned : null;
  return (
    <ol className="flex flex-col gap-4">
      <Line
        n={1}
        title="Add WorkIt to Chrome"
        done={installed}
        status={state === null ? null : installed ? "Added" : "Not Added Yet"}
      >
        {installed ? (
          <p>WorkIt sees the extension.</p>
        ) : (
          <>
            <p>
              The extension fills each application form in its own tab. You review every tab and
              press the form&apos;s Submit yourself; it never submits for you.
            </p>
            {INSTALL_URL ? (
              <ButtonLink
                href={INSTALL_URL}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                size="sm"
                className="mt-3 self-start"
              >
                Add to Chrome
                <ExternalLinkIcon className="size-4" />
              </ButtonLink>
            ) : (
              <p className="text-ink-meta mt-2">
                The extension isn&apos;t in the Chrome Web Store yet. Ask the WorkIt team for it.
              </p>
            )}
            <p className="text-ink-meta mt-2">This page sees it as soon as it is added.</p>
          </>
        )}
      </Line>
      <Line
        n={2}
        title="Pin It to the Toolbar"
        done={pinned === true}
        status={pinned === null ? null : pinned ? "Pinned" : "Not Pinned"}
      >
        <p className="flex items-start gap-2">
          <ToolbarPinIcon className="text-ink-meta mt-0.5 size-4 shrink-0" />
          Click the puzzle piece beside the address bar, then the pin beside WorkIt.
        </p>
      </Line>
      {installed && !state.signedIn && (
        <p role="alert" className="text-body text-warning">
          The extension can&apos;t see your WorkIt sign-in. Reload this page.
        </p>
      )}
    </ol>
  );
}

function Line({
  n,
  title,
  done,
  status,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  /** The badge; none while the extension hasn't answered, or where Chrome can't say. */
  status: string | null;
  children: ReactNode;
}) {
  return (
    <li className="border-border bg-panel rounded-card flex gap-4 border p-5">
      <span
        aria-hidden
        className={
          done
            ? "bg-positive text-panel flex size-8 shrink-0 items-center justify-center rounded-full"
            : "bg-brand-tint text-brand text-body flex size-8 shrink-0 items-center justify-center rounded-full font-semibold"
        }
      >
        {done ? <CheckIcon className="size-4" /> : n}
      </span>
      <div className="text-body text-ink-muted flex min-w-0 flex-1 flex-col">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-subtitle text-ink">{title}</h2>
          {status && <Badge tone={done ? "positive" : "inert"}>{status}</Badge>}
        </div>
        {children}
      </div>
    </li>
  );
}
