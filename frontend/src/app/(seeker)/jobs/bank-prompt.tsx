import { FileUp, MessageSquarePlus } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBank } from "@/lib/bank-actions";
import { listResumes } from "@/lib/resume-actions";

/**
 * The Jobs page's prompt to fill the experience bank (stories 22 and 102).
 * Matching reads the bank, never an uploaded resume, so an empty bank gets
 * this card above the feed: one click on "Import Your Resume" opens the bank
 * page and starts the import there (`/bank?import=1`), where the student
 * checks each draft. With no uploaded resume it offers the upload and
 * intake instead. A bank with entries, or a fetch that fails, shows nothing:
 * the prompt is a nudge, never an error.
 */
export async function BankPrompt() {
  const [bank, uploads] = await Promise.all([getBank(), listResumes()]);
  if (!bank.data || bank.data.entries.length > 0) return null;
  const hasUpload = uploads.resumes.some((r) => r.storage_path);

  return (
    <Card as="section" aria-labelledby="jobs-bank-prompt" className="mt-4">
      <h2 id="jobs-bank-prompt" className="text-subtitle text-ink">
        {hasUpload ? "Import Your Resume" : "Add Your Experiences"}
      </h2>
      <p className="text-body text-ink-meta mt-1">
        You have no experiences yet, so WorkIt cannot match roles to you.{" "}
        {hasUpload
          ? "Import your uploaded resume in one click: you check each entry before it is saved."
          : "Upload a resume to import, or tell WorkIt about one thing you did."}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {hasUpload ? (
          <ButtonLink href="/bank?import=1" size="sm">
            <FileUp /> Import Your Resume
          </ButtonLink>
        ) : (
          <ButtonLink href="/profile" size="sm">
            <FileUp /> Upload a Resume
          </ButtonLink>
        )}
        <ButtonLink href="/bank" variant="secondary" size="sm">
          <MessageSquarePlus /> Add What You Did
        </ButtonLink>
      </div>
    </Card>
  );
}
