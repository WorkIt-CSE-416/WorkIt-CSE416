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

import { Skeleton } from "@/components/shadcn/skeleton";
import { MailIcon, PencilIcon, PinIcon } from "@/components/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading, SectionHeadingSkeleton } from "@/components/ui/section-heading";
import { TextInput } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import { FIELD_GRID, FIELD_HEADING, SECTION_CARD } from "./field-styles";
import { MoreOfYou } from "./more-of-you";
import { SectionAction } from "./section-action";
import { updateProfile, type ApplicantProfile } from "@/lib/profile-actions";
import { linkText, phoneText, safeHref, siteName, webLink } from "@/lib/profile-links";
import { GitHubGlyph, LinkedInGlyph, OtherLinkGlyph, WebsiteGlyph } from "./icons";
import { getProfilePage } from "@/lib/profile-page-actions";
import { SEEKER_GUTTER } from "../gutter";
import { useProfileCache } from "../profile-cache";

/**
 * My Profile: the student as an employer sees them (KAN-550). The photo, name
 * and headline are shown here and edited in Settings' Personal Details
 * (KAN-326), through the identity card's Edit Profile, so each has one
 * editor; Contact & Links is edited here. Name, headline, contact details and
 * links come from the applicant_profiles table via getProfile(), read with
 * the photo in one server action, getProfilePage()
 * (@/lib/profile-page-actions), because Next runs server actions one at a
 * time. A return visit renders the last visit's data at once
 * (../profile-cache.tsx) and refetches it behind the scenes. ./page.tsx, a
 * server page, draws this screen and hands it what it reads on the server
 * (./profile-facts.tsx): `school`, the identity card's school line, and
 * `extras`, the Job Preferences and Top Skills cards, each streamed in its
 * own <Suspense> so the profile never waits for them.
 *
 * WHITE CARDS ON THE GREY GROUND, TWO COLUMNS FROM @4xl/main (KAN-550):
 *
 *   identity        the left column: the photo, the name and headline,
 *                   the home location and the school line, and Edit
 *                   Profile (to Settings)
 *   Contact &       the contact email, the phone, the home location and
 *   Links           the four links (CONTACT_LINKS), each under a visible
 *                   label; its Edit turns the values into text fields in
 *                   place
 *   Job Prefs and   what the student is looking for and their skills
 *   Top Skills      (`extras`, ./profile-facts.tsx)
 *   More of you     a card each for Resumes, Experiences and Application
 *                   Info, each a link to where that part is kept
 *                   (./more-of-you.tsx)
 *
 * WHAT IS NOT HERE, AND WHERE IT WENT. The work authorization and
 * self-identification answers, Application Answers, the Transcript and
 * Writing Samples moved to Application Info (/auto-apply/info, KAN-550):
 * only the autofiller and the student's Claude read them, and they made this
 * page a long form the student scrolled past to find their own name. The
 * Resume card moved to the Resumes view on 2026-10-18, and Application
 * Settings (an Autofill switch that saved nothing) went the same day. Resume
 * facts are edited in the experience bank (/experiences), never here
 * (KAN-211). The extension's older versions still open
 * /profile#writing-samples, which this page forwards to Application Info.
 *
 * A FAILED LOAD IS ONE NOTICE AT THE TOP, NOT A RED LINE UNDER EACH THING.
 * The photo and the profile each come back with their own error, and a
 * single outage printed as scattered faults.
 */
export function ProfileScreen({ school, extras }: { school: ReactNode; extras: ReactNode }) {
  // The last visit's data, if any, read once. A return visit renders it at
  // once, and the effects below refetch in the background.
  const cache = useProfileCache();
  const [cached] = useState(cache.read);

  // Identity fields from the backend.
  const [applicantProfile, setApplicantProfile] = useState<ApplicantProfile | null>(
    cached?.applicantProfile ?? null,
  );

  // Profile photo, a signed URL from the API. Settings changes it.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cached?.avatarUrl ?? null);
  // True once the page's read has settled (or a return visit's snapshot
  // stands in for it), so the snapshot below is never saved mid-load.
  const [settled, setSettled] = useState(cached !== null);
  const [loadFailed, setLoadFailed] = useState(false);

  // The extension's ask for writing samples opened /profile#writing-samples
  // until KAN-550; installed copies still do. A hash never reaches the
  // server, so the forward happens here. A full load, since Writing Samples
  // reads the hash once, as it mounts.
  useEffect(() => {
    if (window.location.hash === "#writing-samples") {
      window.location.replace("/auto-apply/info#writing-samples");
    }
  }, []);

  // One action for both reads, never two calls from here: Next runs server
  // actions one at a time, so separate calls waited for each other
  // (@/lib/profile-page-actions). Each part still has its own error, and a
  // failed refetch keeps the part a return visit already shows.
  useEffect(() => {
    getProfilePage()
      .then(({ avatar, profile }) => {
        if (avatar.error) setLoadFailed(true);
        else setAvatarUrl(avatar.url);

        if (profile.error) setLoadFailed(true);
        else if (profile.profile) setApplicantProfile(profile.profile);
      })
      // The action call itself failed, e.g. stale action IDs after a deploy.
      .catch(() => setLoadFailed(true))
      .finally(() => setSettled(true));
  }, []);

  // Save each settled state for the next visit. Not mid-load, and not
  // after a failed load, which would show the next visit an empty profile.
  useEffect(() => {
    if (settled && applicantProfile && !loadFailed) {
      cache.write({ avatarUrl, applicantProfile });
    }
  }, [cache, settled, loadFailed, avatarUrl, applicantProfile]);

  return (
    <div className={cn("max-w-dashboard mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      {loadFailed && (
        <p
          role="status"
          className="bg-warning-tint text-ink rounded-control text-body mb-6 px-4 py-3"
        >
          Some of your profile didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      <div className="grid items-start gap-4 @4xl/main:grid-cols-[17rem_minmax(0,1fr)]">
        {/* The identity card. The photo leads the name the way a company
            logo leads a job title everywhere else in the app. Edit Profile
            opens Settings' Personal Details, the one editor of the photo,
            name and headline (KAN-326). */}
        <Card
          as="section"
          padding="none"
          aria-labelledby={applicantProfile ? "identity" : undefined}
          aria-label={applicantProfile ? undefined : "Your Profile"}
          className={cn(SECTION_CARD, "flex flex-col items-center text-center")}
        >
          {applicantProfile ? (
            <>
              <Avatar
                name={applicantProfile.full_name}
                src={avatarUrl}
                className="text-display size-24"
              />
              <SectionHeading id="identity" className="mt-4">
                {applicantProfile.full_name}
              </SectionHeading>
              {/* No headline means no line, rather than an empty row under
                  the name. */}
              {applicantProfile.headline && (
                <p className="text-body text-ink-meta mt-0.5">{applicantProfile.headline}</p>
              )}
            </>
          ) : (
            // While the profile loads: the photo, the name and the headline
            // as bars on their own lines (KAN-561), not a blank circle and
            // empty rows.
            <div aria-hidden="true" className="flex flex-col items-center">
              <Skeleton className="size-24 rounded-full" />
              <div className="mt-4 flex h-7 items-center">
                <Skeleton className="h-5 w-36" />
              </div>
              <div className="mt-0.5 flex h-5 items-center">
                <Skeleton className="h-3.5 w-28" />
              </div>
            </div>
          )}
          <ButtonLink
            href="/settings/personal"
            variant="secondary"
            size="sm"
            className="mt-5 w-full"
            aria-label="Edit Profile in Settings"
          >
            <PencilIcon />
            Edit Profile
          </ButtonLink>
          {/* The facts under a hairline, left-aligned as a list: centred,
              a two-line school beside its glyph read as a stray icon. Grey
              glyphs, since they only inform (docs/design.md). The location
              shows once loaded, and only when set; Contact & Links edits
              it. The school row comes from the server (`school`). */}
          <ul className="border-border-subtle text-body text-ink-muted mt-5 flex w-full flex-col gap-3 border-t pt-5 text-left">
            {applicantProfile?.location && (
              <li className="flex items-start gap-2.5">
                <PinIcon className="text-ink-meta mt-0.5 size-4 shrink-0" />
                {applicantProfile.location}
              </li>
            )}
            {school}
          </ul>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {applicantProfile ? (
            <ContactSection profile={applicantProfile} onSaved={setApplicantProfile} />
          ) : (
            <ContactSkeleton />
          )}
          {extras}
          <MoreOfYou />
        </div>
      </div>
    </div>
  );
}

/** Contact & Links while the profile loads: its card at about its height,
 *  the heading a bar (KAN-519's rule: no real text among the bars). */
function ContactSkeleton() {
  return (
    <Card as="section" padding="none" aria-label="Contact & Links" className={SECTION_CARD}>
      <SectionHeadingSkeleton />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div aria-hidden className={FIELD_GRID}>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="ml-7 h-4 w-48" />
          </div>
        ))}
      </div>
    </Card>
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
  "location",
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
      text: phone ? phoneText(phone) : null,
      href: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null,
      type: "tel",
      placeholder: "Your phone number",
    },
    {
      // Where the student lives, as forms ask it (KAN-372): onboarding asks
      // it, and Application Answers' Address takes its city and state.
      field: "location",
      label: "Location",
      editLabel: "Location",
      Icon: PinIcon,
      text: profile.location,
      href: null,
      placeholder: "City, State",
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
    <Card as="section" padding="none" aria-labelledby="contact" className={SECTION_CARD}>
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
                    <Icon aria-hidden className="text-ink-meta size-5 shrink-0" />
                    {editLabel}
                  </label>
                  {/* The bare box: the card's field heading is its label. */}
                  <div className="mt-1.5 pl-7">
                    <TextInput
                      ref={i === 0 ? firstField : undefined}
                      id={`edit-${field}`}
                      type={type ?? "text"}
                      inputMode={field.endsWith("_url") ? "url" : undefined}
                      autoComplete={
                        field === "phone_number"
                          ? "tel"
                          : field === "contact_email"
                            ? "email"
                            : field === "location"
                              ? "address-level2"
                              : "url"
                      }
                      value={draft[field]}
                      onChange={(e) => set(field, e.target.value)}
                      placeholder={placeholder}
                      aria-invalid={invalid || undefined}
                      aria-describedby={note}
                    />
                    {invalid ? (
                      <p id={note} className="text-note text-danger mt-1">
                        {placeholder
                          ? `Enter a web address, such as ${placeholder}`
                          : "Enter a web address."}
                      </p>
                    ) : (
                      hint && (
                        <p id={note} className="text-note text-ink-meta mt-1">
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
            <p role="alert" className="text-note text-danger mt-4">
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
                <Icon aria-hidden className="text-ink-meta size-5 shrink-0" />
                {label}
              </dt>
              <dd className="text-body text-ink-muted mt-1.5 min-w-0 pl-7">
                {text === null ? (
                  <span className="text-ink-meta">Not added</span>
                ) : href ? (
                  <a
                    href={href}
                    title={text}
                    {...(external && { target: "_blank", rel: "noopener noreferrer" })}
                    className="text-ink hover:text-brand focus-visible:ring-brand-ring block truncate rounded-xs underline underline-offset-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {text}
                    {external && <span className="sr-only"> (opens in a new tab)</span>}
                  </a>
                ) : (
                  <span title={text} className="block truncate">
                    {text}
                  </span>
                )}
                {note && <span className="text-note text-ink-meta mt-0.5 block">{note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
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
