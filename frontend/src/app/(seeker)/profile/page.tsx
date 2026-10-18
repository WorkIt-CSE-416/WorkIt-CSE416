"use client";

import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { MailIcon, PencilIcon, TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { FIELD_CONTROL, FIELD_LABEL } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import { SectionAction } from "./section-action";
import { getProfile, updateProfile, type ApplicantProfile } from "@/lib/profile-actions";
import { getAvatar, removeAvatar, uploadAvatar } from "@/lib/avatar-actions";
import { AVATAR_MIME_TYPES, avatarFileError } from "@/lib/avatar-rules";
import { SEEKER_GUTTER } from "../gutter";
import { useProfileCache } from "../profile-cache";

/**
 * The profile screen: the profile photo and the identity fields, both live.
 * Name, headline, email and phone come from the applicant_profiles table
 * via getProfile(). A return visit renders the last visit's data at once
 * (../profile-cache.tsx) and refetches it behind the scenes. The tab title
 * is set in ./layout.tsx, because a client page cannot export metadata.
 *
 * Resumes are not kept here. The Resume card (the uploads and their
 * dropzone) moved to the Resumes view's Your Resumes card on 2026-10-18,
 * beside the base resumes that share its limit of 5, and Application
 * Settings (an Autofill switch that saved nothing) went the same day. Resume
 * facts are edited in the experience bank (/bank), never here (KAN-211).
 *
 *   identity        an open band under the title: the photo and its edit
 *                   control, the name and headline, the contact details as
 *                   one wrapping row, closed by a hairline
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
  const router = useRouter();
  const cache = useProfileCache();
  const [cached] = useState(cache.read);

  // Identity fields from the backend.
  const [applicantProfile, setApplicantProfile] = useState<ApplicantProfile | null>(
    cached?.applicantProfile ?? null,
  );
  const [editOpen, setEditOpen] = useState(false);

  // Profile photo. avatarUrl is a signed URL from the API, or a blob: preview
  // while an upload is in flight. avatarLoaded separates the first fetch,
  // which shows the avatar as is, from an upload or removal, which dims it.
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cached?.avatarUrl ?? null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(cached === null);
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
      .finally(() => {
        setAvatarBusy(false);
        setAvatarLoaded(true);
      });

    getProfile()
      .then(({ profile: p, error }) => {
        if (error) setLoadFailed(true);
        else if (p) setApplicantProfile(p);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  // Save each settled state for the next visit. Not mid-load, not while a
  // photo upload's blob: preview (revoked afterwards) is on screen, and not
  // after a failed load, which would show the next visit an empty profile.
  useEffect(() => {
    if (avatarLoaded && !avatarBusy && applicantProfile && !loadFailed) {
      cache.write({ avatarUrl, applicantProfile });
    }
  }, [cache, avatarLoaded, avatarBusy, loadFailed, avatarUrl, applicantProfile]);

  async function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file || avatarBusy) return;

    const invalid = avatarFileError(file);
    if (invalid) {
      setAvatarError(invalid);
      return;
    }

    // Show the picked file immediately; roll back if the upload fails.
    const previous = avatarUrl;
    const preview = URL.createObjectURL(file);
    setAvatarUrl(preview);
    setAvatarError(null);
    setAvatarBusy(true);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const { url, error } = await uploadAvatar(fd);
      if (error) {
        setAvatarUrl(previous);
        setAvatarError(error);
        return;
      }
      setAvatarUrl(url ?? previous);
      router.refresh();
    } finally {
      URL.revokeObjectURL(preview);
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    if (avatarBusy) return;
    setAvatarError(null);
    setAvatarBusy(true);
    const { error } = await removeAvatar();
    setAvatarBusy(false);
    if (error) {
      setAvatarError(error);
      return;
    }
    setAvatarUrl(null);
    router.refresh();
  }

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
          company logo leads a job title everywhere else in the app. Remove
          Photo follows the name on its baseline, beside the photo it acts
          on, rather than in a heading's top-right slot, which across this
          band would put it a page away from the photo and read as an action
          on the whole profile. It is shorter than the name's line, so
          appearing once there is a photo moves nothing else; only a name too
          long to share a phone's width with it wraps it to a line below. */}
      <section
        aria-labelledby="identity"
        className="border-border-subtle flex items-start gap-4 border-b pb-6 @xl/main:items-center @xl/main:gap-5"
      >
        <div className="relative shrink-0">
          <Avatar
            name={applicantProfile?.full_name ?? ""}
            src={avatarUrl}
            className={cn(
              "text-title size-16 @xl/main:size-18",
              avatarBusy && avatarLoaded && "opacity-60",
            )}
          />
          <IconButton
            label="Change profile photo"
            variant="brand"
            className="absolute -right-0.5 -bottom-0.5"
            disabled={avatarBusy}
            onClick={() => avatarInput.current?.click()}
          >
            <PencilIcon className="size-3" />
          </IconButton>
          <input
            ref={avatarInput}
            type="file"
            accept={AVATAR_MIME_TYPES.join(",")}
            className="hidden"
            onChange={handleAvatarSelect}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <SectionHeading id="identity">{applicantProfile?.full_name ?? "\u00A0"}</SectionHeading>
            {avatarUrl && !avatarBusy && (
              <SectionAction onClick={handleAvatarRemove}>
                <TrashIcon />
                Remove Photo
              </SectionAction>
            )}
          </div>
          <p className="text-body text-ink-meta">{applicantProfile?.headline ?? "\u00A0"}</p>

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {applicantProfile?.email && (
              <div className="flex max-w-full min-w-0 items-center gap-2">
                <dt className="contents">
                  <MailIcon className="text-ink-meta size-4 shrink-0" />
                  <span className="sr-only">Email</span>
                </dt>
                <dd className="text-body text-ink-muted truncate">{applicantProfile.email}</dd>
              </div>
            )}
            {applicantProfile?.phone_number && (
              <div className="flex max-w-full min-w-0 items-center gap-2">
                <dt className="contents">
                  <Phone className="text-ink-meta size-4 shrink-0" />
                  <span className="sr-only">Phone</span>
                </dt>
                <dd className="text-body text-ink-muted truncate">
                  {applicantProfile.phone_number}
                </dd>
              </div>
            )}
          </dl>

          {avatarError && (
            <p role="alert" className="text-meta text-danger mt-2">
              {avatarError}
            </p>
          )}
        </div>

        {applicantProfile && (
          <div className="ml-auto shrink-0 self-start">
            <SectionAction onClick={() => setEditOpen(true)}>
              <PencilIcon />
              Edit
            </SectionAction>
          </div>
        )}
      </section>

      <section aria-labelledby="resumes" className="mt-8">
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

      {applicantProfile && editOpen && (
        <EditProfileDialog
          profile={applicantProfile}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={setApplicantProfile}
        />
      )}
    </div>
  );
}

// --- Edit Profile Dialog ---------------------------------------------------

const PROFILE_FIELDS = [
  { id: "full_name", label: "Full Name", required: true },
  { id: "headline", label: "Headline" },
  { id: "phone_number", label: "Phone Number" },
  { id: "linkedin_url", label: "LinkedIn" },
  { id: "portfolio_url", label: "Portfolio" },
  { id: "github_url", label: "GitHub" },
  { id: "other_url", label: "Other URL" },
] as const;

type EditableField = (typeof PROFILE_FIELDS)[number]["id"];

function EditProfileDialog({
  profile,
  open,
  onOpenChange,
  onSaved,
}: {
  profile: ApplicantProfile;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (p: ApplicantProfile) => void;
}) {
  // Key changes reset state via the parent's key prop; no effect needed.
  const [draft, setDraft] = useState<Record<EditableField, string>>(() => fieldsToDraft(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: EditableField, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fields: Record<string, string | null> = {};
    for (const { id } of PROFILE_FIELDS) {
      const v = draft[id].trim();
      // Send the field if it changed from the current profile value.
      const current = profile[id] ?? "";
      if (v !== current) fields[id] = v || null;
    }
    // full_name must not be null
    if ("full_name" in fields) fields.full_name = draft.full_name.trim() || profile.full_name;

    if (Object.keys(fields).length === 0) {
      onOpenChange(false);
      setSaving(false);
      return;
    }

    const { profile: updated, error: err } = await updateProfile(fields);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    if (updated) onSaved(updated);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-subtitle font-semibold">Edit Profile</DialogTitle>
          <DialogDescription>
            Update your profile information. Email is changed through your account settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className={FIELD_LABEL}>Email</label>
            <input disabled value={profile.email} className={cn(FIELD_CONTROL, "px-3.5 py-2.5")} />
          </div>

          {PROFILE_FIELDS.map(({ id, label, ...rest }) => (
            <div key={id} className="flex flex-col gap-1">
              <label htmlFor={`edit-${id}`} className={FIELD_LABEL}>
                {label}
              </label>
              <input
                id={`edit-${id}`}
                value={draft[id]}
                onChange={(e) => set(id, e.target.value)}
                required={"required" in rest}
                className={cn(FIELD_CONTROL, "px-3.5 py-2.5")}
              />
            </div>
          ))}

          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="secondary">Cancel</Button>} />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving\u2026" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function fieldsToDraft(p: ApplicantProfile): Record<EditableField, string> {
  return {
    full_name: p.full_name,
    headline: p.headline ?? "",
    phone_number: p.phone_number ?? "",
    linkedin_url: p.linkedin_url ?? "",
    portfolio_url: p.portfolio_url ?? "",
    github_url: p.github_url ?? "",
    other_url: p.other_url ?? "",
  };
}
