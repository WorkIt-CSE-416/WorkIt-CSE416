"use client";

import {
  GitHubGlyph,
  LinkedInGlyph,
  OtherLinkGlyph,
  WebsiteGlyph,
} from "@/app/(seeker)/profile/icons";
import { PinIcon } from "@/components/icons";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import type { ApplicantProfile } from "@/lib/profile-actions";

import { Field, fieldId } from "./role-step";

/**
 * The Profile step's location and links (KAN-372): facts most application
 * forms ask and a resume often leaves out. They save to the profile (PATCH
 * /applicants/{id}/profile), where My Profile edits them too, and the
 * autofiller reads them from there. Location is where the student lives,
 * as forms ask it ("Stony Brook, NY"); the places they want to work are
 * step 1's Location filter. Other Link stays on My Profile: forms ask for
 * these three by name.
 */
export type Contact = Pick<
  ApplicantProfile,
  "location" | "linkedin_url" | "github_url" | "portfolio_url"
>;

export const NO_CONTACT: Contact = {
  location: null,
  linkedin_url: null,
  github_url: null,
  portfolio_url: null,
};

export const LINKS = [
  {
    key: "linkedin_url",
    label: "LinkedIn",
    Icon: LinkedInGlyph,
    placeholder: "linkedin.com/in/your-name",
  },
  { key: "github_url", label: "GitHub", Icon: GitHubGlyph, placeholder: "github.com/your-name" },
  {
    key: "portfolio_url",
    label: "Portfolio or Website",
    Icon: WebsiteGlyph,
    placeholder: "your-name.com",
  },
] as const;

/** A typed answer at the wizard's 16px, in the shared field box. */
const INPUT = cn(FIELD_CONTROL, "text-subtitle sm:text-subtitle h-11 px-3.5 font-normal");

export function LocationField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string) => void;
}) {
  const id = fieldId("Location");
  return (
    <Field Icon={PinIcon} label="Location" hint="Where you live, as forms ask it: city and state.">
      <input
        aria-labelledby={id}
        aria-describedby={`${id}-hint`}
        className={INPUT}
        placeholder="Stony Brook, NY"
        maxLength={100}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function LinkFields({
  contact,
  onChange,
  invalid,
}: {
  contact: Contact;
  onChange: (change: Partial<Contact>) => void;
  /** The links that are not web addresses, from the last Finish. */
  invalid: ReadonlySet<keyof Contact>;
}) {
  return (
    <Field Icon={OtherLinkGlyph} label="Links" hint="Forms ask for these by name.">
      <div className="flex flex-col gap-4">
        {LINKS.map(({ key, label, Icon, placeholder }) => {
          const id = `onboarding-${key}`;
          const bad = invalid.has(key);
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-body text-ink-muted flex items-center gap-2">
                <Icon className="text-ink-meta size-4" />
                {label}
              </label>
              <input
                id={id}
                type="text"
                inputMode="url"
                className={INPUT}
                placeholder={placeholder}
                maxLength={500}
                value={contact[key] ?? ""}
                onChange={(event) => onChange({ [key]: event.target.value })}
                aria-invalid={bad || undefined}
                aria-describedby={bad ? `${id}-error` : undefined}
              />
              {bad && (
                <p id={`${id}-error`} role="alert" className="text-body text-danger">
                  Enter a web address, such as {placeholder}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Field>
  );
}
