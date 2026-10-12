"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FileText } from "lucide-react";

import { PencilIcon, PlusIcon, SparkleIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { ResumePreview } from "@/components/resume-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/section-heading";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import {
  deleteEntry,
  generateResume,
  importResume,
  type Bank,
  type Entry,
  type Section,
} from "@/lib/experience-actions";
import type { ResumeItem } from "@/lib/resume-actions";

import { EntryEditor } from "./entry-editor";
import { IntakeDialog } from "./intake-dialog";
import { SECTION_INFO, detailLine, span } from "./sections";
import { SkillsEditor } from "./skills-editor";

/**
 * The Resume Builder's working half (the page is ./page.tsx). Left, the
 * Experience Bank by section, each entry ticked to go on the resume; right,
 * the build panel. Every change goes to the API and then `router.refresh()`
 * draws the page again from the server, so what is shown is always what is
 * saved. What is left off is kept as `excluded` rather than what is on, so an
 * entry added since is on the next resume without a click.
 */

const TEMPLATES = [{ value: "jakes", label: "Jake's Resume" }];

type Built = { id: string; name: string; pages: number };

export function Builder({ bank, resumes }: { bank: Bank; resumes: ResumeItem[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ entry: Entry | null; section?: Section } | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importFrom, setImportFrom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState("jakes");
  const [name, setName] = useState("Resume");
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<Built | null>(null);

  const refresh = () => startRefresh(() => router.refresh());
  const chosen = bank.entries.filter((e) => !excluded.has(e.id));
  // An upload with details is what can be imported; a built resume came from
  // the bank to begin with
  const importable = resumes.filter((r) => !r.template_key && r.status === "parsed");

  function toggle(id: string) {
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    setError(null);
    const { error: err } = await deleteEntry(id);
    setConfirmDelete(null);
    if (err != null) setError(err);
    else refresh();
  }

  async function handleImport() {
    if (!importFrom) return;
    setError(null);
    setMessage(null);
    const { data, error: err } = await importResume(importFrom);
    if (err != null) {
      setError(err);
      return;
    }
    setMessage(
      `Added ${data.added_entries} ${data.added_entries === 1 ? "entry" : "entries"} and ${data.added_skills} ${data.added_skills === 1 ? "skill" : "skills"}. Remove any you already had.`,
    );
    refresh();
  }

  async function handleGenerate() {
    setBuilding(true);
    setError(null);
    const { data, error: err } = await generateResume(
      chosen.map((e) => e.id),
      name.trim() || "Resume",
      template,
    );
    setBuilding(false);
    if (err != null) setError(err);
    else setBuilt({ id: data.id, name: data.original_filename, pages: data.pages });
  }

  const empty = bank.entries.length === 0 && bank.skills.length === 0;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setIntakeOpen(true)}>
          <SparkleIcon className="size-4" />
          Describe Your Experience
        </Button>
        <Button variant="secondary" onClick={() => setEditing({ entry: null })}>
          <PlusIcon className="size-4" />
          Add Entry
        </Button>
        {importable.length > 0 && (
          <div className="flex items-end gap-2">
            <SelectField
              id="import-from"
              label="Import From a Resume"
              hideLabel
              value={importFrom}
              onValueChange={setImportFrom}
              placeholder="Import from a resume…"
              options={importable.map((r) => ({
                value: r.id,
                label: r.original_filename ?? "Resume",
              }))}
              className="w-56"
            />
            <Button variant="secondary" onClick={handleImport} disabled={!importFrom}>
              <UploadIcon className="size-4" />
              Import
            </Button>
          </div>
        )}
      </div>

      {(message || error) && (
        <p
          role={error ? "alert" : "status"}
          className={cn("text-label mt-3", error ? "text-danger" : "text-positive-ink")}
        >
          {error ?? message}
        </p>
      )}

      <div
        className={cn(
          "mt-6 grid gap-8 @4xl/main:grid-cols-[minmax(0,1fr)_24rem]",
          refreshing && "opacity-70 transition-opacity",
        )}
      >
        <div className="flex min-w-0 flex-col gap-8">
          {empty && (
            <EmptyState Icon={FileText} title="Your Experience Bank Is Empty">
              Describe what you&apos;ve done in your own words, add entries one at a time, or import
              a resume you&apos;ve uploaded. Clubs, volunteering and side projects count.
            </EmptyState>
          )}

          {SECTION_INFO.map((info) => {
            const entries = bank.entries.filter((e) => e.section === info.key);
            if (entries.length === 0) return null;
            return (
              <section key={info.key} aria-labelledby={`bank-${info.key}`}>
                <SectionHeading
                  id={`bank-${info.key}`}
                  action={
                    <Button
                      variant="section"
                      onClick={() => setEditing({ entry: null, section: info.key })}
                      aria-label={`Add ${info.noun}`}
                    >
                      <PlusIcon className="size-3.5" />
                      Add
                    </Button>
                  }
                >
                  {info.title}
                </SectionHeading>
                <ul className="mt-3 flex flex-col gap-2">
                  {entries.map((entry) => {
                    const on = !excluded.has(entry.id);
                    const when = span(entry.start_date, entry.end_date);
                    return (
                      <li
                        key={entry.id}
                        className={cn(
                          "border-border-subtle rounded-control flex gap-3 border p-3 transition-opacity",
                          !on && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(entry.id)}
                          aria-label={`Put ${entry.title} on the resume`}
                          className="accent-brand mt-1 size-4 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="text-body text-ink font-medium">
                              {entry.title}
                              {entry.organization && (
                                <span className="text-ink-muted font-normal">
                                  {" "}
                                  · {entry.organization}
                                </span>
                              )}
                            </p>
                            {(when || entry.location) && (
                              <p className="text-meta text-ink-meta">
                                {[when, entry.location].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>
                          {detailLine(entry) && (
                            <p className="text-note text-ink-meta mt-0.5">{detailLine(entry)}</p>
                          )}
                          {entry.bullets.length > 0 && (
                            <ul className="text-note text-ink-muted mt-1 list-disc pl-4">
                              {entry.bullets.map((b, i) => (
                                <li key={i}>{b}</li>
                              ))}
                            </ul>
                          )}
                          {confirmDelete === entry.id ? (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-label text-ink-muted">Delete this entry?</span>
                              <Button
                                size="xs"
                                variant="destructive"
                                onClick={() => handleDelete(entry.id)}
                              >
                                Delete
                              </Button>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-2 flex gap-3">
                              <Button variant="section" onClick={() => setEditing({ entry })}>
                                <PencilIcon className="size-3.5" />
                                Edit
                              </Button>
                              <Button variant="section" onClick={() => setConfirmDelete(entry.id)}>
                                <TrashIcon className="size-3.5" />
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {!empty && (
            <section aria-labelledby="bank-skills">
              <SectionHeading
                id="bank-skills"
                action={
                  <Button variant="section" onClick={() => setSkillsOpen(true)}>
                    <PencilIcon className="size-3.5" />
                    Edit
                  </Button>
                }
              >
                Technical Skills
              </SectionHeading>
              {bank.skills.length ? (
                <p className="text-body text-ink-muted mt-3">
                  {bank.skills.map((s) => s.name).join(", ")}
                </p>
              ) : (
                <p className="text-body text-ink-meta mt-3">No skills yet.</p>
              )}
            </section>
          )}
        </div>

        <Card
          as="section"
          aria-labelledby="build-heading"
          padding="lg"
          className="flex h-fit flex-col gap-4 @4xl/main:sticky @4xl/main:top-6"
        >
          <SectionHeading id="build-heading">Build a Resume</SectionHeading>
          <SelectField
            id="build-template"
            label="Template"
            value={template}
            onValueChange={setTemplate}
            options={TEMPLATES}
          />
          <TextField
            id="build-name"
            label="Resume Name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-meta text-ink-meta">
            {chosen.length} of {bank.entries.length} entries and every skill. Untick an entry to
            leave it off this one.
          </p>
          <Button onClick={handleGenerate} disabled={building || chosen.length === 0} size="lg">
            {building ? "Building…" : "Generate Resume"}
          </Button>
          {built && <ResumePreview key={built.id} {...built} />}
        </Card>
      </div>

      {editing && (
        <EntryEditor
          key={editing.entry?.id ?? `new-${editing.section ?? ""}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          entry={editing.entry}
          id={editing.entry?.id}
          section={editing.section}
          onSaved={refresh}
        />
      )}
      {intakeOpen && <IntakeDialog open onOpenChange={setIntakeOpen} onAdded={refresh} />}
      {skillsOpen && (
        <SkillsEditor open onOpenChange={setSkillsOpen} skills={bank.skills} onSaved={refresh} />
      )}
    </>
  );
}
