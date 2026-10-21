"use client";

import { Check, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

import { stages } from "./board-data";
import { journey, type JourneyStep } from "./data";
import { FaviconLogo } from "./favicon-logo";
import { autoApplyFeature, updatesFeature } from "./feature-data";

/**
 * The search from end to end as four tall cards, after Calendly's "Book,
 * Prep, Capture, Follow up" row. From lg up the open card is wider and shows
 * its points and a small demo; the others keep only their title and line.
 * Pointing at a card, focusing it or clicking it opens it, and it stays open
 * until another one is. Below lg every card is open, stacked, since there is
 * no hover to open one.
 */
export function Journey() {
  const [open, setOpen] = useState<JourneyStep["id"]>(journey[0].id);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:h-[34rem] lg:gap-3">
      {journey.map((step) => {
        const isOpen = step.id === open;
        return (
          <article
            key={step.id}
            data-open={isOpen || undefined}
            onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(step.id)}
            onFocus={() => setOpen(step.id)}
            onClick={() => setOpen(step.id)}
            className={cn(
              "group/card relative isolate flex flex-col overflow-hidden rounded-[2rem] bg-white p-6 ring-1 ring-slate-900/5",
              "lg:min-w-0 lg:flex-1 lg:transition-[flex-grow] lg:duration-500 lg:ease-[cubic-bezier(0.16,1,0.3,1)] lg:data-open:flex-[2.4] lg:motion-reduce:transition-none",
            )}
          >
            {/* The card's glow: faint while closed, full once open. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 -z-10 h-2/3 opacity-60 transition-opacity duration-500 group-data-open/card:opacity-100 max-lg:opacity-100"
              style={{
                background: `radial-gradient(70% 90% at 30% 100%, color-mix(in oklab, ${step.glow} 30%, transparent), transparent), radial-gradient(60% 80% at 90% 100%, color-mix(in oklab, ${step.glow} 18%, transparent), transparent)`,
              }}
            />

            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                className="text-ink text-left text-2xl font-semibold tracking-tight focus-visible:outline-none"
              >
                {step.title}
              </button>
            </h3>
            <p className="text-ink-meta mt-2 text-sm lg:max-w-[20rem]">
              {isOpen ? step.body : step.line}
            </p>

            {/* Kept in the layout while closed, so opening never reflows the
                text above; only shown from lg up once open. */}
            <div
              className={cn(
                "mt-5 flex flex-1 flex-col transition-opacity duration-300 motion-reduce:transition-none",
                "lg:invisible lg:opacity-0 lg:group-data-open/card:visible lg:group-data-open/card:opacity-100 lg:group-data-open/card:delay-150",
              )}
            >
              <ul className="space-y-2.5">
                {step.points.map((point) => (
                  <li key={point} className="text-ink flex items-center gap-2.5 text-sm">
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ background: step.glow }}
                    >
                      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-6 lg:w-[25rem] lg:max-w-full">
                <Demo id={step.id} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** A small, still picture of the step, drawn from the page's sample data. */
function Demo({ id }: { id: JourneyStep["id"] }) {
  const shell = "rounded-2xl bg-white p-4 shadow-lg ring-1 shadow-slate-900/10 ring-slate-900/5";

  if (id === "find") {
    const job = stages[1].jobs[0];
    return (
      <div aria-hidden="true" className={shell}>
        <div className="flex items-center gap-3">
          <FaviconLogo domain={job.domain} className="rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-ink truncate text-sm font-semibold">{job.title}</p>
            <p className="text-ink-meta text-xs">{job.company}</p>
          </div>
          <span className="bg-landing-brand-100 text-landing-brand-800 rounded-full px-2 py-0.5 text-xs font-semibold">
            {job.score}% match
          </span>
        </div>
      </div>
    );
  }

  if (id === "apply") {
    return (
      <div aria-hidden="true" className={cn(shell, "space-y-2")}>
        {autoApplyFeature.sections
          .flatMap((section) => section.fields)
          .filter((field) => ["email", "phone", "resume"].includes(field.id))
          .map((field) => (
            <div key={field.id} className="flex items-center gap-3 text-xs">
              <span className="text-ink-meta w-16 shrink-0">{field.label}</span>
              <span className="text-ink bg-surface ring-border flex h-7 flex-1 items-center rounded-md px-2 ring-1">
                {field.value}
              </span>
              <Check className="text-positive size-3.5" aria-hidden="true" />
            </div>
          ))}
      </div>
    );
  }

  if (id === "track") {
    return (
      <div aria-hidden="true" className={cn(shell, "flex flex-wrap items-center gap-1.5")}>
        {stages.map((stage, index) => {
          const Icon: LucideIcon = stage.icon;
          return (
            <span key={stage.id} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
                  stage.chipClass,
                )}
              >
                <Icon className={cn("size-3", stage.iconClass)} />
                {stage.label}
              </span>
              {index < stages.length - 1 && <span className="text-ink-faint text-xs">→</span>}
            </span>
          );
        })}
      </div>
    );
  }

  const update =
    updatesFeature.updates.find((item) => item.kind === "offer") ?? updatesFeature.updates[0];
  return (
    <div aria-hidden="true" className={cn(shell, "flex items-center gap-3")}>
      <FaviconLogo domain={update.domain} className="rounded-lg" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-ink truncate">
          <span className="font-semibold">{update.company}</span> {update.action}
        </p>
        <p className="text-ink-meta truncate text-xs">{update.detail}</p>
      </div>
      <span className="text-ink-meta text-xs">Just now</span>
    </div>
  );
}
