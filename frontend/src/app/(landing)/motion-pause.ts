import { useSyncExternalStore } from "react";

/**
 * Pause Animations (KAN-580, WCAG 2.2.2): the marketing pages' loops start
 * on their own and run for good, so a visitor can hold them all from the
 * footer or the phone menu. The choice is `data-motion="paused"` on
 * `<html>`, which landing.css reads to hold the CSS loops where they are,
 * and `useLoopsHeld` (hooks.ts) reads to hold the timed ones; it is kept
 * per browser in localStorage. Not reduced motion: that swaps each scene
 * for its still frame, while a pause keeps the frame on screen and Play
 * goes on from it.
 */

const KEY = "workit:motion";
const listeners = new Set<() => void>();

function isPaused() {
  return document.documentElement.dataset.motion === "paused";
}

/** Marks `<html>` (only when it changes) and tells every reader. */
function mark(paused: boolean) {
  if (paused === isPaused()) return;
  if (paused) document.documentElement.dataset.motion = "paused";
  else delete document.documentElement.dataset.motion;
  listeners.forEach((listener) => listener());
}

/** Pause or play every loop, and keep the choice for the next visit. */
export function setMotionPaused(paused: boolean) {
  mark(paused);
  try {
    if (paused) localStorage.setItem(KEY, "paused");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts until the page is left.
  }
}

/** Puts back a pause kept from an earlier visit. Safe to call twice. */
export function restoreMotionPaused() {
  try {
    if (localStorage.getItem(KEY) === "paused") mark(true);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the visitor paused the animations. False on the server. */
export function useMotionPaused(): boolean {
  return useSyncExternalStore(subscribe, isPaused, () => false);
}
