"use client";

import dynamic from "next/dynamic";

/**
 * The feature pages' hero animations (the home tour's four and Scout's),
 * each in a chunk of its own that only the page showing it loads.
 * Server-rendered as before; the browser preloads the one chunk and
 * hydrates the page with it.
 *
 * A content file imports its animation from here, never the visual itself:
 * a client component a server file imports joins the browser bundle of
 * every route that imports that file, and the header reads every content
 * file for its menu lines. Imported directly, all four visuals and motion
 * (about 85 KB compressed) loaded on every marketing page, /privacy too,
 * and each feature page carried the three it does not show.
 */
export const ResumeAnimation = dynamic(() => import("../resume-visual"));
export const MatchingAnimation = dynamic(() => import("../matching-visual"));
export const AutoApplyAnimation = dynamic(() => import("../auto-apply-visual"));
export const UpdatesAnimation = dynamic(() => import("../updates-visual"));
export const ScoutAnimation = dynamic(() => import("./visuals/scout-animation"));
