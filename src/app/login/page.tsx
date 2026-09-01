import type { Metadata } from "next";

import { MailIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { TextLink } from "@/components/ui/text-link";

import { signIn } from "./actions";
import { ArrowRightIcon, LockIcon } from "./icons";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Log in to find your next career move.",
};

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-auth rounded-card border-border bg-surface shadow-card w-full border p-6">
        <Logo size="card" priority className="mx-auto" />

        <h1 className="text-title text-ink mt-2.5 text-center">Welcome Back</h1>
        <p className="text-body text-ink-muted mt-1 text-center">
          Log in to find your next career move
        </p>

        <form action={signIn} className="mt-5 flex flex-col">
          <div className="flex flex-col gap-2.5">
            <TextField
              id="email"
              name="email"
              type="email"
              label="Email Address"
              icon={MailIcon}
              autoComplete="email"
              placeholder="name@example.com"
              required
            />

            <TextField
              id="password"
              name="password"
              type="password"
              label="Password"
              icon={LockIcon}
              autoComplete="current-password"
              placeholder="••••••••"
              required
              labelAction={
                <TextLink href="/forgot-password" className="text-label">
                  Forgot password?
                </TextLink>
              }
            />
          </div>

          <Button type="submit" variant="primary" size="lg" className="mt-2.5">
            Sign In
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>

        <div className="mt-5 flex items-center gap-3">
          <span className="bg-border-subtle h-px flex-1" />
          <span className="text-caption text-ink-muted uppercase">Or continue with</span>
          <span className="bg-border-subtle h-px flex-1" />
        </div>

        <div className="mt-[22px] grid grid-cols-2 gap-3">
          <Button variant="secondary">Google</Button>
          <Button variant="secondary">LinkedIn</Button>
        </div>

        <p className="text-body text-ink-muted mt-6 text-center">
          Don&apos;t have an account? <TextLink href="/signup">Create Account</TextLink>
        </p>
      </div>
    </main>
  );
}
