"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { RadioRow } from "@/components/ui/radio-row";
import { TextField } from "@/components/ui/text-field";
import {
  createSection,
  renameSection,
  type CustomSection,
  type SectionLayout,
} from "@/lib/bank-actions";

import { SUGGESTED_SECTIONS } from "./sections";

/**
 * Sections the student names (KAN-498): Add Section's card and a section's
 * Rename. A section is Entries (each a title, organization, dates and
 * bullets, printed as a project is) or Lines (plain lines, printed with no
 * heading or dot), picked when it is made; the layout never changes, since
 * an entry's fields would not fit the other. The API holds the rules: five
 * sections per owner, one name per owner, never a fixed section's name.
 */

const LAYOUTS: readonly { value: SectionLayout; label: string; detail: string }[] = [
  {
    value: "entries",
    label: "Entries",
    detail: "each with a title, organization, dates and bullets, such as volunteer work",
  },
  {
    value: "lines",
    label: "Lines",
    detail: "plain lines with no heading, such as a summary or the languages you speak",
  },
];

/** The card Add Section opens, at the foot of the page's sections. A
 *  suggested name fills the name and the layout it usually takes; a Summary
 *  prints first on a resume. */
export function AddSection({
  resumeId,
  taken,
  onAdded,
  onCancel,
}: {
  /** The picked resume: an upload owns the section; a built resume's
   *  section is the student's own. */
  resumeId?: string;
  /** Names already in use under the pick, ignoring case. */
  taken: ReadonlySet<string>;
  onAdded: (section: CustomSection) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<SectionLayout>("entries");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = SUGGESTED_SECTIONS.filter((s) => !taken.has(s.name.toLowerCase()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createSection(name.trim(), layout, resumeId);
    setBusy(false);
    if (res.data) onAdded(res.data);
    else setError(res.error);
  }

  return (
    <Card as="section" aria-labelledby={`${uid}-heading`} className="scroll-mt-16">
      <h2 id={`${uid}-heading`} className="text-subtitle text-ink">
        Add a Section
      </h2>
      <form onSubmit={submit} className="mt-3 flex max-w-3xl flex-col gap-3">
        <TextField
          id={`${uid}-name`}
          label="Section Name"
          required
          maxLength={60}
          autoFocus
          placeholder="Volunteering"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {suggested.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Suggested names" role="group">
            {suggested.map((s) => (
              <Chip
                key={s.name}
                pressed={name === s.name}
                onClick={() => {
                  setName(s.name);
                  setLayout(s.layout);
                }}
              >
                {s.name}
              </Chip>
            ))}
          </div>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label text-ink mb-1 font-medium">How It Prints</legend>
          {LAYOUTS.map((option) => (
            <RadioRow
              key={option.value}
              name={`${uid}-layout`}
              value={option.value}
              checked={layout === option.value}
              onChange={() => setLayout(option.value)}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-ink-muted">: {option.detail}</span>
            </RadioRow>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-note text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Adding…" : "Add Section"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A section's new name, typed in its heading's place. */
export function RenameSection({
  section,
  onDone,
  onCancel,
}: {
  section: CustomSection;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [name, setName] = useState(section.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || name.trim() === section.name) return onCancel();
    setBusy(true);
    setError(null);
    const res = await renameSection(section.id, name.trim());
    setBusy(false);
    if (res.error) return setError(res.error);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-3xl flex-col gap-2">
      <TextField
        id={`${uid}-name`}
        label="Section Name"
        required
        maxLength={60}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-note text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save Name"}
        </Button>
      </div>
    </form>
  );
}
