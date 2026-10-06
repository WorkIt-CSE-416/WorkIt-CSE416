/*
/signup
different form for applicant, company, and company_membership sign up
*/
"use client";

import { useActionState, useState } from "react";

import { AccountTypeSwitcher, type AccountTypeValue } from "@/components/account-type-switcher";
import { CompanyFields } from "@/components/company-fields";
import { ArrowRightIcon, BriefcaseIcon, LockIcon, MailIcon, UserIcon } from "@/components/icons";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { createAccount, type SignupState } from "./actions";

const INITIAL_STATE: SignupState = {
  error: null,
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  companyName: "",
  websiteUrl: "",
  contactEmail: "",
  contactPhone: "",
};

// A UX check only — it saves a round trip, it doesn't enforce anything. The
// same floor of 8 is enforced by backend/app/schemas/auth.py's
// SignupRequest.password (a direct API call) and by the Supabase project's
// minimum password length (anything reaching Supabase Auth with the public
// anon key, e.g. updateUser). Change all three together.
const PASSWORD_MIN_LENGTH = 8;

/** The two doors behind the Company tab. Only "create" has a form so far. */
const COMPANY_PATHS = [
  {
    value: "create",
    label: "Create Company",
    hint: "Set up a new company page",
    icon: BriefcaseIcon,
  },
  {
    value: "join",
    label: "Join a Company",
    hint: "Join your team on WorkIt",
    icon: UserIcon,
  },
] as const;

type CompanyPath = (typeof COMPANY_PATHS)[number]["value"];

const OPTIONAL = <span className="text-meta text-ink-faint">Optional</span>;

/** Caption over each group of the company form — same type as "Or continue with". */
const SECTION = "text-caption text-ink-muted uppercase";

/**
 * The interactive half of /signup — logo and heading stay server-rendered in
 * page.tsx. The account-type switcher lives here rather than there because
 * the fields below it depend on its value: Applicant goes straight to the
 * form, Company first asks Create or Join and shows nothing until one is
 * picked. useActionState needs a Client Component anyway.
 *
 * The switcher still sits outside <form> and reaches it through its hidden
 * input's `form` attribute, same as on /login.
 */
export function SignupForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(createAccount, INITIAL_STATE);

  const [accountType, setAccountType] = useState<AccountTypeValue>("applicant");
  const [companyPath, setCompanyPath] = useState<CompanyPath | null>(null);
  // Controlled, unlike the text fields: React's post-action form reset only
  // clears uncontrolled inputs, so a picked size survives a failed submit
  // without a round-trip through SignupState.
  const [companySize, setCompanySize] = useState("");
  const [sizeAttempted, setSizeAttempted] = useState(false);

  // Confirm Password never reaches the server (see actions.ts) — it exists
  // purely to catch a typo before submission, so the comparison has to live
  // here. `confirmAttempted` withholds the message until a submit was
  // actually blocked by it, rather than flashing "doesn't match" on every
  // keystroke before the second field is even finished.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const passwordsMismatch = password !== confirmPassword;

  const isCompany = accountType === "company";
  const showForm = !isCompany || companyPath === "create";

  return (
    <>
      <AccountTypeSwitcher form={formId} value={accountType} onValueChange={setAccountType} />

      {isCompany && (
        <ToggleGroup
          value={companyPath ? [companyPath] : []}
          /* Same rule as the account switcher: re-pressing the chosen tile
           * would empty the group, so an empty change is dropped. */
          onValueChange={([next]) => {
            if (next) setCompanyPath(next as CompanyPath);
          }}
          aria-label="Create or join a company"
          className="mt-2.5 grid w-full grid-cols-2 gap-2.5"
        >
          {COMPANY_PATHS.map(({ value, label, hint, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              /* A tile, not a segment: it is a choice between two flows, and
               * the hint line says what each one leads to. Pressed state uses
               * the switcher's brand tint so the two controls read as one
               * family. */
              className="rounded-control border-border-subtle text-ink-muted hover:bg-hover hover:text-ink aria-pressed:border-brand/50 aria-pressed:bg-brand-tint aria-pressed:text-brand-ink flex h-auto flex-col items-start gap-0.5 border px-3.5 py-2.5 text-left whitespace-normal"
            >
              <span className="text-label flex items-center gap-2">
                <Icon className="size-4" />
                {label}
              </span>
              <span className="text-meta text-ink-faint font-normal">{hint}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {isCompany && companyPath === "join" && (
        <p className="text-body text-ink-muted border-border-subtle rounded-control mt-4 border border-dashed px-3.5 py-4 text-center">
          Joining an existing company is coming soon.
        </p>
      )}

      {showForm && (
        <form
          id={formId}
          action={formAction}
          onSubmit={(event) => {
            // The size picker is a button, not a <select>, so the browser's
            // own required check never sees it — this is that check.
            if (isCompany && !companySize) {
              event.preventDefault();
              setSizeAttempted(true);
            }
            if (passwordsMismatch) {
              event.preventDefault();
              setConfirmAttempted(true);
            }
          }}
          className="mt-4 flex flex-col"
        >
          <div className="flex flex-col gap-2.5">
            {isCompany && (
              <>
                <CompanyFields
                  defaults={{
                    companyName: state.companyName,
                    websiteUrl: state.websiteUrl,
                    contactEmail: state.contactEmail,
                    contactPhone: state.contactPhone,
                  }}
                  companySize={companySize}
                  onCompanySizeChange={(next) => {
                    setCompanySize(next);
                    setSizeAttempted(false);
                  }}
                  sizeAttempted={sizeAttempted}
                />

                {/* The fields below are the same as an applicant's, but they
                    describe the company's owner — the person signing in. */}
                <p className={cn(SECTION, "mt-2")}>Owner account</p>
              </>
            )}

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <TextField
                id="first-name"
                name="firstName"
                type="text"
                label="First Name"
                autoComplete="given-name"
                maxLength={100}
                required
                defaultValue={state.firstName}
              />

              <TextField
                id="middle-name"
                name="middleName"
                type="text"
                label="Middle Name"
                labelAction={OPTIONAL}
                autoComplete="additional-name"
                maxLength={55}
                defaultValue={state.middleName}
              />

              <TextField
                id="last-name"
                name="lastName"
                type="text"
                label="Last Name"
                autoComplete="family-name"
                maxLength={100}
                required
                defaultValue={state.lastName}
              />
            </div>

            <TextField
              id="email"
              name="email"
              type="email"
              /* On the company path this is the owner's own sign-in, which is
               * not necessarily the company's public contact address above. */
              label={isCompany ? "Sign-in Email" : "Email Address"}
              icon={MailIcon}
              autoComplete="email"
              maxLength={100}
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
              maxLength={20}
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
            {pending
              ? isCompany
                ? "Creating Company…"
                : "Creating Account…"
              : isCompany
                ? "Create Company"
                : "Create Account"}
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>
      )}
    </>
  );
}
