"use client";

import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";

// Values are backend/app/models/dto.py's company_size_range values, verbatim
// — the API parses them straight into that enum, so a change there is a
// change here. Labels are the only part this file owns.
export const COMPANY_SIZES = [
  { value: "1_50", label: "1–50 Employees" },
  { value: "51_200", label: "51–200 Employees" },
  { value: "201_500", label: "201–500 Employees" },
  { value: "501_1000", label: "501–1,000 Employees" },
  { value: "1001_5000", label: "1,001–5,000 Employees" },
  { value: "5001_10000", label: "5,001–10,000 Employees" },
  { value: "10000_", label: "10,000+ Employees" },
] as const;

// ink-meta, not ink-faint: "Optional" is text people read before deciding
// whether to fill a field in, and ink-faint is under AA on the card.
const OPTIONAL = <span className="text-meta text-ink-meta">Optional</span>;

/** Caption over the group — same type treatment as "Or continue with". */
export const COMPANY_FIELDS_SECTION = "text-caption text-ink-muted uppercase";

export type CompanyFieldsDefaults = {
  companyName: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
};

/**
 * Name, size, website, contact details — the company half of a signup form.
 * Promoted out of signup/signup-form.tsx the day
 * signup/choose-account-type/choose-account-type-form.tsx became a second
 * consumer (the OAuth equivalent of Create Company, with no password form to
 * carry these fields instead). The size picker's required-state message
 * lives in the parent because each caller decides when its own submit
 * handler should surface it, same as signup-form.tsx did before the split.
 */
export function CompanyFields({
  defaults,
  companySize,
  onCompanySizeChange,
  sizeAttempted,
}: {
  defaults: CompanyFieldsDefaults;
  companySize: string;
  onCompanySizeChange: (next: string) => void;
  sizeAttempted: boolean;
}) {
  const sizeInvalid = sizeAttempted && !companySize;

  return (
    <>
      <p className={COMPANY_FIELDS_SECTION}>Company</p>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TextField
          id="company-name"
          name="companyName"
          type="text"
          label="Company Name"
          autoComplete="organization"
          required
          maxLength={255}
          defaultValue={defaults.companyName}
        />

        <div className="flex flex-col gap-1">
          <SelectField
            id="company-size"
            name="companySize"
            label="Company Size"
            placeholder="Select a size"
            options={COMPANY_SIZES}
            value={companySize}
            onValueChange={onCompanySizeChange}
            required
            invalid={sizeInvalid}
            describedBy={sizeInvalid ? "company-size-error" : undefined}
          />
          {/* Tied to the picker and announced, so a screen reader hears why
              the form did not submit. */}
          {sizeInvalid && (
            <p id="company-size-error" role="alert" className="text-meta text-danger">
              Select your company&apos;s size.
            </p>
          )}
        </div>
      </div>

      <TextField
        id="website-url"
        name="websiteUrl"
        /* text + inputMode rather than type="url": the browser's url check
         * rejects "acme.com" without a scheme, which is how most people type
         * a website. */
        type="text"
        inputMode="url"
        label="Website URL"
        labelAction={OPTIONAL}
        placeholder="https://example.com"
        autoComplete="url"
        maxLength={255}
        defaultValue={defaults.websiteUrl}
      />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <TextField
          id="contact-email"
          name="contactEmail"
          type="email"
          label="Contact Email"
          required
          maxLength={100}
          defaultValue={defaults.contactEmail}
        />

        <TextField
          id="contact-phone"
          name="contactPhone"
          type="tel"
          label="Contact Phone Number"
          labelAction={OPTIONAL}
          autoComplete="tel"
          maxLength={30}
          defaultValue={defaults.contactPhone}
        />
      </div>
    </>
  );
}
