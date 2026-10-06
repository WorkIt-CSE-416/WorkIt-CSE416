"use client";

import { useActionState, useState } from "react";

import { AccountTypeSwitcher, type AccountTypeValue } from "@/components/account-type-switcher";
import { CompanyFields } from "@/components/company-fields";
import { ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { chooseAccountType, type ChooseAccountTypeState } from "./actions";

const INITIAL_STATE: ChooseAccountTypeState = {
  error: null,
  companyName: "",
  websiteUrl: "",
  contactEmail: "",
  contactPhone: "",
};

const FORM_ID = "choose-account-type";

/**
 * What /auth/callback sends a Google/LinkedIn sign-in to the first time: the
 * identity provider gave us an email and a name, but not which side of
 * WorkIt this person is on. Same switcher as /login and /signup; Company
 * additionally collects CompanyFields, since there's no password-signup form
 * here for those fields to already live on.
 */
export function ChooseAccountTypeForm() {
  const [state, formAction, pending] = useActionState(chooseAccountType, INITIAL_STATE);

  const [accountType, setAccountType] = useState<AccountTypeValue>("applicant");
  const [companySize, setCompanySize] = useState("");
  const [sizeAttempted, setSizeAttempted] = useState(false);
  const isCompany = accountType === "company";

  return (
    <>
      <AccountTypeSwitcher form={FORM_ID} value={accountType} onValueChange={setAccountType} />

      <form
        id={FORM_ID}
        action={formAction}
        onSubmit={(event) => {
          // The size picker is a button, not a <select>, so the browser's
          // own required check never sees it — this is that check.
          if (isCompany && !companySize) {
            event.preventDefault();
            setSizeAttempted(true);
          }
        }}
        className="mt-4 flex flex-col"
      >
        {isCompany && (
          <div className="flex flex-col gap-2.5">
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
          </div>
        )}

        {state.error && <p className="text-meta text-danger mt-2.5">{state.error}</p>}

        <Button type="submit" size="lg" className="mt-4" disabled={pending}>
          {pending ? "Continuing…" : "Continue"}
          <ArrowRightIcon className="size-4" />
        </Button>
      </form>
    </>
  );
}
