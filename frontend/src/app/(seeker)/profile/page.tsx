"use client";

import { FileText, Phone } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { MailIcon, PdfIcon, PencilIcon, PinIcon, TrashIcon } from "@/components/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import { PROFILE } from "./data";
import { SectionAction } from "./section-action";
import { ResumeUpload } from "@/components/resume-upload";
import {
  uploadResume,
  deleteResume,
  getParsedResume,
  getResumeFileUrl,
  listResumes,
  parseResume,
  setPrimaryResume,
  updateParsedResume,
  type ParsedResume,
  type ResumeItem,
} from "@/lib/resume-actions";
import { EMPTY_RESUME, ResumeEditDialog, type SectionKey } from "./resume-edit-dialog";
import { RESUME_ROW, ResumeRow } from "./resume-row";
import { ExperienceSection, SkillsSection } from "./resume-sections";
import { getAvatar, removeAvatar, uploadAvatar } from "@/lib/avatar-actions";
import { AVATAR_MIME_TYPES, avatarFileError } from "@/lib/avatar-rules";
import { SEEKER_GUTTER } from "../gutter";
import { useProfileCache } from "../profile-cache";

/**
 * The profile screen. Resumes, the profile photo, and Work Experience/Skills
 * are live: the last two render one resume's parsed content (shownResume) and
 * save edits back to it. Name and contact details still render the fixture in
 * ./data. A return visit renders the last visit's data at once
 * (../profile-cache.tsx) and refetches it behind the scenes. The autofill
 * switch is a bare checkbox with role="switch" that styles its own on state.
 * The tab title is set in ./layout.tsx, because a client page cannot export
 * metadata.
 *
 * NOT FIVE WHITE CARDS. Every section used to be the same bordered box, and
 * the short left column stopped about 350px above the right one. It is laid
 * out the way the seeker Dashboard is now, each kind of thing on its own
 * surface:
 *
 *   identity        an open band under the title: the photo and its edit
 *                   control, the name and headline, the contact details as
 *                   one wrapping row, closed by a hairline
 *   Resume          the one card, because the dropzone and the file rows are
 *                   a surface to work on. It spans the page, so its height
 *                   (one row per resume, up to five) has no column beside it
 *                   to fall out of step with. Inside, the rows take the wide
 *                   track and the dropzone the narrow one
 *   the rest        open sections under plain headings: Work Experience in
 *                   the wide column, Skills and Application Settings in the
 *                   narrow one, which come out within a line of each other
 *
 * Each open section's actions sit at the top right of its heading, as a
 * Dashboard section's "View All" does (./section-action.tsx).
 *
 * A FAILED LOAD IS ONE NOTICE AT THE TOP, NOT A RED LINE PER CARD. The photo
 * and the resumes load separately, and each used to print its own "Could not
 * reach the server." in red under the thing it failed to load (under the
 * avatar, and under the dropzone), so a single outage read as two scattered
 * faults. Errors from something the seeker just did (an upload, a delete)
 * still show beside it, because that is where they are looking. An empty or
 * failed resume list holds the first row's place in grey rather than red, so
 * a list that did not load is not mistaken for one with nothing in it.
 */
const CONTACT = [
  { Icon: MailIcon, label: "Email", value: PROFILE.email },
  { Icon: Phone, label: "Phone", value: PROFILE.phone },
  { Icon: PinIcon, label: "Location", value: PROFILE.location },
];

const MAX_RESUMES = 5;

/** The resume Work Experience and Skills show: the primary one, else the newest. */
function shownResume(resumes: ResumeItem[]) {
  return resumes.find((r) => r.is_default) ?? resumes[0];
}

export default function ProfilePage() {
  // The last visit's data, if any, read once. A return visit renders it at
  // once, and the effects below refetch in the background.
  const cache = useProfileCache();
  const [cached] = useState(cache.read);

  // Resume items. `uploading` is the name of the file in flight, or null.
  const [resumeList, setResumeList] = useState<ResumeItem[]>(cached?.resumes ?? []);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(cached !== null);
  // A failed list hides the "2 of 5" count: "0 of 5" would say there are none.
  const [listFailed, setListFailed] = useState(false);
  // A parsed file waiting on the review dialog; nothing is saved until Save.
  const [pending, setPending] = useState<{ file: File; parsed: ParsedResume | null } | null>(null);
  // The shown resume's parsed content (shownResume), which Work Experience and
  // Skills show and edit. null when there is no resume.
  const [profile, setProfile] = useState<{ id: string; parsed: ParsedResume } | null>(
    cached?.shown ?? null,
  );
  // While the sections' content loads (the first time, or after a switch),
  // they say so rather than "Upload a resume", and keep their editors shut.
  const [profileLoading, setProfileLoading] = useState(cached === null);
  // Star and delete clicks that may move the sections to another resume,
  // still in flight. The editors stay shut from the click, not just from the
  // content load that follows: one opened in between saves onto the wrong
  // resume. A count, so a second quick switch is not unlocked by the first.
  const [switching, setSwitching] = useState(0);
  // The list and shown resume as last rendered, for code that carries on after
  // an await or runs from the mount effect: the values it closed over are the
  // ones from the render it started in.
  const latest = useRef({ resumeList, shownId: profile?.id });
  useEffect(() => {
    latest.current = { resumeList, shownId: profile?.id };
  });

  // The resume the delete dialog asks about. It outlives `confirmOpen` so the
  // filename does not vanish while the dialog fades out.
  const [deleteTarget, setDeleteTarget] = useState<ResumeItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  }, []);

  // Save each settled state for the next visit. Not mid-load, not while a
  // photo upload's blob: preview (revoked afterwards) is on screen, and not
  // after a failed load, which would show the next visit an empty profile.
  useEffect(() => {
    if (loaded && !profileLoading && !avatarBusy && !loadFailed) {
      cache.write({ resumes: resumeList, shown: profile, avatarUrl });
    }
  }, [cache, loaded, profileLoading, avatarBusy, loadFailed, resumeList, profile, avatarUrl]);

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

  async function loadProfile(resume: ResumeItem | undefined) {
    // While the sections switch to another resume, their editors stay shut:
    // one opened on the outgoing resume would save its entries onto this one.
    // A refresh of the same resume (a return visit) leaves them usable.
    if (resume?.id !== latest.current.shownId) setProfileLoading(true);
    try {
      if (!resume) {
        setProfile(null);
        return;
      }
      const { parsed, error } = await getParsedResume(resume.id);
      if (error) {
        setLoadFailed(true);
        // A failed switch must not leave the outgoing resume on screen, still
        // editable: after a delete, that is the resume that no longer exists.
        // A failed refresh of the same resume keeps what is shown.
        if (resume.id !== latest.current.shownId) setProfile(null);
        return;
      }
      // A resume that failed to parse can still be filled in by hand.
      setProfile({ id: resume.id, parsed: parsed ?? EMPTY_RESUME });
    } catch {
      setLoadFailed(true);
      if (resume && resume.id !== latest.current.shownId) setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  // Load the resumes — on a return visit, a background refresh of the cache.
  // A failed load keeps whatever a return visit already shows. No guard is
  // needed against this landing after a change made meanwhile: Next runs
  // server actions one at a time, so this one, dispatched first, always
  // finishes first, and the change's own update applies on top of it.
  useEffect(() => {
    function fail() {
      setLoadFailed(true);
      setListFailed(true);
      setProfileLoading(false);
    }
    listResumes()
      .then(({ resumes, error }) => {
        if (error) return fail();
        setResumeList(resumes);
        loadProfile(shownResume(resumes));
      })
      .catch(fail)
      .finally(() => setLoaded(true));
  }, []);

  // One entry added, edited or removed on the profile: replace that section
  // and save the whole parsed resume back.
  async function handleSectionChange(section: SectionKey, entries: object[]) {
    if (!profile) return "Upload a resume first.";
    const parsed = { ...profile.parsed, [section]: entries } as ParsedResume;
    const { error } = await updateParsedResume(profile.id, parsed);
    if (error) return error;
    setProfile({ id: profile.id, parsed });
    return null;
  }

  // Parses without saving: the review dialog opens on the result, and only its
  // Save uploads the file. `uploading` names the file while it is being read.
  async function handleResumeFileAdd(file: File) {
    if (!loaded || uploading !== null || pending) return;
    if (resumeList.length >= MAX_RESUMES) {
      setResumeError(`You can keep up to ${MAX_RESUMES} resumes. Remove one to add another.`);
      return;
    }
    setResumeError(null);
    setUploading(file.name);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const { parsed, error } = await parseResume(fd);
      if (error) {
        setResumeError(error);
        return;
      }
      setPending({ file, parsed });
    } catch {
      setResumeError("Could not read the resume. Refresh the page and try again.");
    } finally {
      setUploading(null);
    }
  }

  // Sends the file again with the applicant's edits; the API stores those
  // instead of re-parsing.
  async function handleReviewSave(edited: ParsedResume): Promise<string | null> {
    if (!pending) return null;
    const fd = new FormData();
    fd.append("file", pending.file);
    // Nothing read and nothing typed: let the API parse the file itself, so
    // the resume is marked parse_failed rather than "parsed".
    if (pending.parsed || Object.values(edited).some((entries) => entries.length > 0)) {
      fd.append("parsed_json", JSON.stringify(edited));
    }
    const { resume, error } = await uploadResume(fd);
    if (error) return error;
    if (resume) {
      // Functional updates throughout: another action may have changed the
      // list while this one was awaiting the server.
      setResumeList((prev) => [resume, ...prev]);
      // The sections switch to the new resume only when no primary outranks it.
      if (!resumeList.some((r) => r.is_default)) {
        setProfile({ id: resume.id, parsed: resume.parsed_json ?? edited });
      }
    }
    setPending(null);
    return null;
  }

  async function handleMakePrimary(resumeId: string) {
    setResumeError(null);
    setSwitching((n) => n + 1);
    try {
      const { error } = await setPrimaryResume(resumeId);
      if (error) {
        setResumeError(error);
        return;
      }
      setResumeList((prev) => prev.map((r) => ({ ...r, is_default: r.id === resumeId })));
      if (profile?.id !== resumeId) await loadProfile(resumeList.find((r) => r.id === resumeId));
    } catch {
      setResumeError("Could not update the resume. Refresh the page and try again.");
    } finally {
      setSwitching((n) => n - 1);
    }
  }

  async function handlePreview(resume: ResumeItem) {
    setResumeError(null);
    // A PDF opens in a new tab, and that tab is opened here, inside the click:
    // one opened after the await below is a popup, which browsers block. A
    // DOCX link downloads, so it needs no tab and leaves this page in place.
    const tab = resume.storage_path.endsWith(".pdf") ? window.open("", "_blank") : null;
    let url: string | null = null;
    let error: string | null = null;
    try {
      ({ url, error } = await getResumeFileUrl(resume.id));
    } catch {
      error = "Could not open the resume. Refresh the page and try again.";
    }
    if (!url) {
      tab?.close();
      setResumeError(error ?? "Could not open the resume.");
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else if (resume.storage_path.endsWith(".pdf")) {
      // The tab was blocked. Swapping the profile for the PDF would be worse.
      setResumeError(
        "Your browser blocked the preview tab. Allow pop-ups for this site, then try again.",
      );
    } else {
      window.location.assign(url);
    }
  }

  async function handleRemove(resumeId: string) {
    if (deletingId) return;
    setResumeError(null);
    setDeletingId(resumeId);
    const shownAtClick = latest.current.shownId;
    const movesSections = !shownAtClick || resumeId === shownAtClick;
    if (movesSections) setSwitching((n) => n + 1);
    try {
      const { error } = await deleteResume(resumeId);
      if (error) {
        setResumeError(error);
        return;
      }
      setResumeList((prev) => prev.filter((r) => r.id !== resumeId));
      // Also when nothing is shown yet: the first load has not landed, so the
      // deleted resume may be the one about to be.
      const { resumeList: current, shownId } = latest.current;
      if (!shownId || resumeId === shownId) {
        await loadProfile(shownResume(current.filter((r) => r.id !== resumeId)));
      }
    } catch {
      // The server action call itself failed
      // or the page came back from the back-forward cache with stale action IDs.
      setResumeError("Could not remove the resume. Refresh the page and try again.");
    } finally {
      if (movesSections) setSwitching((n) => n - 1);
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
            name={PROFILE.name}
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
            <SectionHeading id="identity">{PROFILE.name}</SectionHeading>
            {avatarUrl && !avatarBusy && (
              <SectionAction onClick={handleAvatarRemove}>
                <TrashIcon />
                Remove Photo
              </SectionAction>
            )}
          </div>
          <p className="text-body text-ink-meta">{PROFILE.title}</p>

          {/* One wrapping row: three short facts side by side on a desktop,
              stacking only as far as a phone's width makes them. Each label
              is for a screen reader; the glyph says it to the eye. */}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {CONTACT.map(({ Icon, label, value }) => (
              <div key={label} className="flex max-w-full min-w-0 items-center gap-2">
                <dt className="contents">
                  <Icon className="text-ink-meta size-4 shrink-0" />
                  <span className="sr-only">{label}</span>
                </dt>
                <dd className="text-body text-ink-muted truncate">{value}</dd>
              </div>
            ))}
          </dl>

          {avatarError && (
            <p role="alert" className="text-meta text-danger mt-2">
              {avatarError}
            </p>
          )}
        </div>
      </section>

      {/* From @4xl the card splits the way the page below it does: the list
          in the wide track, the dropzone in a narrow one whose left edge
          lines up with the Skills column. That column is a third of the page
          after the 40px gap, and the card's inside is 38px narrower than the
          page (18px padding and a 1px border each side), hence the calc.
          Below @4xl the dropzone stacks under the heading, where a third of
          the card wrapped every line in it. Grid placement does the moving;
          the DOM stays heading, dropzone, list, so a phone still meets the
          dropzone before the rows. */}
      <Card
        as="section"
        aria-labelledby="resume"
        className="mt-8 grid grid-cols-1 @4xl/main:grid-cols-[minmax(0,1fr)_calc((100%_-_2px)/3_-_19px)] @4xl/main:grid-rows-[auto_1fr] @4xl/main:gap-x-10"
      >
        <div>
          <SectionHeading
            id="resume"
            action={
              loaded && !listFailed ? (
                <Badge variant="tag" pill>
                  {resumeList.length} of {MAX_RESUMES}
                </Badge>
              ) : undefined
            }
          >
            Resume
          </SectionHeading>
          <p className="text-body text-ink-meta mt-1">
            Keep a version for each kind of role you apply to, up to {MAX_RESUMES}.
          </p>
        </div>

        <div className="mt-4 @4xl/main:col-start-2 @4xl/main:row-span-2 @4xl/main:row-start-1 @4xl/main:mt-0">
          <ResumeUpload
            file={null}
            onFileChange={handleResumeFileAdd}
            onRemove={() => {}}
            busy={uploading !== null}
          />
          {resumeError && (
            <p role="alert" className="text-meta text-danger mt-2">
              {resumeError}
            </p>
          )}
          {pending && (
            <ResumeEditDialog
              title="Review Your Resume"
              description={
                pending.parsed
                  ? `Check what we read from ${pending.file.name} and fix anything we got wrong before saving.`
                  : `We couldn't read any sections from ${pending.file.name}. Add them below, or save it as is.`
              }
              parsed={pending.parsed}
              saveLabel="Save Resume"
              onSave={handleReviewSave}
              onCancel={() => setPending(null)}
            />
          )}
        </div>

        <div className="@4xl/main:mt-2">
          {!loaded && (
            <div aria-hidden="true" className="bg-well rounded-control mt-2 h-13 animate-pulse" />
          )}
          {/* Nothing to list holds the first row's place, in grey: one box,
              not a red line, and the first upload lands exactly where it
              stood. A failed list says so here too, since a blank box would
              read as "no resumes"; the notice at the top stays the alert. */}
          {loaded && uploading === null && resumeList.length === 0 && (
            <div className={RESUME_ROW}>
              <FileText aria-hidden className="text-ink-faint size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink-muted truncate">
                  {listFailed ? "Your resumes didn't load" : "No resumes yet"}
                </p>
                <p className="text-note text-ink-meta">
                  {listFailed
                    ? "Refresh the page to see them here."
                    : "Each upload is listed here, newest first."}
                </p>
              </div>
            </div>
          )}
          {uploading !== null && (
            <div className={RESUME_ROW}>
              <PdfIcon className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink truncate">{uploading}</p>
                <p className="text-note text-ink-meta">Reading…</p>
              </div>
            </div>
          )}
          {resumeList.map((r) => (
            <ResumeRow
              key={r.id}
              resume={r}
              deleting={deletingId === r.id}
              onPreview={() => handlePreview(r)}
              onMakePrimary={() => handleMakePrimary(r.id)}
              onDelete={() => {
                setDeleteTarget(r);
                setConfirmOpen(true);
              }}
            />
          ))}
        </div>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-subtitle font-semibold">Delete This Resume?</DialogTitle>
              <DialogDescription>
                <span className="text-ink font-medium wrap-anywhere">
                  {deleteTarget?.original_filename ?? "This resume"}
                </span>{" "}
                will be removed from your profile, and this can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <DialogClose render={<Button variant="secondary">Keep It</Button>} />
              <Button variant="destructive" onClick={confirmRemove}>
                Delete Resume
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>

      {/* Settings comes last in the DOM, so a phone reaches it after Resume,
          Experience and Skills. Both tracks have a zero minimum, so a long
          line truncates instead of widening its column past the screen.

          Both sections are keyed by the shown resume: a switch the page did
          not start (a background refresh, after another tab changed the
          primary) remounts them, which closes an editor still open on the
          outgoing resume rather than letting it save onto the incoming one.
          With no content and resumes on the list, the content failed to
          load, so the sections say so instead of "Upload a resume". */}
      <div className="mt-10 grid grid-cols-1 items-start gap-10 @3xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ExperienceSection
          key={profile?.id}
          parsed={profile?.parsed ?? null}
          loading={profileLoading || switching > 0}
          failed={listFailed || resumeList.length > 0}
          onChange={handleSectionChange}
        />

        <div className="flex flex-col gap-10">
          <SkillsSection
            key={profile?.id}
            parsed={profile?.parsed ?? null}
            loading={profileLoading || switching > 0}
            failed={listFailed || resumeList.length > 0}
            onChange={handleSectionChange}
          />

          <section aria-labelledby="settings">
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
              {/* The thumb glides across on the app's glide while the track
                  fades to brand, and it pinches in a little while pressed,
                  so the switch answers the finger before it moves. */}
              <label
                htmlFor="autofill"
                aria-hidden="true"
                className="bg-ink-faint peer-checked:bg-brand peer-focus-visible:ring-brand-ring after:ease-glide relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 peer-focus-visible:ring-[3px] peer-focus-visible:ring-offset-2 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgb(18_26_40/0.2)] after:transition-transform after:duration-200 after:content-[''] peer-checked:after:translate-x-4 active:after:scale-90"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
