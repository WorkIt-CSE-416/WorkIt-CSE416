"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A social sign-up button's form (KAN-581). Its action ends in a redirect
 * to the provider that never returns, so the form stays pending until the
 * page unloads; Back then restores this page from the back/forward cache
 * with the button still pending. A fresh form on `pageshow` drops that.
 */
export function OAuthForm({
  action,
  className,
  children,
}: {
  action: () => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  const [round, setRound] = useState(0);
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRound((r) => r + 1);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return (
    <form key={round} action={action} className={className}>
      {children}
    </form>
  );
}

/** The form's submit button: disabled while the action runs, so a second
 *  click cannot post again, with `pendingLabel` in place of `label`. */
export function OAuthSubmit({
  icon,
  label,
  pendingLabel,
  className,
}: {
  icon: ReactNode;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {icon}
      <span>{pending ? pendingLabel : label}</span>
    </button>
  );
}
