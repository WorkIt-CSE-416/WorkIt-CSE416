"use client";

// PROTOTYPE (KAN-201), throwaway. C: no typing on a phone. The fitted page is
// a review surface: tap a line to read it at phone size and hide it, move it,
// pick a Tailor version or ask for "Make it shorter". Changing words waits
// for a computer, with one tap to send yourself a link (Simplify's model).

import { Laptop, Mail, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { bulletText, useRendered, type Block, type Editor } from "../prototype-editor/model";
import { Paper } from "../prototype-editor/paper";
import {
  Assistant,
  Header,
  hiddenItems,
  LineActions,
  NotOnResume,
  PhoneFrame,
  Sheet,
  TAP,
  type Sel,
} from "./phone";

export const NAME = "Review only";

export function VariantC({ editor }: { editor: Editor }) {
  const { state } = editor;
  const { rendering } = useRendered(state);
  const [sel, setSel] = useState<Sel | null>(null);
  const [panel, setPanel] = useState<"tray" | "ask" | null>(null);
  const [sent, setSent] = useState(false);

  function decorate(block: Block, node: ReactNode) {
    if (block.kind !== "entry" && block.kind !== "bullet") return node;
    const s: Sel =
      block.kind === "entry"
        ? { kind: "entry", entry: block.entry }
        : { kind: "bullet", entry: block.entry, bullet: block.bullet };
    const id = block.kind === "entry" ? block.entry.id : block.bullet.id;
    const on = sel && (sel.kind === "entry" ? sel.entry.id : sel.bullet.id) === id;
    return (
      <div
        onClick={() => setSel(s)}
        className={cn(
          "cursor-pointer rounded-[0.4cqw]",
          on && "bg-[#f6f2ff] outline outline-[0.35cqw] outline-[#9b7bff]",
        )}
      >
        {node}
      </div>
    );
  }

  const { count } = hiddenItems(editor);
  return (
    <PhoneFrame>
      <Header editor={editor} />
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-28">
        <div className="text-note mb-3 flex items-center gap-2 rounded-2xl bg-[#f3efff] p-3 text-[#4a3a7a]">
          <Laptop className="size-4 shrink-0" />
          <span className="flex-1">
            Tap a line to hide, move or swap it. To change the words, use a computer.
          </span>
          <button
            className="text-note shrink-0 font-semibold text-[#6d3fd8]"
            onClick={() => setSent(true)}
          >
            {sent ? "Link Sent" : "Email Me a Link"}
          </button>
        </div>
        <Paper state={state} rendering={rendering} decorate={decorate} />
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 flex gap-2 border-t border-[#ece6ff] bg-white/95 px-4 pt-2 pb-6 backdrop-blur">
        <button
          className={cn(TAP, "flex-1 ring-1 ring-[#e4dcff]")}
          onClick={() => setPanel("tray")}
        >
          Not on This Resume {count > 0 && <span className="text-ink-meta">({count})</span>}
        </button>
        <button
          className={cn(TAP, "flex-1 text-[#6d3fd8] ring-1 ring-[#e4dcff]")}
          onClick={() => setPanel("ask")}
        >
          <Sparkles className="size-4" /> Ask WorkIt
        </button>
      </div>

      <Sheet
        open={sel !== null && panel === null}
        onClose={() => setSel(null)}
        title={sel?.kind === "bullet" ? `Bullet · ${sel.entry.title}` : sel?.entry.title}
      >
        {sel && (
          <>
            {/* Read at phone size; not a field. */}
            <p className="text-ink rounded-xl bg-white p-3 text-[16px] leading-6 ring-1 ring-[#ece6ff]">
              {sel.kind === "bullet"
                ? bulletText(state, sel.bullet)
                : [sel.entry.title, sel.entry.org, sel.entry.location, sel.entry.dates]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            <LineActions editor={editor} sel={sel} onHidden={() => setSel(null)} />
            {sel.kind === "bullet" && (
              <button
                className={cn(TAP, "text-[#6d3fd8] ring-1 ring-[#e4dcff]")}
                onClick={() => setPanel("ask")}
              >
                <Sparkles className="size-4" /> Make It Shorter
              </button>
            )}
            <button className={cn(TAP, "text-ink-meta")} onClick={() => setSent(true)}>
              <Mail className="size-4" />{" "}
              {sent ? "Link sent to your email" : "Edit the words on a computer"}
            </button>
          </>
        )}
      </Sheet>
      <Sheet open={panel === "tray"} onClose={() => setPanel(null)} title="Not on This Resume">
        <NotOnResume editor={editor} />
      </Sheet>
      <Sheet open={panel === "ask"} onClose={() => setPanel(null)} title="WorkIt Assistant">
        <Assistant editor={editor} sel={sel} />
      </Sheet>
    </PhoneFrame>
  );
}
