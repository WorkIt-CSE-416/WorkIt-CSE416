"use client";

import { useEffect, useState, type ReactNode } from "react";

import { SelectField } from "@/components/ui/select-field";

/**
 * The kit's States groups (KAN-564): each control at rest, hovered, focused,
 * disabled and, for a button, busy, side by side.
 *
 * Hover and focus are pseudo-classes, so no class can switch them on, and a
 * copy of each variant's hover and focus classes typed here would drift from
 * the component the day one changes (Tailwind builds only the classes it
 * finds in the source, so a class cut from `hover:bg-brand-hover` at run time
 * has no rule). <ForcedStates> reads the app's own stylesheet instead: every
 * rule under `:hover` or `:focus-visible` is copied once, with the
 * pseudo-class swapped for "inside a <StateCell> of that state". A specimen
 * in a cell therefore wears exactly what the component draws on a real hover
 * or a keyboard focus, and changes when the component does.
 *
 * `@media (hover: hover)`, which Tailwind wraps around every hover, is
 * dropped from the copies, so a phone shows the hovered look too.
 */

type ForcedState = "hover" | "focus";

const PSEUDO: Record<ForcedState, string> = { hover: ":hover", focus: ":focus-visible" };

/** "Inside a cell of this state", as a selector that adds no specificity. */
const inside = (state: ForcedState) => `:where([data-kit-state="${state}"] *)`;

const STYLE_ID = "kit-forced-states";

/** Every hover and focus-visible declaration in `rules`, keyed by the
 *  selector it would match with the pseudo-class forced. Nested rules (the
 *  dev server serves Tailwind's output unflattened) take their parent's
 *  selector for `&`. */
function collect(rules: CSSRuleList, parent: string, out: string[]) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selector = parent
        ? rule.selectorText.replaceAll("&", parent.includes(",") ? `:is(${parent})` : parent)
        : rule.selectorText;
      emit(selector, rule.style.cssText, out);
      collect(rule.cssRules, selector, out);
    } else if (rule instanceof CSSGroupingRule) {
      collect(rule.cssRules, parent, out);
    } else if (rule.constructor.name === "CSSNestedDeclarations") {
      // Declarations after a nested rule; not in TypeScript's DOM types yet.
      emit(parent, (rule as CSSRule & { style: CSSStyleDeclaration }).style.cssText, out);
    }
  }
}

function emit(selector: string, declarations: string, out: string[]) {
  if (!declarations) return;
  for (const state of ["hover", "focus"] as const) {
    if (selector.includes(PSEUDO[state])) {
      out.push(`${selector.replaceAll(PSEUDO[state], inside(state))}{${declarations}}`);
    }
  }
}

/** Mounted once, by the kit's layout. */
export function ForcedStates() {
  useEffect(() => {
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      if (sheet.ownerNode instanceof Element && sheet.ownerNode.id === STYLE_ID) continue;
      try {
        collect(sheet.cssRules, "", out);
      } catch {
        // A cross-origin sheet (a web font's) refuses to be read; it holds no states.
      }
    }
    const style = document.getElementById(STYLE_ID) ?? document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = out.join("\n");
    document.head.append(style);
    return () => style.remove();
  }, []);

  return null;
}

/** One specimen in one state, named under it. `state` hover or focus forces
 *  that look on everything inside; rest, disabled and busy are drawn by the
 *  specimen's own props. */
export function StateCell({
  label,
  state,
  children,
}: {
  label: string;
  state?: ForcedState;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col items-start gap-1.5">
      <div data-kit-state={state} className="flex items-center">
        {children}
      </div>
      <figcaption className="text-note text-ink-meta">{label}</figcaption>
    </figure>
  );
}

/** A row of <StateCell>s, spaced wider than a row of specimens so each name
 *  sits under its own control. */
export function StateCells({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-4 gap-y-3">{children}</div>;
}

const ROLES = ["Engineering", "Design", "Product"];

/** SelectField in each state. A client component because the field takes a
 *  function, which a server page cannot pass. */
export function SelectFieldStates() {
  const [role, setRole] = useState("Design");
  const cell = (key: string, props: Partial<Parameters<typeof SelectField>[0]>) => (
    <div className="w-48">
      <SelectField
        id={`dk-select-${key}`}
        label="Department"
        value=""
        onValueChange={() => {}}
        options={ROLES}
        placeholder="Pick one"
        {...props}
      />
    </div>
  );

  return (
    <StateCells>
      <StateCell label="Empty">{cell("empty", {})}</StateCell>
      <StateCell label="Picked">
        {cell("picked", { value: role, onValueChange: setRole })}
      </StateCell>
      <StateCell label="Focus" state="focus">
        {cell("focus", {})}
      </StateCell>
      <StateCell label="Invalid">
        <div className="flex flex-col gap-1">
          {cell("invalid", { invalid: true, describedBy: "dk-select-invalid-error" })}
          <p id="dk-select-invalid-error" className="text-note text-danger">
            Pick a department
          </p>
        </div>
      </StateCell>
      <StateCell label="Disabled">{cell("disabled", { value: role, disabled: true })}</StateCell>
    </StateCells>
  );
}
