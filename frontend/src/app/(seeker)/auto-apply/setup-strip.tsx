"use client";

import { CheckCircleIcon, CheckIcon, CircleDashedIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ChromeIcon, ClaudeIcon, FileIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { extensionState } from "@/lib/autofill-extension";
import { cn } from "@/lib/cn";

/** Where the student adds the extension (KAN-378): unset until its Chrome Web Store listing exists. */
const INSTALL_URL = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL;

type Step = {
  id: string;
  /** The step's logo: Chrome's, a resume, Claude's. */
  Logo: (props: { className?: string }) => ReactNode;
  /** The step's name, the same whether it is done or not: the mark says which. */
  name: string;
  /** What it does for a batch, in the dialog (a link may sit in it). */
  why: ReactNode;
  done: boolean;
  /** What the dialog says beside a done step. */
  doneLabel: string;
  /** The one action that does it while it isn't done: a button, or a status pill when there is none. */
  action: ReactNode;
};

/**
 * Auto Apply's setup banner (KAN-424): what a batch needs, under the
 * heading, shown only while something is missing and gone once all of it
 * is done. It replaced the header's Add to Claude, a one-time step that
 * stayed there for good, and the Written Questions Waiting card, which
 * counted questions without saying whose they were (each Up Next row's chip
 * says that now).
 *
 * The banner is "Set Up Auto Apply", how many steps are done, the three
 * steps with a mark each (a green check, or a gray circle), and one
 * **Configure**: the banner sets up the tool, so its button says that, and
 * opens a dialog with each step, what it is for and its action. A button
 * per missing step's action ("Set Default" for a resume) read as a puzzle
 * out of context, so the actions live beside their reasons in the dialog:
 *
 *   Chrome Extension   asked of the extension itself (`ping`) on load and
 *                      when the student comes back to the tab, as an install
 *                      happens elsewhere; Install while its store link is set
 *   Default Resume     read on the server; Open Resumes, where the star sets it
 *   Claude MCP         the WorkIt connector in the student's Claude (GET
 *                      .../connector, on the server); Connect opens Claude's
 *                      Add Custom Connector dialog. Optional, so the dialog
 *                      names Written Answers too. A failed read (`claude`
 *                      null) leaves it out.
 *
 * Before the extension answers it counts as done, so a student with
 * everything set up never sees the banner flash in.
 */
export function SetupStrip({
  hasDefaultResume,
  claude,
  claudeLink,
  questions,
}: {
  hasDefaultResume: boolean;
  /** Whether the student's Claude holds a WorkIt sign-in; null when that couldn't be read. */
  claude: boolean | null;
  /** Claude's Add Custom Connector dialog, filled in for WorkIt (lib/claude-connector.ts). */
  claudeLink: string;
  /** Written questions waiting on any queued job. */
  questions: number;
}) {
  const [extension, setExtension] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stopped = false;
    const ask = async () => {
      const state = await extensionState();
      if (!stopped) setExtension(state.installed);
    };
    void ask();
    window.addEventListener("focus", ask);
    return () => {
      stopped = true;
      window.removeEventListener("focus", ask);
    };
  }, []);

  const steps: Step[] = [
    {
      id: "extension",
      Logo: ChromeIcon,
      name: "Chrome Extension",
      why: INSTALL_URL
        ? "Fills each application in your own Chrome. You press Submit."
        : "Fills each application in your own Chrome. You press Submit. Ask the WorkIt team for the install link.",
      done: extension !== false,
      doneLabel: "Installed",
      action: INSTALL_URL ? (
        <ButtonLink
          href={INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          variant="secondary"
          size="sm"
        >
          Install
        </ButtonLink>
      ) : (
        <Badge tone="outline">Not Installed</Badge>
      ),
    },
    {
      id: "resume",
      Logo: ({ className }) => <FileIcon className={cn("text-brand", className)} />,
      name: "Default Resume",
      why: "The resume Auto Apply attaches when a job has no resume of its own. Star one on Resumes.",
      done: hasDefaultResume,
      doneLabel: "Starred",
      action: (
        <ButtonLink href="/resumes" variant="secondary" size="sm">
          Open Resumes
        </ButtonLink>
      ),
    },
    ...(claude === null
      ? []
      : [
          {
            id: "claude",
            Logo: ClaudeIcon,
            name: "Claude MCP",
            why: (
              <>
                Lets your Claude write your applications&apos; written answers
                {questions > 0
                  ? ` (${questions} ${questions === 1 ? "question" : "questions"} waiting)`
                  : ""}
                . Or write them yourself on{" "}
                <Link
                  href="/auto-apply/answers"
                  className="text-ink underline underline-offset-2 hover:no-underline"
                >
                  Written Answers
                </Link>
                .
              </>
            ),
            done: claude,
            doneLabel: "Connected",
            action: (
              <ButtonLink
                href={claudeLink}
                target="_blank"
                rel="noreferrer"
                variant="secondary"
                size="sm"
              >
                <ClaudeIcon className="size-4" />
                Connect
              </ButtonLink>
            ),
          },
        ]),
  ];
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;

  return (
    <>
      {/* Three parts across: the title and its count at the left, the steps centred in the room between,
          and Configure at the right. Left-aligned, the steps sat beside the title and left a wide empty
          middle, which read as off. Below 42rem of page they stack. */}
      <Card className="mt-6 grid gap-4 @2xl/main:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @2xl/main:items-center">
        <div className="min-w-0">
          <h2 className="text-subtitle text-ink font-semibold">Set Up Auto Apply</h2>
          <p className="text-note text-ink-meta mt-0.5">
            {done} of {steps.length} done
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 @2xl/main:justify-center">
          {steps.map((step) => (
            <li key={step.id} className="text-label flex items-center gap-2">
              <span className="relative">
                <step.Logo className="size-5" />
                <span className="bg-panel absolute -right-1.5 -bottom-1.5 rounded-full">
                  <Mark done={step.done} />
                </span>
              </span>
              <span className={step.done ? "text-ink-meta" : "text-ink"}>{step.name}</span>
            </li>
          ))}
        </ul>
        <div className="@2xl/main:flex @2xl/main:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Configure
          </Button>
        </div>
      </Card>

      {/* Laid out as a settings page is (Claude's): each row a name over its reason in a column of its own
          width, and its control in a fixed column at the right, centred on the row, so every button and
          status lines up and no text runs under one. Done is a status pill there, never loose green text. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-subtitle font-semibold">Set Up Auto Apply</DialogTitle>
            <DialogDescription>Finish these before you start Auto Apply.</DialogDescription>
          </DialogHeader>
          <ul className="border-border-subtle divide-border-subtle divide-y border-t">
            {steps.map((step) => (
              <li
                key={step.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_9rem] items-center gap-x-4 py-4"
              >
                <span className="border-border-subtle bg-panel flex size-10 items-center justify-center rounded-lg border">
                  <step.Logo className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-label text-ink font-semibold">{step.name}</p>
                  <p className="text-note text-ink-meta mt-1">{step.why}</p>
                </div>
                <div className="flex justify-end">
                  {step.done ? (
                    <Badge tone="positive">
                      <CheckIcon aria-hidden className="mr-1 size-3.5 shrink-0" />
                      {step.doneLabel}
                    </Badge>
                  ) : (
                    step.action
                  )}
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A step's mark, on its logo's corner: a filled green check when done, a
 * hollow dashed circle while it isn't, an empty slot waiting for its check.
 * A filled gray dot was tried first and read as a stray blot on the logo.
 */
function Mark({ done }: { done: boolean }) {
  return done ? (
    <CheckCircleIcon aria-label="Done" weight="fill" className="text-positive size-3.5" />
  ) : (
    <CircleDashedIcon aria-label="Not done" weight="bold" className="text-ink-meta size-3.5" />
  );
}
