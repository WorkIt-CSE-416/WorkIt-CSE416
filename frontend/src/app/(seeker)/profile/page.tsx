"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { MailIcon, PdfIcon, PencilIcon, PinIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import { PROFILE, ROLES, SKILLS } from "./data";
import { PhoneIcon } from "./icons";
import { ResumeUpload } from "@/components/resume-upload";
import { uploadResume, deleteResume, listResumes, type ResumeItem } from "@/lib/resume-actions";
import { getAvatar, removeAvatar, uploadAvatar } from "@/lib/avatar-actions";
import { AVATAR_MIME_TYPES, avatarFileError } from "@/lib/avatar-rules";
import { SEEKER_GUTTER } from "../gutter";

/**
 * The profile screen. Resumes and the profile photo are live (resume-actions,
 * avatar-actions); name, contact details, roles and skills still render the
 * fixtures in ./data, and their edit affordances are inert until endpoints
 * exist. The autofill switch is a bare checkbox with role="switch" that styles
 * its own on state. The tab title is set in ./layout.tsx, because a client
 * page cannot export metadata.
 *
 * A FAILED LOAD IS ONE NOTICE AT THE TOP, NOT A RED LINE PER CARD. The photo
 * and the resumes load separately, and each used to print its own "Could not
 * reach the server." in red under the thing it failed to load — under the
 * avatar, and under the dropzone — so a single outage read as two scattered
 * faults. Errors from something the seeker just did (an upload, a delete)
 * still show beside it, because that is where they are looking.
 */
const CONTACT = [
  { Icon: MailIcon, label: "Email", value: PROFILE.email },
  { Icon: PhoneIcon, label: "Phone", value: PROFILE.phone },
  { Icon: PinIcon, label: "Location", value: PROFILE.location },
];

const MAX_RESUMES = 5;

/** What each backend resume status reads as. A failed parse is a warning, not
 *  a danger: the file is stored, and only its text could not be extracted. */
const RESUME_STATUS: Record<string, { label: string; tone: BadgeTone } | undefined> = {
  parsed: { label: "Ready", tone: "positive" },
  uploaded: { label: "Processing", tone: "inert" },
  parse_failed: { label: "Couldn't read text", tone: "warning" },
};

/** One resume row. The in-flight upload and the loading placeholder are the
 *  same 52px box, so the list does not jump when the real row arrives. */
const RESUME_ROW =
  "border-border-subtle bg-app rounded-control mt-2 flex items-center gap-3 border p-2";

/** Rows only exist after the client-side fetch, so this is the browser's own
 *  calendar day, never the server's UTC one. */
function uploadedOn(createdAt: string | null) {
  if (!createdAt) return "Uploaded";
  const day = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Uploaded ${day}`;
}

export default function ProfilePage() {
  // Resume items. `uploading` is the name of the file in flight, or null.
  const [resumeList, setResumeList] = useState<ResumeItem[]>([]);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A failed list hides the "2 of 5" count: "0 of 5" would say there are none.
  const [listFailed, setListFailed] = useState(false);

  // The resume the delete dialog asks about. It outlives `confirmOpen` so the
  // filename does not vanish while the dialog fades out.
  const [deleteTarget, setDeleteTarget] = useState<ResumeItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Profile photo. avatarUrl is a signed URL from the API, or a blob: preview
  // while an upload is in flight. avatarLoaded separates the first fetch,
  // which shows the avatar as is, from an upload or removal, which dims it.
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(true);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    getAvatar().then(({ url, error }) => {
      setAvatarUrl(url);
      setAvatarBusy(false);
      setAvatarLoaded(true);
      if (error) setLoadFailed(true);
    });
  }, []);

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
  }

  // Load the resumes initially
  useEffect(() => {
    listResumes().then(({ resumes, error }) => {
      setResumeList(resumes);
      if (error) {
        setLoadFailed(true);
        setListFailed(true);
      }
      setLoaded(true);
    });
  }, []);

  async function handleResumeFileAdd(file: File) {
    if (!loaded || uploading !== null) return;
    if (resumeList.length >= MAX_RESUMES) {
      setResumeError(`You can keep up to ${MAX_RESUMES} resumes. Remove one to add another.`);
      return;
    }
    setResumeError(null);
    setUploading(file.name);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const { resume, error } = await uploadResume(fd);
      if (error) {
        setResumeError(error);
        return;
      }
      if (resume) {
        setResumeList((prev) => [resume, ...prev]);
      }
    } finally {
      setUploading(null);
    }
  }

  async function handleRemove(resumeId: string) {
    if (deletingId) return;
    setResumeError(null);
    setDeletingId(resumeId);
    try {
      const { error } = await deleteResume(resumeId);
      if (error) {
        setResumeError(error);
        return;
      }
      setResumeList((prev) => prev.filter((r) => r.id !== resumeId));
    } catch {
      // The server action call itself failed
      // or the page came back from the back-forward cache with stale action IDs.
      setResumeError("Could not remove the resume. Refresh the page and try again.");
    } finally {
      // Without this a thrown call leaves deletingId set, and every later
      // click returns early without doing anything.
      setDeletingId(null);
    }
  }

  // Deleting is final, which is the whole reason the trash button asks first.
  // The dialog closes at once; the row's dimmed button shows the delete running.
  function confirmRemove() {
    setConfirmOpen(false);
    if (deleteTarget) handleRemove(deleteTarget.id);
  }

  return (
    <div className={cn("max-w-app mx-auto w-full flex-1 py-6", SEEKER_GUTTER)}>
      <div className="mb-5">
        <h1 className="text-heading text-ink">My Profile</h1>
        <p className="text-body text-ink-meta mt-1">
          What employers see and what WorkIt fills in for you.
        </p>
      </div>

      {loadFailed && (
        <p
          role="status"
          className="bg-warning-tint text-ink rounded-control text-body mb-5 px-4 py-3"
        >
          Some of your profile didn&apos;t load. Refresh the page to try again.
        </p>
      )}

      {/* Settings comes last in the DOM, so a phone reaches it after Resume,
          Experience and Skills. From @3xl the grid puts it back in the left
          column under the identity card, and the right column spans both rows.
          Every track has a zero minimum, so a long resume filename truncates
          instead of widening its column past the screen. */}
      <div className="grid grid-cols-1 items-start gap-5 @3xl/main:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl/main:grid-rows-[auto_1fr]">
        <div className="flex flex-col gap-5">
          {/* Left-aligned throughout. The name used to be centred under a
              116px avatar while the contact rows below it ran from the left
              edge, so the card had two alignments and the avatar most of its
              height. The photo now leads the name the way a company tile
              leads a job title everywhere else in the app. */}
          <Card as="section" aria-labelledby="identity">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <Avatar
                  name={PROFILE.name}
                  src={avatarUrl}
                  className={cn("text-title size-16", avatarBusy && avatarLoaded && "opacity-60")}
                />
                <IconButton
                  label="Change profile photo"
                  variant="brand"
                  className="absolute -right-1 -bottom-1"
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

              <div className="min-w-0">
                <SectionHeading id="identity">{PROFILE.name}</SectionHeading>
                <p className="text-body text-ink-meta">{PROFILE.title}</p>
                {avatarUrl && !avatarBusy && (
                  <Button
                    variant="ghost"
                    size="inline"
                    className="mt-1"
                    onClick={handleAvatarRemove}
                  >
                    Remove photo
                  </Button>
                )}
              </div>
            </div>
            {avatarError && (
              <p role="alert" className="text-meta text-danger mt-3">
                {avatarError}
              </p>
            )}

            <dl className="border-border-subtle mt-4 flex flex-col gap-2 border-t pt-4">
              {CONTACT.map(({ Icon, label, value }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <dt className="contents">
                    <Icon className="text-ink-meta size-4 shrink-0" />
                    <span className="sr-only">{label}</span>
                  </dt>
                  <dd className="text-body text-ink-muted truncate">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="flex flex-col gap-5 @3xl/main:col-start-2 @3xl/main:row-span-2 @3xl/main:row-start-1">
          <Card as="section" aria-labelledby="resume">
            <SectionHeading
              id="resume"
              action={
                loaded && !listFailed ? (
                  <span className="text-note text-ink-meta">
                    {resumeList.length} of {MAX_RESUMES}
                  </span>
                ) : undefined
              }
            >
              Resume
            </SectionHeading>

            <div className="mt-4">
              <ResumeUpload
                file={null}
                onFileChange={handleResumeFileAdd}
                onRemove={() => {}}
                busy={uploading !== null}
              />
            </div>
            {resumeError && (
              <p role="alert" className="text-meta text-danger mt-2">
                {resumeError}
              </p>
            )}
            {!loaded && (
              <div aria-hidden="true" className="bg-well rounded-control mt-2 h-13 animate-pulse" />
            )}
            {uploading !== null && (
              <div className={RESUME_ROW}>
                <PdfIcon className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-ink truncate">{uploading}</p>
                  <p className="text-note text-ink-meta">Uploading…</p>
                </div>
              </div>
            )}
            {resumeList.map((r) => {
              const status = RESUME_STATUS[r.status] ?? { label: r.status, tone: "inert" };
              return (
                <div key={r.id} className={RESUME_ROW}>
                  <PdfIcon className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-ink truncate">
                      {r.original_filename ?? "Resume"}
                    </p>
                    <p className="text-note text-ink-meta">{uploadedOn(r.created_at)}</p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <IconButton
                    label={`Delete ${r.original_filename ?? "resume"}`}
                    tooltip="Delete"
                    className="rounded-control hover:bg-hover hover:text-danger size-8"
                    disabled={deletingId === r.id}
                    onClick={() => {
                      setDeleteTarget(r);
                      setConfirmOpen(true);
                    }}
                  >
                    <TrashIcon className="size-4" />
                  </IconButton>
                </div>
              );
            })}

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete this resume?</DialogTitle>
                  <DialogDescription>
                    <span className="text-ink font-medium wrap-anywhere">
                      {deleteTarget?.original_filename ?? "This resume"}
                    </span>{" "}
                    will be removed from your profile, and this can&apos;t be undone.
                  </DialogDescription>
                </DialogHeader>

                <DialogFooter>
                  <DialogClose render={<Button variant="secondary">Keep it</Button>} />
                  <Button variant="destructive" onClick={confirmRemove}>
                    Delete resume
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Card>

          {/* Add and Edit are the same control: ghost, icon, one word. "+ Add"
              was a plus typed into the label beside a pencil glyph on Edit,
              so the two section actions looked like they came from two
              different kits. */}
          <Card as="section" aria-labelledby="experience">
            <SectionHeading
              id="experience"
              action={
                <Button variant="ghost">
                  <PlusIcon className="size-3.5" />
                  Add
                </Button>
              }
            >
              Work Experience
            </SectionHeading>

            {/* One rail for the whole list, drawn by the <ol> from under the
                first dot (top-3) so no stub shows above it. A border on each
                <li> broke at every gap between roles. The meta line wraps
                between its parts, never inside "San Francisco, CA". */}
            <ol className="before:bg-border relative mt-4 flex flex-col gap-5 before:absolute before:top-3 before:bottom-1 before:left-0 before:w-0.5 before:content-['']">
              {ROLES.map((role) => (
                <li key={role.company} className="relative pl-5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1.5 -left-1 size-2.5 rounded-full",
                      role.current ? "bg-brand" : "bg-ink-faint",
                    )}
                  />
                  <h3 className="text-subtitle text-ink">{role.title}</h3>
                  <p className="text-note text-ink-meta mt-0.5 flex flex-wrap gap-x-1.5">
                    <span className="whitespace-nowrap">
                      <span className="text-ink-muted font-medium">{role.company}</span>
                      <span aria-hidden="true" className="text-ink-faint ml-1.5">
                        ·
                      </span>
                    </span>
                    <span className="whitespace-nowrap">
                      {role.period}
                      <span aria-hidden="true" className="text-ink-faint ml-1.5">
                        ·
                      </span>
                    </span>
                    <span className="whitespace-nowrap">{role.location}</span>
                  </p>
                  <p className="text-body text-ink-muted mt-1.5">{role.summary}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card as="section" aria-labelledby="skills">
            <SectionHeading
              id="skills"
              action={
                <Button variant="ghost">
                  <PencilIcon className="size-3" />
                  Edit
                </Button>
              }
            >
              Skills
            </SectionHeading>

            <ul className="mt-4 flex flex-wrap gap-1.5">
              {SKILLS.map((skill) => (
                <li
                  key={skill}
                  className="bg-brand-tint text-ink text-note rounded-full px-2.5 py-1"
                >
                  {skill}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card
          as="section"
          aria-labelledby="settings"
          className="@3xl/main:col-start-1 @3xl/main:row-start-2"
        >
          <SectionHeading id="settings">Application Settings</SectionHeading>

          <div className="mt-4 flex items-center justify-between gap-4">
            <label htmlFor="autofill" className="cursor-pointer">
              <span className="text-body text-ink block font-medium">Autofill Applications</span>
              <span className="text-note text-ink-meta block">
                Use profile data to pre-fill forms
              </span>
            </label>

            <input
              type="checkbox"
              role="switch"
              id="autofill"
              defaultChecked
              className="peer sr-only"
            />
            <label
              htmlFor="autofill"
              aria-hidden="true"
              className="bg-ink-faint peer-checked:bg-brand peer-focus-visible:ring-brand-ring relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-offset-2 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-4"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
