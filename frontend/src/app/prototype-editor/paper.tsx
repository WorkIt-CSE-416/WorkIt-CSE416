"use client";

// PROTOTYPE (KAN-195), throwaway. A stand-in for the Tectonic PDF of Jake's
// Resume: Letter sheets, serif, small-caps headings with a rule, dates flush
// right. Sized in container units so a sheet scales to any column width.
// The real preview is a PDF (KAN-190); nothing here is selectable in it.

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { bulletText, LINES_PER_PAGE, paginate, type Block, type State } from "./model";

const LINE = "2.2cqw"; // one line of 11pt on an 8.5in sheet

export function Paper({
  state,
  rendering = false,
  decorate,
  className,
}: {
  state: State;
  rendering?: boolean;
  /** Wraps one block's node, for layouts that edit on the page. */
  decorate?: (block: Block, node: ReactNode) => ReactNode;
  className?: string;
}) {
  const pages = paginate(state);
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {pages.map((page, i) => (
        <div key={i} className="@container relative">
          <div
            className={cn(
              "relative aspect-[8.5/11] w-full overflow-hidden bg-white text-black shadow-[0_1px_4px_rgb(0_0_0/0.18)] transition-opacity",
              rendering && "opacity-60",
            )}
            style={{
              padding: "5.9cqw",
              fontFamily: "'Latin Modern Roman', 'Computer Modern', Georgia, serif",
              fontSize: "1.75cqw",
              lineHeight: LINE,
            }}
          >
            {page.map((bl, j) => {
              const node = <BlockView block={bl} state={state} />;
              return <div key={j}>{decorate ? decorate(bl, node) : node}</div>;
            })}
          </div>
          <span className="text-note text-ink-meta absolute right-1 -bottom-0.5 translate-y-full">
            Page {i + 1} of {pages.length}
          </span>
        </div>
      ))}
    </div>
  );
}

function BlockView({ block, state }: { block: Block; state: State }) {
  const h = (n: number) => ({ minHeight: `calc(${LINE} * ${n})` });
  switch (block.kind) {
    case "header":
      return (
        <div className="text-center" style={h(block.lines)}>
          <div
            style={{
              fontSize: "4.2cqw",
              lineHeight: "5cqw",
              fontVariant: "small-caps",
              fontWeight: 700,
            }}
          >
            Jordan Lee
          </div>
          <div>
            631-555-0142 | <u>jordan.lee@stonybrook.edu</u> | <u>linkedin.com/in/jordanlee</u> |{" "}
            <u>github.com/jlee</u>
          </div>
        </div>
      );
    case "section":
      return (
        <div style={{ ...h(block.lines), paddingTop: "1cqw" }}>
          <div
            style={{
              fontVariant: "small-caps",
              fontSize: "2.3cqw",
              borderBottom: "0.12cqw solid black",
            }}
          >
            {block.section}
          </div>
        </div>
      );
    case "entry": {
      const e = block.entry;
      if (e.section === "Awards" || e.section === "Certifications")
        return (
          <div className="flex justify-between" style={{ paddingLeft: "1.5cqw" }}>
            <span>
              <b>{e.title}</b>
              {e.org && <>, {e.org}</>}
            </span>
            <span>{e.dates}</span>
          </div>
        );
      return (
        <div style={{ paddingLeft: "1.5cqw" }}>
          <div className="flex justify-between">
            <b>{e.section === "Education" ? e.org : e.title}</b>
            <span>{e.dates}</span>
          </div>
          <div className="flex justify-between italic" style={{ fontSize: "1.55cqw" }}>
            <span>
              {e.section === "Education" ? e.title : e.org}
              {e.section === "Education" && state.built.showGpa && e.gpa && <> · GPA {e.gpa}</>}
            </span>
            <span>{e.location}</span>
          </div>
          {e.section === "Education" && state.built.showCoursework && e.coursework && (
            <div style={{ fontSize: "1.55cqw" }}>
              <b>Relevant Coursework:</b> {e.coursework.join(", ")}
            </div>
          )}
        </div>
      );
    }
    case "bullet":
      return (
        <div className="flex" style={{ paddingLeft: "3.5cqw", fontSize: "1.55cqw" }}>
          <span style={{ width: "2cqw", flex: "none" }}>•</span>
          <span>{bulletText(state, block.bullet)}</span>
        </div>
      );
    case "skill":
      return (
        <div style={{ paddingLeft: "1.5cqw", fontSize: "1.55cqw" }}>
          <b>{block.group.group}:</b> {block.group.items.join(", ")}
        </div>
      );
  }
}

/** "1 page" / "1.2 pages, 11 lines over" in plain words, for every layout. */
export function fitLabel(lines: number) {
  if (lines <= LINES_PER_PAGE)
    return {
      tone: "positive" as const,
      text: `Fits on 1 page · ${LINES_PER_PAGE - lines} lines spare`,
    };
  const over = lines - LINES_PER_PAGE;
  return {
    tone: "warning" as const,
    text: `${Math.ceil(lines / LINES_PER_PAGE)} pages · ${over} line${over === 1 ? "" : "s"} over 1 page`,
  };
}
