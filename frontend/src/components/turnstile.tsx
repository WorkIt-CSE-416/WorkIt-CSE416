"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile widget. Renders a managed challenge and calls back
 * with the token. When the site key is unset (local dev), renders nothing
 * and the hidden input stays empty — the backend skips verification when
 * its own secret is unset.
 *
 * A token is good for one check only, and the form's own reset after an
 * action empties the hidden input too. So a form passes its action state as
 * `resetKey`: each new state (a wrong password, a refused signup) resets the
 * widget for a fresh token, or every retry would fail the check.
 */
export function Turnstile({ form, resetKey }: { form?: string; resetKey?: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const render = useCallback(() => {
    if (!SITE_KEY || !containerRef.current || widgetIdRef.current != null) return;
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => {
        const input = containerRef.current?.querySelector<HTMLInputElement>(
          "input[name='cf-turnstile-response']",
        );
        if (input && form) input.setAttribute("form", form);
        // Turnstile sets the hidden input's value itself; we just need to
        // associate it with the right <form> via the `form` attribute.
        void token;
      },
    });
  }, [form]);

  useEffect(() => {
    // If the script loaded before this component mounted.
    if (window.turnstile) render();
    return () => {
      if (widgetIdRef.current != null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [render]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (widgetIdRef.current != null) window.turnstile.reset(widgetIdRef.current);
  }, [resetKey]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={render}
      />
      <div ref={containerRef} className="mt-2.5" />
    </>
  );
}

declare global {
  interface Window {
    turnstile: {
      render: (
        container: HTMLElement,
        options: { sitekey: string; callback: (token: string) => void },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}
