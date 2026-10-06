/*
/signup
different form for applicant, company, and company_membership sign up
*/
"use client";

import { Building2, CircleAlert, UserRoundPlus } from "lucide-react";
import { useActionState, useState } from "react";

import { AccountTypeSwitcher, type AccountTypeValue } from "@/components/account-type-switcher";
import { CompanyFields } from "@/components/company-fields";
import { SoonBadge } from "@/components/auth-alternatives";
import { ArrowRightIcon, LockIcon, MailIcon } from "@/components/icons";
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

/**
 * The two doors behind the Company tab. Only "create" has a form so far, so
 * "join" is drawn disabled and marked Soon rather than offered as an equal
 * choice that leads nowhere. Building2 is the company glyph the company shell
 * uses. UserRoundPlus is you joining a team; UsersRound already means
 * Applicants in the company shell.
 */
const COMPANY_PATHS = [
  {
    value: "create",
    label: "Create Company",
    hint: "Set up a new company page",
    icon: Building2,
  },
  {
    value: "join",
    label: "Join a Company",
    hint: "Join your team on WorkIt",
    icon: UserRoundPlus,
  },
] as const;

type CompanyPath = (typeof COMPANY_PATHS)[number]["value"];

const OPTIONAL = <span className="text-meta text-ink-meta">Optional</span>;

/** Caption over each group of the company form — same type as "Or continue with". */
const SECTION = "text-caption text-ink-muted uppercase";

/**
 * The interactive half of /signup — logo and heading stay server-rendered in
 * page.tsx. The account-type switcher lives here rather than there because
 * the fields below it depend on its value: Applicant goes straight to the
 * form, Company opens on Create with its fields already showing (Join is
 * disabled until it has a form). useActionState needs a Client Component
 * anyway.
 *
 * The switcher still sits outside <form> and reaches it through its hidden
 * input's `form` attribute, same as on /login.
 */
export function SignupForm({ formId }: { formId: string }) {
  const [state, formAction, pending] = useActionState(createAccount, INITIAL_STATE);

  const [accountType, setAccountType] = useState<AccountTypeValue>("applicant");
  const [companyPath, setCompanyPath] = useState<CompanyPath | null>("create");
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
  const confirmInvalid = confirmAttempted && passwordsMismatch;

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
          /* One column below `sm`, like every paired row in the form below:
           * at phone width a half-width tile wrapped each label onto two
           * lines and pushed Join's Soon pill out past its edge. */
          className="mt-2.5 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2"
        >
          {COMPANY_PATHS.map(({ value, label, hint, icon: Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              disabled={value === "join"}
              /* A tile, not a segment: it is a choice between two flows, and
               * the hint line says what each one leads to. Pressed state uses
               * the switcher's brand tint so the two controls read as one
               * family. Disabled dims the tile's icon, label and hint but not
               * its Soon pill, so the pill reads the same as the one on the
               * divider below; disabled:opacity-100 cancels the vendored
               * toggle's whole-tile disabled:opacity-50. */
              className="rounded-control border-border-subtle text-ink-muted hover:bg-hover hover:text-ink aria-pressed:border-brand/50 aria-pressed:bg-brand-tint aria-pressed:text-brand-ink flex h-auto flex-col items-start gap-0.5 border px-3.5 py-2.5 text-left whitespace-normal disabled:opacity-100"
            >
              <span className="text-label flex items-center gap-2">
                <Icon className="size-4 group-disabled/toggle:opacity-50" />
                <span className="group-disabled/toggle:opacity-50">{label}</span>
                {value === "join" && <SoonBadge />}
              </span>
              <span className="text-meta text-ink-meta font-normal group-disabled/toggle:opacity-50">
                {hint}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          className="mt-5 flex flex-col"
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

            {/* No maxLength: the API sets none, and a 20-character cap here
                cut a pasted password short in this field but not in Confirm,
                which then reported a mismatch nobody could see. */}
            <div className="flex flex-col gap-1">
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
                aria-describedby="password-hint"
              />
              <p id="password-hint" className="text-meta text-ink-meta">
                At least {PASSWORD_MIN_LENGTH} characters
              </p>
            </div>

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
                aria-invalid={confirmInvalid || undefined}
                aria-describedby={confirmInvalid ? "confirm-password-error" : undefined}
              />
              {confirmInvalid && (
                <p id="confirm-password-error" role="alert" className="text-meta text-danger">
                  Passwords do not match.
                </p>
              )}
            </div>
          </div>

          {/* Same banner as /login's. It names no single field, so it marks
              none; the field-level messages above do that. */}
          {state.error && (
            <p
              id="signup-error"
              role="alert"
              className="text-label text-danger bg-danger-tint rounded-control mt-2.5 flex items-start gap-2 px-3 py-2"
            >
              <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
              {state.error}
            </p>
          )}

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
