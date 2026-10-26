"use client";

import { useEffect } from "react";

import { SEEN_COOKIE } from "./new-answers";

const SEEN_MAX_AGE = 60 * 60 * 24 * 365;

/** Records this visit to Written Answers (./new-answers.ts): `at`, the newest answer shown, in ms, once the page has shown. */
export function SeenNow({ at }: { at: number }) {
  useEffect(() => {
    document.cookie = `${SEEN_COOKIE}=${at}; path=/auto-apply/answers; max-age=${SEEN_MAX_AGE}; samesite=lax`;
  }, [at]);
  return null;
}
