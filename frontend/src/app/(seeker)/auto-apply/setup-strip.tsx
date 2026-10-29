"use client";

import { useEffect, useState } from "react";

import { ChromeIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { extensionState } from "@/lib/autofill-extension";

/** Where the student adds the extension (KAN-378): unset until its Chrome Web Store listing exists. */
const INSTALL_URL = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL;

/**
 * Auto Apply's setup banner (KAN-424): shown only while the Chrome
 * extension is missing, the one thing Auto Apply can't run without. The
 * extension is asked itself (`ping`) on load and when the student comes
 * back to the tab, since an install happens elsewhere. Before it answers it
 * counts as installed, so a student who has it never sees the banner flash
 * in.
 *
 * ONLY WHAT IS REQUIRED (asked for 2026-10-29). It was "Set Up Auto Apply,
 * 1 of 3 done" with a Configure dialog, counting a default resume and the
 * Claude MCP as steps too, and students read all three as required. Both
 * are optional, so each now shows where it helps instead: a row with no
 * resume says No Resume and its Resume cell picks one, and a row's
 * Questions to Write chip links to Written Answers, which offers Connect
 * Claude while their Claude isn't connected (../write-with-claude.tsx).
 */
export function SetupStrip() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    let stopped = false;
    const ask = async () => {
      const state = await extensionState();
      if (!stopped) setInstalled(state.installed);
    };
    void ask();
    window.addEventListener("focus", ask);
    return () => {
      stopped = true;
      window.removeEventListener("focus", ask);
    };
  }, []);

  if (installed !== false) return null;

  return (
    <Card className="mt-6 flex flex-col gap-4 @2xl/main:flex-row @2xl/main:items-center">
      <span className="border-border-subtle bg-panel flex size-10 shrink-0 items-center justify-center rounded-lg border">
        <ChromeIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-label text-ink font-semibold">Add the Chrome Extension</h2>
        <p className="text-note text-ink-meta mt-0.5">
          Auto Apply fills each application in your own Chrome, and you press Submit.
          {!INSTALL_URL && " Ask the WorkIt team for the install link."}
        </p>
      </div>
      {INSTALL_URL && (
        <ButtonLink href={INSTALL_URL} target="_blank" rel="noreferrer" size="sm">
          Install
        </ButtonLink>
      )}
    </Card>
  );
}
