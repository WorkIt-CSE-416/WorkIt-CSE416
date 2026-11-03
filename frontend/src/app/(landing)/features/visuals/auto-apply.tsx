import {
  CheckIcon,
  CursorClickIcon,
  FilePdfIcon,
  PaperclipIcon,
  PencilLineIcon,
  WarningIcon,
} from "@phosphor-icons/react/ssr";

import { LightningRoundedIcon } from "@/components/custom-icons";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/cn";

import { FaviconLogo } from "../../favicon-logo";
import { autoApplyFeature, followedJob, matchingFeature } from "../../feature-data";
import { Label, Score, Vignette } from "./parts";

/** The Auto Apply page's deep dives: Up Next's queue, then the tour's
 *  Greenhouse form (feature-data.ts) up close, then its foot, where the
 *  student clicks Submit. The extension fills; the student submits. */

const byId = new Map(
  autoApplyFeature.sections.flatMap((section) => section.fields).map((field) => [field.id, field]),
);
const field = (id: string) => byId.get(id)!;

/** Up Next's groups and statuses, in the app's words (queue-table.tsx). */
const QUEUE = [
  { group: "In Progress", job: matchingFeature.jobs[1], status: "Ready to Submit", tone: "ready" },
  { group: "In Progress", job: matchingFeature.jobs[3], status: "Filling", tone: "filling" },
  { group: "In Progress", job: matchingFeature.jobs[4], status: "Needs You", tone: "needs" },
  { group: "Queued", job: matchingFeature.jobs[0], status: "", tone: "" },
] as const;

const TONE = {
  ready: { ink: "text-positive-ink", Icon: CheckIcon },
  filling: { ink: "text-advanced", Icon: PencilLineIcon },
  needs: { ink: "text-warning", Icon: WarningIcon },
} as const;

/** Up Next: the jobs picked for Auto Apply, the ones being filled on top. */
export function QueueVisual() {
  return (
    <Vignette className="px-4">
      <div className="gloss-card rounded-2xl p-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-ink text-[13px] font-semibold">Up Next</p>
          <span className="bg-positive-ink inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white">
            <LightningRoundedIcon className="size-3" />
            Auto Apply
          </span>
        </div>
        <div className="mt-2 grid gap-1">
          {QUEUE.map(({ group: name, job, status, tone }, i) => {
            const heading = i === 0 || QUEUE[i - 1].group !== name;
            const look = tone ? TONE[tone] : null;
            return (
              <div key={job.id}>
                {heading && (
                  <Label className="mt-1.5 mb-1 px-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">{name}</span>
                  </Label>
                )}
                <div className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-900/5">
                  <FaviconLogo domain={job.domain} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate text-[11px] font-semibold">{job.title}</p>
                    <p className="text-ink-meta text-[10px]">{job.company}</p>
                  </div>
                  {look ? (
                    <span
                      className={cn(
                        "inline-flex w-24 items-center gap-1 text-[10px] font-semibold",
                        look.ink,
                      )}
                    >
                      <look.Icon className="size-3" />
                      {status}
                    </span>
                  ) : (
                    <span className="w-24" />
                  )}
                  <Score score={job.score} className="text-[10px]" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Vignette>
  );
}

/** One filled field, as the tour's form draws it. */
function Field({ id, className }: { id: string; className?: string }) {
  const { label, value } = field(id);
  return (
    <div className={className}>
      <p className="text-ink-muted text-[10px] font-medium">{label}</p>
      <p className="text-ink bg-positive-tint/50 ring-positive/30 mt-0.5 truncate rounded-md px-2 py-1 text-[11px] ring-1 ring-inset">
        {value}
      </p>
    </div>
  );
}

/** A company's own application window: its address bar and its form. */
function Window({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_48px_-24px_rgb(40_20_90/0.45)] ring-1 ring-slate-900/8">
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
        <span className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-2 rounded-full bg-slate-200" />
          ))}
        </span>
        <span className="text-ink-meta flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[10px] ring-1 ring-slate-900/5">
          {autoApplyFeature.url}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** The form filled from the student's profile and saved answers; a new
 *  written question is left for the student, since WorkIt drafts none. */
export function FillVisual() {
  return (
    <Vignette className="px-3">
      <Window>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field id="first" />
          <Field id="last" />
          <Field id="email" />
          <Field id="school" />
          <Field id="sponsorship" className="col-span-2" />
        </div>
        <div className="mt-2">
          <p className="text-ink-muted flex items-center justify-between text-[10px] font-medium">
            {field("why").label}
            <span className="text-warning inline-flex items-center gap-1 font-semibold">
              <WarningIcon className="size-3" />
              Needs You
            </span>
          </p>
          <p className="ring-warning-fill/60 mt-0.5 h-10 rounded-md px-2 py-1 ring-1 ring-inset" />
        </div>
      </Window>
    </Vignette>
  );
}

/** The WorkIt panel's resume row beside the form: the attached file, and
 *  Change to switch it (autofiller_extension/CLAUDE.md, the panel). */
export function AttachVisual() {
  return (
    <Vignette className="px-8">
      <div className="gloss-card rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Logo size="mark" decorative className="h-5" />
          <p className="text-ink text-[13px] font-semibold">Resume</p>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-900/8">
          <span className="bg-danger-tint text-danger grid size-9 shrink-0 place-items-center rounded-lg">
            <FilePdfIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-positive-ink text-[10px] font-semibold">
              Attached · Tailored for this job
            </p>
            <p className="text-ink truncate text-[12px] font-semibold">{field("resume").value}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="text-ink rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold ring-1 ring-slate-900/10">
            Change
          </span>
          <span className="text-ink rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold ring-1 ring-slate-900/10">
            Preview
          </span>
        </div>
      </div>
      <p className="text-ink-muted mt-4 flex items-center justify-center gap-1.5 text-[11px] font-semibold">
        <PaperclipIcon className="size-3.5" />
        {followedJob.company} · Resume/CV
      </p>
    </Vignette>
  );
}

/** The form's foot: every field filled, and the student's own click on
 *  the company's Submit button. */
export function SubmitVisual() {
  return (
    <Vignette className="px-6">
      <Window>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field id="gender" className="col-span-2" />
          <Field id="veteran" className="col-span-2" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-positive-ink inline-flex items-center gap-1 text-[11px] font-semibold">
            <CheckIcon className="size-3.5" />
            Ready to Submit
          </span>
          <span className="relative rounded-lg bg-slate-900 px-4 py-2 text-[12px] font-semibold text-white">
            Submit application
            <CursorClickIcon
              weight="fill"
              className="text-ink absolute -right-4 -bottom-5 size-7 drop-shadow-[0_1px_1px_white]"
            />
          </span>
        </div>
      </Window>
      <p className="text-ink-muted mt-5 text-center text-[11px] font-semibold">
        You read it over. You click Submit.
      </p>
    </Vignette>
  );
}
