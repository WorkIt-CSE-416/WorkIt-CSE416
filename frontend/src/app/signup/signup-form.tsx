"use client";

import { useActionState, useState } from "react";

import { ArrowRightIcon, LockIcon, MailIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

import { createAccount, type SignupState } from "./actions";

const INITIAL_STATE: SignupState = {
  error: null,
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
};

// The only enforcement of this floor right now — backend/app/schemas/
// auth.py's SignupRequest.password dropped its own min_length deliberately,
// so a request that bypasses this form (a direct API call) isn't bound by
// it. Revisit both sides together if that gap needs closing again.
const PASSWORD_MIN_LENGTH = 8;

/**
 * The interactive half of /signup — everything above the fold (logo,
 * heading, AccountTypeSwitcher) stays server-rendered in page.tsx; this is
 * only the form, split out because useActionState requires a Client
 * Component. `formId` ties it to AccountTypeSwitcher's hidden input, which
 * sits outside this component in the DOM but targets this form by id.
 */
export function SignupForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(createAccount, INITIAL_STATE);

  // Confirm Password never reaches the server (see actions.ts) — it exists
  // purely to catch a typo before submission, so the comparison has to live
  // here. `confirmAttempted` withholds the message until a submit was
  // actually blocked by it, rather than flashing "doesn't match" on every
  // keystroke before the second field is even finished.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const passwordsMismatch = password !== confirmPassword;

  return (
    <form
      id={formId}
      action={formAction}
      onSubmit={(event) => {
        if (passwordsMismatch) {
          event.preventDefault();
          setConfirmAttempted(true);
        }
      }}
      className="mt-4 flex flex-col"
    >
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <TextField
            id="first-name"
            name="firstName"
            type="text"
            label="First Name"
            autoComplete="given-name"
            required
            defaultValue={state.firstName}
          />

          <TextField
            id="middle-name"
            name="middleName"
            type="text"
            label="Middle Name"
            labelAction={<span className="text-meta text-ink-faint">Optional</span>}
            autoComplete="additional-name"
            defaultValue={state.middleName}
          />

          <TextField
            id="last-name"
            name="lastName"
            type="text"
            label="Last Name"
            autoComplete="family-name"
            required
            defaultValue={state.lastName}
          />
        </div>

        <TextField
          id="email"
          name="email"
          type="email"
          label="Email Address"
          icon={MailIcon}
          autoComplete="email"
          required
          defaultValue={state.email}
        />

        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          icon={LockIcon}
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <div className="flex flex-col gap-1">
          <TextField
            id="confirm-password"
            name="confirmPassword"
            type="password"
            label="Confirm Password"
            icon={LockIcon}
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {confirmAttempted && passwordsMismatch && (
            <p className="text-meta text-danger">Passwords do not match.</p>
          )}
        </div>
      </div>

      {state.error && <p className="text-meta text-danger mt-2.5">{state.error}</p>}

      <Button type="submit" size="lg" className="mt-2.5" disabled={pending}>
        {pending ? "Creating Account…" : "Create Account"}
        <ArrowRightIcon className="size-4" />
      </Button>
    </form>
  );
}
