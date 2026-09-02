import type { Metadata } from "next";

import { MailIcon, PencilIcon, PinIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/cn";

import { Avatar } from "@/components/avatar";
import { PROFILE, RESUME, ROLES, SKILLS } from "./data";
import { EyeIcon, PdfIcon, PhoneIcon, TrashIcon, UploadIcon } from "./icons";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your resume, work history, and skills.",
};

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

            <div className="border-border-strong bg-well rounded-control mt-4.5 flex flex-col items-center border border-dashed px-4 py-7">
              <UploadIcon className="text-ink-meta h-6 w-5" />
              <p className="text-note text-ink mt-2.5 font-medium">
                Drag and drop your resume here
              </p>
              <p className="text-meta text-ink-meta mt-1.5">
                Supported formats: PDF, DOCX (Max 5MB)
              </p>
              <Button variant="outline" className="mt-2">
                Browse Files
              </Button>
            </div>

            <div className="border-border-subtle bg-app rounded-control mt-5 flex items-center gap-3 border p-2">
              <PdfIcon className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink truncate">{RESUME.fileName}</p>
                <p className="text-meta text-ink-meta">{RESUME.meta}</p>
              </div>
              <IconButton label="Preview resume">
                <EyeIcon className="size-4" />
              </IconButton>
              <IconButton label="Delete resume">
                <TrashIcon className="size-4" />
              </IconButton>
            </div>
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
