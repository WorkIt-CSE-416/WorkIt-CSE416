"use client";

import { PhoneIcon } from "@phosphor-icons/react/ssr";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";

import { MailIcon, PencilIcon } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import { FIELD_CONTROL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import type { AutofillAnswers } from "@/lib/autofill-answers";
import { getAutofillAnswers } from "@/lib/autofill-answers-actions";
import { ApplicationQuestions } from "./application-questions";
import { FIELD_GRID, FIELD_HEADING } from "./field-styles";
import { SectionAction } from "./section-action";
import { Transcript } from "./transcript";
import { WritingSamples } from "./writing-samples";
import { getProfile, updateProfile, type ApplicantProfile } from "@/lib/profile-actions";
import { linkText, safeHref, siteName, webLink } from "@/lib/profile-links";
import { GitHubGlyph, LinkedInGlyph, OtherLinkGlyph, WebsiteGlyph } from "./icons";
import { getAvatar } from "@/lib/avatar-actions";
import { SEEKER_GUTTER } from "../gutter";
import { useProfileCache } from "../profile-cache";

/**
 * The profile screen: the profile photo and the identity fields, both live.
 * The photo, name and headline are shown here and edited in Settings'
 * Personal Details (KAN-326), through the band's Edit link, so each has one
 * editor; Contact & Links and Application Questions are edited here.
 * Name, headline, contact details and links come from the applicant_profiles
 * table via getProfile(). A return visit renders the last visit's data at once
 * (../profile-cache.tsx) and refetches it behind the scenes. The tab title
 * is set in ./layout.tsx, because a client page cannot export metadata.
 *
 * Resumes are not kept here. The Resume card (the uploads and their
 * dropzone) moved to the Resumes view's Your Uploaded Resumes card on 2026-10-18,
 * beside the base resumes, and Application
 * Settings (an Autofill switch that saved nothing) went the same day. Resume
 * facts are edited in the experience bank (/bank), never here (KAN-211).
 *
 *   identity        an open band under the title: the photo, the name and
 *                   headline, and Edit (to Settings), closed by a hairline
 *   Contact &       an open section: the contact email, the phone and the
 *   Links           four links (CONTACT_LINKS), each under a visible label;
 *                   its Edit turns the values into text fields in place;
 *                   closed by a hairline
 *   Application     an open section: the answers onboarding asked
 *   Questions       (./application-questions, KAN-269), edited the same way
 *                   with a picker each; closed by a hairline
 *   Writing         an open section: up to three samples of the student's
 *   Samples         own writing for their Claude (./writing-samples,
 *                   KAN-387), added in place; closed by a hairline
 *   Resumes &       an open section under a plain heading, linking to both
 *   Experiences     views of that page
 *
 * Each open section's actions sit at the top right of its heading, as a
 * Dashboard section's "View All" does (./section-action.tsx).
 *
 * A FAILED LOAD IS ONE NOTICE AT THE TOP, NOT A RED LINE UNDER EACH THING.
 * The photo and the profile load separately, and a single outage printed
 * as scattered faults. Errors from something the seeker just did (a photo
 * upload) still show beside it, because that is where they are looking.
 */
export default function ProfilePage() {
  // The last visit's data, if any, read once. A return visit renders it at
  // once, and the effects below refetch in the background.
  const cache = useProfileCache();
  const [cached] = useState(cache.read);

  // Identity fields from the backend.
  const [applicantProfile, setApplicantProfile] = useState<ApplicantProfile | null>(
    cached?.applicantProfile ?? null,
  );
  // The answer bank (Application Questions).
  const [answers, setAnswers] = useState<AutofillAnswers | null>(cached?.answers ?? null);

  // Profile photo, a signed URL from the API. Settings changes it.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cached?.avatarUrl ?? null);
  const [avatarLoaded, setAvatarLoaded] = useState(cached !== null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    getAvatar()
      .then(({ url, error }) => {
        // A failed refetch keeps the photo a return visit already shows.
        if (error) setLoadFailed(true);
        else setAvatarUrl(url);
      })
      // The action call itself failed, e.g. stale action IDs after a deploy.
      .catch(() => setLoadFailed(true))
      .finally(() => setAvatarLoaded(true));

    getProfile()
      .then(({ profile: p, error }) => {
        if (error) setLoadFailed(true);
        else if (p) setApplicantProfile(p);
      })
      .catch(() => setLoadFailed(true));

    getAutofillAnswers()
      .then(({ answers: a, error }) => {
        // A failed refetch keeps the answers a return visit already shows.
        if (error) setLoadFailed(true);
        else setAnswers(a);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  // Save each settled state for the next visit. Not mid-load, and not
  // after a failed load, which would show the next visit an empty profile.
  useEffect(() => {
    if (avatarLoaded && applicantProfile && answers && !loadFailed) {
      cache.write({ avatarUrl, applicantProfile, answers });
    }
  }, [cache, avatarLoaded, loadFailed, avatarUrl, applicantProfile, answers]);

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="mb-6">
        <h1 className="text-heading text-ink">My Profile</h1>
        <p className="text-body text-ink-meta mt-1">
          What employers see and what WorkIt fills in for you.
        </p>
      </div>

      {loadFailed && (
        <p
          role="status"
          className="bg-warning-tint text-ink rounded-control text-body mb-6 px-4 py-3"
        >
          Some of your profile didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      {/* The identity band: open on the page, not a card, and closed by a
          hairline rather than boxed. The photo leads the name the way a
          company logo leads a job title everywhere else in the app. Its
          Edit opens Settings' Personal Details, the one editor of the
          photo, name and headline (KAN-326). */}
      <section
        aria-labelledby="identity"
        className="border-border-subtle flex items-center gap-4 border-b pb-6 @xl/main:gap-5"
      >
        <Avatar
          name={applicantProfile?.full_name ?? ""}
          src={avatarUrl}
          className="text-title size-16 @xl/main:size-18"
        />

        <div className="min-w-0 flex-1">
          <SectionHeading id="identity">{applicantProfile?.full_name ?? "\u00A0"}</SectionHeading>
          {/* A held line while the profile loads; once loaded, no headline
              means no line, so the name centres beside the photo instead of
              sitting over an empty row. */}
          {(!applicantProfile || applicantProfile.headline) && (
            <p className="text-body text-ink-meta">{applicantProfile?.headline ?? "\u00A0"}</p>
          )}
        </div>

        <div className="ml-auto shrink-0 self-start">
          {/* A link in SectionAction's look, since it goes to Settings
              rather than acting here. */}
          <ButtonLink
            href="/settings/personal"
            variant="section"
            size="section"
            aria-label="Edit Profile in Settings"
          >
            <PencilIcon />
            Edit
          </ButtonLink>
        </div>
      </section>

      {applicantProfile && (
        <ContactSection profile={applicantProfile} onSaved={setApplicantProfile} />
      )}

      {/* Shown once both loads settle, as Contact & Links waits for the
          profile: a failed read shows the notice above, never nine "Not
          answered" lines that would pass for the seeker's real answers. */}
      {answers && <ApplicationQuestions answers={answers} onSaved={setAnswers} />}

      <WritingSamples />

      <Transcript />

      <section aria-labelledby="resumes" className="mt-6">
        <SectionHeading id="resumes">Resumes &amp; Experiences</SectionHeading>
        <p className="text-body text-ink-meta mt-1">
          Upload and generate your resumes on Resumes. Your jobs, projects, clubs and skills live in
          Experiences, where you edit them; each resume you upload fills it in.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/resumes" variant="secondary">
            Open Resumes
          </ButtonLink>
          <ButtonLink href="/bank" variant="secondary">
            Open Experiences
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

// --- Contact & Links -------------------------------------------------------

/** The four link fields (KAN-262), in the order the section lists them. They are the links hiring systems ask for by name, so the
 *  autofiller can put each in its own box; any other profile goes in Other
 *  Link, which the section names by its site (`siteName`). */
const CONTACT_LINKS = [
  {
    id: "linkedin_url",
    label: "LinkedIn",
    Icon: LinkedInGlyph,
    placeholder: "linkedin.com/in/your-name",
  },
  { id: "github_url", label: "GitHub", Icon: GitHubGlyph, placeholder: "github.com/your-name" },
  {
    id: "portfolio_url",
    label: "Portfolio or Website",
    Icon: WebsiteGlyph,
    placeholder: "your-name.com",
  },
  // No example text and no hint: any site named here read as the only kind
  // of link the field takes.
  { id: "other_url", label: "Other Link", Icon: OtherLinkGlyph, placeholder: undefined },
] as const;

/** Contact & Links' editable fields, in the order the section lists them. */
const CONTACT_FIELDS = [
  "contact_email",
  "phone_number",
  ...CONTACT_LINKS.map((l) => l.id),
] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];

type ContactItem = {
  field: ContactField;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** The value as it prints, or null for an empty field. */
  text: string | null;
  href: string | null;
  external?: boolean;
  note?: string;
  // In edit mode:
  editLabel: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  action?: ReactNode;
};

/**
 * Contact & Links: every field employers reach the seeker by, each under a
 * visible label, so an empty one is seen ("Not added") instead of left out.
 * Two columns where the page is wide, one on a phone.
 *
 * TWO MODES, LIKE A FORM YOU OPEN. Reading, each field is text: its value or
 * "Not added". Edit turns every value into a text field in place, with Save
 * and Cancel under them; Escape cancels. A per-field Add button in reading
 * mode was tried and dropped (2026-10-20): it offered an edit while the
 * section was not being edited. These fields are edited here only, never in
 * the Edit Profile dialog, so one value never has two editors.
 *
 * The email row shows the contact email, else the sign-in email with "Your
 * sign-in email" under it: the one employers see, and which one it is. Each
 * link opens in a new tab and prints as the resume header prints it
 * (`linkText`). A link that is not a web address (saved before the API
 * checked them) prints as plain text, never as an href.
 */
function ContactSection({
  profile,
  onSaved,
}: {
  profile: ApplicantProfile;
  onSaved: (p: ApplicantProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<ContactField, string>>(() =>
    toDraft(profile, CONTACT_FIELDS),
  );
  // The profile this edit started from: Save sends what differs from it, so
  // a background refetch landing mid-edit can't make another tab's newer
  // values look changed and get overwritten (as Application Questions).
  const [base, setBase] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Links that are not web addresses, checked on Save the way the API checks.
  const [badLinks, setBadLinks] = useState<ContactField[]>([]);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) firstField.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(toDraft(profile, CONTACT_FIELDS));
    setBase(profile);
    setBadLinks([]);
    setError(null);
    setEditing(true);
  }

  function set(field: ContactField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    setBadLinks((b) => b.filter((f) => f !== field));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Links get "https://" here, so the field and the saved value agree.
    const values: Record<string, string | null> = { ...draft };
    const bad: ContactField[] = [];
    for (const { id } of CONTACT_LINKS) {
      const link = webLink(draft[id]);
      if (link === "invalid") bad.push(id);
      else values[id] = link;
    }
    setBadLinks(bad);
    if (bad.length) {
      document.getElementById(`edit-${bad[0]}`)?.focus();
      return;
    }

    // The sign-in email typed back in is stored as empty, "use the sign-in
    // email", so the page can still say which one it is.
    if (isSignInEmail(draft.contact_email, profile)) values.contact_email = null;

    const fields = changedFields(base, values);
    if (Object.keys(fields).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { profile: updated, error: err } = await updateProfile(fields);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    if (updated) onSaved(updated);
    setEditing(false);
  }

  const email = profile.contact_email ?? profile.email;
  const phone = profile.phone_number;
  const typedEmail = draft.contact_email.trim().toLowerCase();
  const typedSignIn = typedEmail === profile.email.toLowerCase();
  const items: ContactItem[] = [
    {
      field: "contact_email",
      label: "Contact Email",
      editLabel: "Contact Email",
      Icon: MailIcon,
      text: email,
      href: `mailto:${email}`,
      // Also when the two match: it is still the sign-in address.
      note: email === profile.email ? "Your sign-in email" : undefined,
      type: "email",
      // Example text that cannot pass for a saved value: the sign-in email
      // here read as already filled in.
      placeholder: "you@example.com",
      hint: typedSignIn
        ? "This is your sign-in email."
        : !typedEmail
          ? `Employers see your sign-in email, ${profile.email}.`
          : "The email employers see, instead of your sign-in email.",
      // One click to the sign-in email, rather than retyping it and not
      // knowing it is the sign-in one. Shown on an empty field too, where a
      // seeker looks for it first. It is saved as empty either way.
      action: typedSignIn ? undefined : (
        <Button
          type="button"
          variant="ghost"
          size="section"
          className="mt-1.5"
          onClick={() => {
            set("contact_email", profile.email);
            firstField.current?.focus();
          }}
        >
          Use Sign-In Email
        </Button>
      ),
    },
    {
      field: "phone_number",
      label: "Phone",
      editLabel: "Phone",
      Icon: PhoneIcon,
      text: phone,
      href: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null,
      type: "tel",
      placeholder: "Your phone number",
    },
    ...CONTACT_LINKS.map(({ id, label, Icon, placeholder }) => {
      const url = profile[id];
      return {
        field: id,
        label: (url && id === "other_url" && siteName(url)) || label,
        editLabel: label,
        Icon,
        text: url ? linkText(url) : null,
        href: url ? safeHref(url) : null,
        external: true,
        placeholder,
      };
    }),
  ];

  return (
    <section aria-labelledby="contact" className="border-border-subtle border-b py-6">
      <div className="flex items-baseline justify-between gap-4">
        <SectionHeading id="contact">Contact &amp; Links</SectionHeading>
        {!editing && (
          <SectionAction aria-label="Edit Contact & Links" onClick={startEditing}>
            <PencilIcon />
            Edit
          </SectionAction>
        )}
      </div>
      <p className="text-body text-ink-meta mt-1">
        How employers reach you. Your resumes print these, and the autofiller fills them in.
      </p>

      {editing ? (
        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => e.key === "Escape" && !saving && setEditing(false)}
        >
          <div className={FIELD_GRID}>
            {items.map(({ field, editLabel, Icon, type, placeholder, hint, action }, i) => {
              const invalid = badLinks.includes(field);
              const note = invalid
                ? `edit-${field}-error`
                : hint
                  ? `edit-${field}-hint`
                  : undefined;
              return (
                <div key={field} className="min-w-0">
                  <label htmlFor={`edit-${field}`} className={FIELD_HEADING}>
                    <Icon aria-hidden className="text-brand size-5 shrink-0" />
                    {editLabel}
                  </label>
                  <div className="mt-1.5 pl-7">
                    <input
                      ref={i === 0 ? firstField : undefined}
                      id={`edit-${field}`}
                      type={type ?? "text"}
                      inputMode={field.endsWith("_url") ? "url" : undefined}
                      autoComplete={
                        field === "phone_number"
                          ? "tel"
                          : field === "contact_email"
                            ? "email"
                            : "url"
                      }
                      value={draft[field]}
                      onChange={(e) => set(field, e.target.value)}
                      placeholder={placeholder}
                      aria-invalid={invalid || undefined}
                      aria-describedby={note}
                      className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
                    />
                    {invalid ? (
                      <p id={note} className="text-meta text-danger mt-1">
                        {placeholder
                          ? `Enter a web address, such as ${placeholder}`
                          : "Enter a web address."}
                      </p>
                    ) : (
                      hint && (
                        <p id={note} className="text-meta text-ink-meta mt-1">
                          {hint}
                        </p>
                      )
                    )}
                    {action}
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p role="alert" className="text-meta text-danger mt-4">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <dl className={FIELD_GRID}>
          {items.map(({ field, label, Icon, text, href, external, note }) => (
            <div key={field} className="min-w-0">
              <dt className={FIELD_HEADING}>
                <Icon aria-hidden className="text-brand size-5 shrink-0" />
                {label}
              </dt>
              <dd className="text-body text-ink-muted mt-1.5 min-w-0 pl-7">
                {text === null ? (
                  <span className="text-ink-meta">Not added</span>
                ) : href ? (
                  <a
                    href={href}
                    {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                    className="hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs underline-offset-2 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {text}
                    {external && <span className="sr-only"> (opens in a new tab)</span>}
                  </a>
                ) : (
                  <span className="block truncate">{text}</span>
                )}
                {note && <span className="text-meta text-ink-meta mt-0.5 block">{note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** True when the typed contact email is empty or is the sign-in email. */
function isSignInEmail(typed: string, profile: ApplicantProfile) {
  const value = typed.trim().toLowerCase();
  return !value || value === profile.email.toLowerCase();
}

/** The PATCH body for a form: only the fields that changed, an empty one as
 *  null, which removes it. */
function changedFields(
  profile: ApplicantProfile,
  values: Record<string, string | null>,
): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const [id, value] of Object.entries(values)) {
    const v = value?.trim() || null;
    if (v !== (profile[id as keyof ApplicantProfile] || null)) fields[id] = v;
  }
  return fields;
}

function toDraft<F extends keyof ApplicantProfile>(
  p: ApplicantProfile,
  ids: readonly F[],
): Record<F, string> {
  return Object.fromEntries(ids.map((id) => [id, p[id] ?? ""])) as Record<F, string>;
}
