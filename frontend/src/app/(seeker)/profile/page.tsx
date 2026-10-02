"use client";

import { useEffect, useState } from "react";

import { MailIcon, PdfIcon, PencilIcon, PinIcon, TrashIcon } from "@/components/icons";
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

/**
 * KAN-43 renders the profile mockup only, against the fixtures in ./data.
 * Nothing here reads or writes yet, so the resume dropzone, the two edit
 * affordances and the row actions are inert on purpose. The autofill switch is
 * the exception — a bare checkbox styles its own on state, so it works without
 * pulling the card into a client component.
 */
const CONTACT = [
  { Icon: MailIcon, label: "Email", value: PROFILE.email },
  { Icon: PhoneIcon, label: "Phone", value: PROFILE.phone },
  { Icon: PinIcon, label: "Location", value: PROFILE.location },
];

export default function ProfilePage() {
  // Resume items
  const [resumeList, setResumeList] = useState<ResumeItem[]>([]);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load the resumes initially
  useEffect(() => {
    listResumes().then(({ resumes, error }) => {
      setResumeList(resumes);
      if (error) setResumeError(error);
      setLoaded(true);
    });
  }, []);

  async function handleResumeFileAdd(file: File) {
    if (!loaded || uploading) return;
    if (resumeList.length >= 5) {
      setResumeError("Max limit for resume reached. Remove one to upload another.");
      return;
    }
    setResumeError(null);
    setUploading(true);

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
      setUploading(false);
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

  return (
    <main className="max-w-app mx-auto w-full flex-1 px-12 py-4.5">
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-5">
          <Card as="section" aria-labelledby="identity">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <Avatar name={PROFILE.name} className="size-29 text-3xl" />
                <IconButton
                  label="Change profile photo"
                  variant="brand"
                  className="absolute right-1 bottom-1"
                >
                  <PencilIcon className="size-3" />
                </IconButton>
              </div>

              <SectionHeading as="h1" id="identity">
                {PROFILE.name}
              </SectionHeading>
              <p className="text-label text-ink-meta mt-0.5 font-normal">{PROFILE.title}</p>
            </div>

            <dl className="mt-5 flex flex-col gap-0.5">
              {CONTACT.map(({ Icon, label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <dt className="contents">
                    <Icon className="text-ink-meta size-3.5 shrink-0" />
                    <span className="sr-only">{label}</span>
                  </dt>
                  <dd className="text-label text-ink-meta truncate font-normal">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card as="section" aria-labelledby="settings">
            <SectionHeading id="settings">Application Settings</SectionHeading>

            <div className="mt-1.5 flex items-center justify-between gap-4">
              <label htmlFor="autofill" className="cursor-pointer">
                <span className="text-label text-ink block">Autofill Applications</span>
                <span className="text-meta text-ink-meta block">
                  Use profile data to pre-fill forms
                </span>
              </label>

              <input type="checkbox" id="autofill" defaultChecked className="peer sr-only" />
              <label
                htmlFor="autofill"
                aria-hidden="true"
                className="bg-border-strong peer-checked:bg-brand peer-focus-visible:ring-brand-ring relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors peer-focus-visible:ring-[3px] after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-4"
              />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card as="section" aria-labelledby="resume">
            <SectionHeading id="resume">Resume</SectionHeading>

            <div className="mt-4.5">
              <ResumeUpload file={null} onFileChange={handleResumeFileAdd} onRemove={() => {}} />
            </div>
            {resumeError && <p className="text-meta mt-2 text-red-600">{resumeError}</p>}
              {resumeList.map((r) => (
                <div
                  key={r.id}
                  className="border-border-subtle bg-app rounded-control mt-2 flex items-center gap-3 border p-2"
                >
                  <PdfIcon className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-ink truncate">{r.original_filename ?? "Resume"}</p>
                    <p className="text-meta text-ink-meta">{r.status}</p>
                  </div>
                  <IconButton label="Delete resume" disabled={deletingId !== null} onClick={() => handleRemove(r.id)}>
                    <TrashIcon className="size-4" />
                  </IconButton>
                </div>
              ))}
          </Card>

          <Card as="section" aria-labelledby="experience">
            <SectionHeading id="experience" action={<Button variant="ghost">+ Add</Button>}>
              Work Experience
            </SectionHeading>

            <ol className="mt-4.5 flex flex-col gap-4">
              {ROLES.map((role) => (
                <li key={role.company} className="border-border relative border-l-2 pl-5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1 -left-1.5 size-2.5 rounded-full",
                      role.current ? "bg-brand" : "bg-border-strong",
                    )}
                  />
                  <h3 className="text-subtitle text-ink">{role.title}</h3>
                  <p className="text-note text-brand mt-0.5 font-medium">{role.company}</p>
                  <p className="text-meta text-ink-meta mt-0.5">
                    {role.period} • {role.location}
                  </p>
                  <p className="text-label text-ink-muted mt-0.5 leading-5 font-normal">
                    {role.summary}
                  </p>
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

            <ul className="mt-2 flex flex-wrap gap-1.5">
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
      </div>
    </main>
  );
}
