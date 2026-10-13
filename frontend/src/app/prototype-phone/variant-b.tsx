"use client";

// PROTOTYPE (KAN-201), throwaway. B: on a phone the editor is an outline, not
// the page. Every line is a row at phone text size; tap one and it opens in
// place with its field and actions. Hidden bullets stay in their place,
// faded, with Show. A dashed rule marks where page 1 ends, so overflow shows
// without the page. The Preview tab shows the fitted page, read-only.

import { Eye, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/cn";

import {
  bulletText,
  entryById,
  orderedBullets,
  paginate,
  SECTIONS,
  useRendered,
  type Editor,
} from "../prototype-editor/model";
import { Paper } from "../prototype-editor/paper";
import {
  Assistant,
  CHIP,
  FIELD,
  Header,
  LineActions,
  PhoneFrame,
  PURPLE,
  Sheet,
  TAP,
  useCenter,
  type Sel,
} from "./phone";

export const NAME = "Outline plus preview";

export function VariantB({ editor }: { editor: Editor }) {
  const { state, dispatch } = editor;
  const { rendered, rendering } = useRendered(state);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [open, setOpen] = useState<string | null>(null); // entry or bullet id
  const [ask, setAsk] = useState(false);

  // The first line on page 2, for the "page 1 ends" rule.
  const page2 = paginate(state)[1]?.find((b) => b.kind === "entry" || b.kind === "bullet");
  const breakId = page2
    ? page2.kind === "bullet"
      ? page2.bullet.id
      : page2.kind === "entry"
        ? page2.entry.id
        : null
    : null;
  const Break = ({ id }: { id: string }) =>
    id === breakId ? (
      <div className="text-note my-1 flex items-center gap-2 text-amber-700">
        <span className="h-px flex-1 border-t border-dashed border-amber-400" />
        Page 1 ends here
        <span className="h-px flex-1 border-t border-dashed border-amber-400" />
      </div>
    ) : null;

  const selected: Sel | null = (() => {
    for (const e of state.bank) {
      if (e.id === open) return { kind: "entry", entry: e };
      const b = e.bullets.find((x) => x.id === open);
      if (b) return { kind: "bullet", entry: e, bullet: b };
    }
    return null;
  })();

  return (
    <PhoneFrame>
      <Header editor={editor} />
      <div className="flex gap-1 border-b border-[#ece6ff] bg-white px-4 py-2">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "text-label min-h-11 flex-1 rounded-xl",
              tab === t ? "bg-[#efe9ff] font-semibold text-[#6d3fd8]" : "text-ink-meta",
            )}
          >
            {t === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>

      {tab === "preview" ? (
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-4 pb-10">
          <p className="text-note text-ink-meta mb-3">
            This is the PDF you download. Pinch to zoom. Switch to Edit to change a line.
          </p>
          <Paper state={rendered} rendering={rendering} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 pt-4 pb-28">
          {SECTIONS.filter((s) => s !== "Skills").map((section) => {
            const shown = state.built.order[section];
            const unused = state.bank.filter((e) => e.section === section && !shown.includes(e.id));
            if (!shown.length && !unused.length) return null;
            return (
              <section key={section} className="flex flex-col gap-2">
                <h2 className={cn("text-caption uppercase", PURPLE)}>{section}</h2>
                {shown.map((id) => {
                  const e = entryById(state, id);
                  return (
                    <div
                      key={id}
                      className="flex flex-col gap-1 rounded-2xl bg-white p-1.5 ring-1 ring-[#ece6ff]"
                    >
                      <Break id={id} />
                      <Row on={open === id} onTap={() => setOpen(open === id ? null : id)}>
                        <div className="text-subtitle text-ink">{e.title}</div>
                        <div className="text-note text-ink-meta">
                          {[e.org, e.dates].filter(Boolean).join(" · ")}
                        </div>
                      </Row>
                      {open === id && (
                        <Expanded>
                          <EntryFields editor={editor} id={id} />
                          <LineActions
                            editor={editor}
                            sel={{ kind: "entry", entry: e }}
                            onHidden={() => setOpen(null)}
                          />
                        </Expanded>
                      )}
                      {orderedBullets(state, e).map((b) => {
                        const hidden = state.built.hidden.includes(b.id);
                        if (hidden)
                          return (
                            <div key={b.id} className="flex items-center gap-2 pl-3">
                              <span className="text-body text-ink-meta line-clamp-1 flex-1 line-through">
                                {b.text}
                              </span>
                              <button
                                className={cn(TAP, "text-[#6d3fd8]")}
                                onClick={() => dispatch({ type: "toggleBullet", id: b.id })}
                              >
                                <Eye className="size-4" /> Show
                              </button>
                            </div>
                          );
                        return (
                          <div key={b.id}>
                            <Break id={b.id} />
                            <Row
                              on={open === b.id}
                              onTap={() => setOpen(open === b.id ? null : b.id)}
                            >
                              <div className="text-body text-ink flex gap-2">
                                <span className="text-ink-meta">•</span>
                                <span className={cn(open !== b.id && "line-clamp-2")}>
                                  {bulletText(state, b)}
                                </span>
                              </div>
                            </Row>
                            {open === b.id && (
                              <Expanded>
                                <BulletField
                                  key={`${b.id}:${bulletText(state, b)}`}
                                  editor={editor}
                                  id={b.id}
                                />
                                <LineActions
                                  editor={editor}
                                  sel={{ kind: "bullet", entry: e, bullet: b }}
                                  onHidden={() => setOpen(null)}
                                />
                              </Expanded>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {unused.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => dispatch({ type: "toggleEntry", id: e.id })}
                    className={cn(TAP, "justify-start border border-dashed border-[#d9d2ee]")}
                  >
                    <span className={PURPLE}>+</span> Add {e.title}
                  </button>
                ))}
              </section>
            );
          })}
          <section className="flex flex-col gap-2">
            <h2 className={cn("text-caption uppercase", PURPLE)}>Skills</h2>
            {state.skills.map((g) => (
              <div
                key={g.group}
                className="text-body text-ink rounded-2xl bg-white p-3 ring-1 ring-[#ece6ff]"
              >
                <b>{g.group}:</b> {g.items.join(", ")}
              </div>
            ))}
          </section>
        </div>
      )}

      <button
        onClick={() => setAsk(true)}
        className={cn(
          CHIP,
          "absolute right-4 bottom-6 z-20 flex min-h-12 items-center gap-1.5 px-4 shadow-lg",
        )}
      >
        <Sparkles className="size-4" /> Ask WorkIt
      </button>
      <Sheet open={ask} onClose={() => setAsk(false)} title="WorkIt Assistant">
        <Assistant editor={editor} sel={selected} />
      </Sheet>
    </PhoneFrame>
  );
}

function Row({
  on,
  onTap,
  children,
}: {
  on: boolean;
  onTap: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onTap}
      className={cn(
        "min-h-11 w-full rounded-xl px-2.5 py-2 text-left active:bg-[#f3efff]",
        on && "bg-[#f6f2ff]",
      )}
    >
      {children}
    </button>
  );
}

function Expanded({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCenter(ref, true);
  return (
    <div ref={ref} className="animate-rise flex flex-col gap-2 rounded-xl bg-[#f7f4ff] p-2">
      {children}
    </div>
  );
}

function BulletField({ editor, id }: { editor: Editor; id: string }) {
  const { state, dispatch } = editor;
  const b = state.bank.flatMap((e) => e.bullets).find((x) => x.id === id)!;
  const [text, setText] = useState(bulletText(state, b));
  return (
    <textarea
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && dispatch({ type: "setWording", bullet: id, text: text.trim() })}
      className={cn(FIELD, "field-sizing-content min-h-24")}
    />
  );
}

function EntryFields({ editor, id }: { editor: Editor; id: string }) {
  const { state, dispatch } = editor;
  const e = entryById(state, id);
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["title", "org", "location", "dates"] as const).map((k) => (
        <input
          key={k}
          defaultValue={e[k] ?? ""}
          placeholder={
            { title: "Title", org: "Organization", location: "Location", dates: "Dates" }[k]
          }
          onBlur={(ev) =>
            ev.target.value !== (e[k] ?? "") &&
            dispatch({ type: "editEntry", id, patch: { [k]: ev.target.value } })
          }
          className={cn(FIELD, (k === "title" || k === "org") && "col-span-2")}
        />
      ))}
    </div>
  );
}
