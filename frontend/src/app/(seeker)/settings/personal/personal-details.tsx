"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { Avatar } from "@/components/avatar";
import { TrashIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { removeAvatar, uploadAvatar } from "@/lib/avatar-actions";
import { AVATAR_MIME_TYPES, avatarFileError } from "@/lib/avatar-rules";
import { cn } from "@/lib/cn";
import { updateProfile, type ApplicantProfile } from "@/lib/profile-actions";

/** applicant_profiles' column widths, which the API also checks. The parts
 *  joined must fit full_name's 50 too; the API says so if they don't. */
const NAME_MAX = 50;
const HEADLINE_MAX = 50;

const NAME_FIELDS = [
  { key: "first_name", id: "first-name", label: "First Name", autoComplete: "given-name" },
  { key: "middle_name", id: "middle-name", label: "Middle Name", autoComplete: "additional-name" },
  { key: "last_name", id: "last-name", label: "Last Name", autoComplete: "family-name" },
] as const;
type NameKey = (typeof NAME_FIELDS)[number]["key"];
type Names = Record<NameKey, string>;

const namesOf = (p: ApplicantProfile): Names => ({
  first_name: p.first_name,
  middle_name: p.middle_name ?? "",
  last_name: p.last_name ?? "",
});

/**
 * The photo, the name and the headline: the one place each is edited
 * (KAN-326). My Profile shows them and links here, so no value has two
 * editors (docs/screens.md, My Profile). The photo saves the moment one is
 * picked, as it did on My Profile: the picked file shows at once and rolls
 * back if the upload fails. The name is asked as signup asks it, first,
 * middle (optional) and last; the API joins them into the full name every
 * other screen prints. The name and headline save together with Save.
 * Both refresh the route, so the bar's name and photo follow.
 */
export function PersonalDetails({
  profile,
  avatarUrl: initialAvatar,
}: {
  profile: ApplicantProfile;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const input = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [saved, setSaved] = useState(profile);
  const [names, setNames] = useState<Names>(() => namesOf(profile));
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedNames = namesOf(saved);
  const changedNames = NAME_FIELDS.filter(({ key }) => names[key].trim() !== savedNames[key]);
  const headlineChanged = (headline.trim() || null) !== (saved.headline || null);
  const changed = changedNames.length > 0 || headlineChanged;

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file || photoBusy) return;
    const invalid = avatarFileError(file);
    if (invalid) {
      setPhotoError(invalid);
      return;
    }

    const previous = avatarUrl;
    const preview = URL.createObjectURL(file);
    setAvatarUrl(preview);
    setPhotoError(null);
    setPhotoBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { url, error: uploadError } = await uploadAvatar(fd);
      if (uploadError) {
        setAvatarUrl(previous);
        setPhotoError(uploadError);
        return;
      }
      setAvatarUrl(url ?? previous);
      router.refresh();
    } catch {
      setAvatarUrl(previous);
      setPhotoError("Could not reach the server.");
    } finally {
      URL.revokeObjectURL(preview);
      setPhotoBusy(false);
    }
  }

  async function dropPhoto() {
    if (photoBusy) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const { error: removeError } = await removeAvatar();
      if (removeError) {
        setPhotoError(removeError);
        return;
      }
      setAvatarUrl(null);
      router.refresh();
    } catch {
      setPhotoError("Could not reach the server.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!changed || saving) return;
    setError(null);
    setSaving(true);
    try {
      // Only what changed. An empty middle name or headline clears it; the
      // first and last names are required by their fields and the API.
      const fields: Parameters<typeof updateProfile>[0] = Object.fromEntries(
        changedNames.map(({ key }) => [key, names[key].trim() || null]),
      );
      if (headlineChanged) fields.headline = headline.trim() || null;
      const { profile: updated, error: saveError } = await updateProfile(fields);
      if (saveError || !updated) {
        setError(saveError ?? "Something went wrong. Please try again.");
        return;
      }
      setSaved(updated);
      setNames(namesOf(updated));
      setHeadline(updated.headline ?? "");
      toast.show({ message: "Your details are saved." });
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar
          name={saved.full_name}
          src={avatarUrl}
          className={cn("text-title size-18", photoBusy && "opacity-60")}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={photoBusy}
              onClick={() => input.current?.click()}
            >
              <UploadIcon />
              {avatarUrl ? "Change Photo" : "Add Photo"}
            </Button>
            {avatarUrl && (
              <Button variant="ghost" size="sm" disabled={photoBusy} onClick={dropPhoto}>
                <TrashIcon />
                Remove Photo
              </Button>
            )}
          </div>
          <p className="text-meta text-ink-meta">JPEG, PNG or WebP, under 5 MB.</p>
          {photoError && (
            <p role="alert" className="text-meta text-danger">
              {photoError}
            </p>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept={AVATAR_MIME_TYPES.join(",")}
          className="hidden"
          onChange={pickPhoto}
        />
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
          {NAME_FIELDS.map(({ key, id, label, autoComplete }) => (
            <TextField
              key={key}
              id={id}
              label={label}
              autoComplete={autoComplete}
              required={key !== "middle_name"}
              maxLength={NAME_MAX}
              value={names[key]}
              onChange={(event) => setNames((n) => ({ ...n, [key]: event.target.value }))}
            />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <TextField
            id="headline"
            label="Headline"
            maxLength={HEADLINE_MAX}
            placeholder="Computer science student at Stony Brook"
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            aria-describedby="headline-hint"
          />
          <p id="headline-hint" className="text-meta text-ink-meta">
            The line under your name on My Profile
          </p>
        </div>

        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={!changed || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {changed && !saving && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setNames(namesOf(saved));
                setHeadline(saved.headline ?? "");
                setError(null);
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
