"use client";

import { useSyncExternalStore } from "react";

import { COLOR_GROUPS } from "./data";
import { Group, Row } from "./specimen";

/**
 * The colour section, resolved from the live stylesheet.
 *
 * A design kit that lists hex values it was typed with is wrong the first time
 * anyone edits globals.css, and wrong silently. So the swatch paints
 * `var(--token)` — always current by construction — and the value beside it is
 * read back with getComputedStyle, which is the only way to see what a custom
 * property actually resolves to.
 *
 * That read is external state, not React state, so it goes through
 * useSyncExternalStore rather than an effect: there is nothing to subscribe to
 * (a stylesheet does not change at runtime here), the client snapshot reads the
 * DOM, and the server snapshot is empty because there is no computed style to
 * read. The swatch itself is correct in the server HTML either way, which is
 * the half that matters if hydration never happens.
 */

/** Nothing to subscribe to — the value is fixed for the life of the document. */
const subscribe = () => () => {};

function useTokenValue(token: string) {
  return useSyncExternalStore(
    subscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    () => "",
  );
}

function Swatch({ token, role }: { token: string; role: string }) {
  const value = useTokenValue(token);

  return (
    <Row name={token} role={role}>
      <span
        aria-hidden
        className="border-border-subtle rounded-control size-9 shrink-0 border"
        style={{ background: `var(${token})` }}
      />
      <code className="text-note text-ink-meta font-mono">{value}</code>
    </Row>
  );
}

export function Palette() {
  return (
    <>
      {COLOR_GROUPS.map(({ title, note, tokens }) => (
        <Group key={title} title={title} note={note}>
          {tokens.map(({ token, role }) => (
            <Swatch key={token} token={token} role={role} />
          ))}
        </Group>
      ))}
    </>
  );
}
