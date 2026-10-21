import * as React from "react";
import Image from "next/image";
import {
  AnimatePresence,
  animate,
  motion,
  type HTMLMotionProps,
  useMotionValue,
  useTransform,
} from "motion/react";
import {
  Award,
  Briefcase,
  Check,
  Code,
  FolderGit2,
  GraduationCap,
  MousePointer2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { SparkleIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import { candidate, resumeFeature, type BankEntry, type ResumeSuggestion } from "./feature-data";
import { scoreTone } from "./score-tone";
import { GLIDE, Story, type StoryScene } from "./story";

/**
 * The Resumes stop: one short story that loops, a scene at a time. Loose
 * entries from a student's experience bank gather into one pile; a template
 * is picked (Jake's); the resume writes itself in Jake's look; then a job
 * posting arrives and the same page is tailored to it, its match rising.
 * The timing, step bar and reduced motion are the shared Story's
 * (story.tsx); with reduced motion it holds the finished, tailored resume.
 */

const SCENES = [
  {
    id: "bank",
    label: "Experience",
    caption: "Everything you've done, in one experience bank",
    hold: 3800,
  },
  { id: "template", label: "Template", caption: "Pick a template", hold: 3200 },
  {
    id: "generate",
    label: "Generate",
    caption: "WorkIt writes the resume from your bank",
    hold: 4200,
  },
  {
    id: "tailor",
    label: "Tailor",
    caption: "Tailor it, or a resume you upload, to each job",
    hold: 7800,
  },
] as const satisfies readonly StoryScene<string>[];

export default function ResumeVisual() {
  return (
    <Story
      label="Resume steps"
      scenes={SCENES}
      rest="tailor"
      accent="bg-advanced/50"
      stageHeight={480}
    >
      {(scene) => (
        // Generate and Tailor share one key, so tailoring changes the page
        // in place rather than swapping it.
        <AnimatePresence mode="wait">
          {scene === "bank" && <BankScene key="bank" />}
          {scene === "template" && <TemplateScene key="template" />}
          {(scene === "generate" || scene === "tailor") && (
            <ResumeScene key="resume" tailored={scene === "tailor"} />
          )}
        </AnimatePresence>
      )}
    </Story>
  );
}

// --- Scene 1: the jumble, gathering into the bank ---

const SECTION_ICON: Record<BankEntry["section"], LucideIcon> = {
  Education: GraduationCap,
  Experience: Briefcase,
  Projects: FolderGit2,
  Leadership: Users,
  Awards: Award,
  Skills: Code,
};

/** A bank card's width; the pile sits centred on the stage. */
const CARD_W = 184;

function BankScene() {
  const ref = React.useRef<HTMLDivElement>(null);
  // The stage's size, for the offsets from each card's spot to the pile.
  const [size, setSize] = React.useState({ w: 520, h: 480 });
  const [gathered, setGathered] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, []);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setGathered(true), 2200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <motion.div
      ref={ref}
      className="absolute inset-0"
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
    >
      {resumeFeature.bank.map((entry, i) => {
        const Icon = SECTION_ICON[entry.section];
        const left = (entry.x / 100) * size.w;
        const top = (entry.y / 100) * size.h;
        // Into one neat pile in the middle, each a little lower.
        const pile = { x: size.w / 2 - CARD_W / 2 - left, y: size.h * 0.3 + i * 9 - top };
        return (
          <motion.div
            key={entry.id}
            className="absolute flex items-center gap-2 rounded-xl bg-white p-2 shadow-[0_10px_24px_-14px_rgb(16_48_94/0.5)] ring-1 ring-slate-900/5"
            style={{ left, top, width: CARD_W, zIndex: i }}
            initial={{ opacity: 0, scale: 0.85, x: 0, y: 8, rotate: 0 }}
            animate={
              gathered
                ? { opacity: 1, scale: 1, x: pile.x, y: pile.y, rotate: 0 }
                : { opacity: 1, scale: 1, x: 0, y: 0, rotate: entry.tilt }
            }
            transition={{
              duration: gathered ? 0.6 : 0.45,
              ease: GLIDE,
              delay: gathered ? i * 0.04 : i * 0.08,
            }}
          >
            <span className="bg-advanced-tint text-advanced grid size-7 shrink-0 place-items-center rounded-lg">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="text-ink block truncate text-[11px] font-semibold">
                {entry.title}
              </span>
              <span className="text-ink-meta block truncate text-[10px]">{entry.detail}</span>
            </span>
          </motion.div>
        );
      })}

      {/* Once gathered, the pile is named. */}
      <AnimatePresence>
        {gathered && (
          <motion.p
            className="text-advanced absolute inset-x-0 text-center text-[11px] font-semibold"
            style={{ top: size.h * 0.3 + resumeFeature.bank.length * 9 + 56 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.3 }}
          >
            Experience bank · {resumeFeature.bank.length} entries
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// --- Scene 2: picking a template ---

function TemplateScene() {
  const [picked, setPicked] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setPicked(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center gap-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: GLIDE }}
    >
      {resumeFeature.templates.map((template, i) => {
        const chosen = template.id === "jakes";
        return (
          <motion.div
            key={template.id}
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 14 }}
            animate={{
              opacity: picked && !chosen ? 0.4 : 1,
              y: 0,
              scale: picked && chosen ? 1.06 : 1,
            }}
            transition={{ delay: picked ? 0 : 0.1 + i * 0.08, duration: 0.35, ease: GLIDE }}
          >
            <div
              className={cn(
                "relative h-[150px] w-[112px] rounded-lg bg-white p-2.5 shadow-[0_12px_28px_-16px_rgb(16_48_94/0.55)] ring-1 transition-[box-shadow,--tw-ring-color] duration-300",
                picked && chosen ? "ring-advanced ring-2" : "ring-slate-900/5",
              )}
            >
              <TemplateSketch id={template.id} />
              <AnimatePresence>
                {picked && chosen && (
                  <motion.span
                    className="bg-advanced absolute -top-2 -right-2 grid size-5 place-items-center rounded-full text-white shadow"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 24 }}
                  >
                    <Check className="size-3" aria-hidden="true" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <span className="text-ink text-[11px] font-medium">{template.label}</span>
          </motion.div>
        );
      })}

      {/* The pointer glides onto Jake's and clicks. */}
      <motion.span
        aria-hidden="true"
        className="text-ink absolute"
        initial={{ left: "78%", top: "82%", opacity: 0 }}
        animate={{ left: "24%", top: "47%", opacity: 1, scale: picked ? [1, 0.85, 1] : 1 }}
        transition={{
          left: { duration: 0.9, ease: GLIDE, delay: 0.5 },
          top: { duration: 0.9, ease: GLIDE, delay: 0.5 },
          opacity: { duration: 0.2, delay: 0.5 },
          scale: { duration: 0.25 },
        }}
      >
        <MousePointer2 className="size-5 fill-white drop-shadow" />
      </motion.span>
    </motion.div>
  );
}

/** A thumbnail of a template's layout, drawn with bars. */
function TemplateSketch({ id }: { id: string }) {
  const bar = (w: string, extra = "") => (
    <span className={cn("block h-[3px] rounded-full bg-slate-300", extra)} style={{ width: w }} />
  );
  if (id === "jakes") {
    // Centred name, small-caps headings over a rule, entries with dates.
    return (
      <div className="flex flex-col gap-1">
        <span className="mx-auto mb-0.5 block h-[5px] w-1/2 rounded-full bg-slate-500" />
        {bar("70%", "mx-auto bg-slate-200")}
        {[0, 1, 2].map((k) => (
          <div key={k} className="mt-1 flex flex-col gap-[3px]">
            <span className="block h-[3px] w-1/3 rounded-full bg-slate-500" />
            <span className="block h-px w-full bg-slate-400" />
            <div className="flex justify-between">
              {bar("45%", "bg-slate-400")}
              {bar("20%")}
            </div>
            {bar("85%", "bg-slate-200")}
            {bar("75%", "bg-slate-200")}
          </div>
        ))}
      </div>
    );
  }
  if (id === "modern") {
    // A coloured side column.
    return (
      <div className="flex h-full gap-1.5">
        <div className="bg-advanced-tint flex w-1/3 flex-col gap-1 rounded p-1">
          <span className="bg-advanced/40 mx-auto size-4 rounded-full" />
          {bar("90%", "bg-advanced/30")}
          {bar("70%", "bg-advanced/30")}
          {bar("80%", "bg-advanced/30")}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="block h-[5px] w-3/4 rounded-full bg-slate-500" />
          {[0, 1, 2, 3, 4, 5, 6].map((k) => (
            <span key={k}>
              {bar(k % 3 === 0 ? "50%" : "90%", k % 3 === 0 ? "bg-slate-400" : "bg-slate-200")}
            </span>
          ))}
        </div>
      </div>
    );
  }
  // Compact: two columns under a left-aligned name.
  return (
    <div className="flex flex-col gap-1">
      <span className="block h-[5px] w-2/3 rounded-full bg-slate-500" />
      {bar("50%", "bg-slate-200")}
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        {[0, 1].map((col) => (
          <div key={col} className="flex flex-col gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((k) => (
              <span key={k}>
                {bar(k % 4 === 0 ? "60%" : "95%", k % 4 === 0 ? "bg-slate-400" : "bg-slate-200")}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Scenes 3 and 4: the resume, generated, then tailored ---

/** Jake's Resume is set in Latin Modern; the closest faces a browser has. */
const JAKES_FACE = '"Latin Modern Roman", "CMU Serif", "Computer Modern", Georgia, serif';

/** The page's width; the suggestions sit in the gutters either side. */
const PAPER_W = 320;

type Target = ResumeSuggestion["target"];

/** A suggestion's mark and colour, by kind. */
const KIND_TONE: Record<ResumeSuggestion["kind"], string> = {
  keep: "text-advanced",
  cut: "text-danger",
  rewrite: "text-landing-brand-700",
  add: "text-positive-ink",
};

/** About the tallest a suggestion card gets: a title and three lines. */
const CARD_H = 70;

/** One beat of the tailoring, in ms: a suggestion shows, then applies. */
const BEAT = 650;

function ResumeScene({ tailored }: { tailored: boolean }) {
  const { job, suggestions } = resumeFeature;

  // Tailoring steps through the suggestions: suggestion i shows at beat
  // 2i + 1 and applies at 2i + 2. Back to none when the page is only
  // generated (a click on Generate after Tailor), set during render.
  const [beat, setBeat] = React.useState(0);
  const [wasTailored, setWasTailored] = React.useState(tailored);
  if (tailored !== wasTailored) {
    setWasTailored(tailored);
    setBeat(0);
  }
  React.useEffect(() => {
    if (!tailored || beat >= suggestions.length * 2) return;
    const timer = window.setTimeout(() => setBeat((b) => b + 1), beat === 0 ? 900 : BEAT);
    return () => window.clearTimeout(timer);
  }, [tailored, beat, suggestions.length]);

  const shown = (i: number) => tailored && beat >= i * 2 + 1;
  const applied = (target: Target) => {
    const i = suggestions.findIndex((s) => s.target === target);
    return tailored && beat >= i * 2 + 2;
  };
  const match =
    job.before + suggestions.reduce((sum, s) => sum + (applied(s.target) ? s.points : 0), 0);

  // Where each changed line sits, so its suggestion can point at it.
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [tops, setTops] = React.useState<Partial<Record<Target, number>>>({});
  const [rowHeight, setRowHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !tailored) return;
    const next: Partial<Record<Target, number>> = {};
    row.querySelectorAll<HTMLElement>("[data-target]").forEach((el) => {
      next[el.dataset.target as Target] = el.offsetTop;
    });
    setTops(next);
    setRowHeight(row.offsetHeight);
  }, [tailored, beat]);

  // Each line is revealed in order, left to right, like it is being written.
  let line = 0;
  const reveal = (): Reveal => {
    const delay = 0.15 + line++ * 0.07;
    return {
      initial: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
      animate: { opacity: 1, clipPath: "inset(0 0% 0 0)" },
      transition: { delay, duration: 0.35, ease: GLIDE },
    };
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center gap-2.5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: GLIDE }}
    >
      {/* The status slot: generating, then the job it is tailored to. */}
      <div className="relative h-11 shrink-0" style={{ width: PAPER_W }}>
        <AnimatePresence mode="wait" initial={false}>
          {tailored ? (
            <motion.div
              key="job"
              className="absolute inset-0 flex items-center gap-2.5 rounded-xl bg-white/90 px-2.5 shadow-sm ring-1 ring-slate-900/5"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: GLIDE }}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white ring-1 ring-slate-900/5">
                <Image
                  src={`https://www.google.com/s2/favicons?domain=${job.domain}&sz=64`}
                  alt=""
                  width={18}
                  height={18}
                  className="size-[18px] rounded-[4px]"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[11px] font-semibold">
                  {job.title}
                </span>
                <span className="text-ink-meta block text-[10px]">
                  {job.company} · wants {job.keywords.join(", ")}
                </span>
              </span>
              <MatchChip value={match} />
            </motion.div>
          ) : (
            <motion.div
              key="status"
              className="text-ink-meta absolute inset-0 flex items-center justify-center gap-2 text-[11px] font-medium"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <motion.span
                className="bg-advanced size-1.5 rounded-full"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
              Generating with Jake&rsquo;s Resume
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The page with a gutter either side for the suggestions. */}
      <div ref={rowRef} className="relative flex w-full justify-center">
        {/* The page, in Jake's look: centred name, small-caps headings over
            a rule, bold entries with dates, tight bullets. Sized to its
            content, so nothing is squeezed at the bottom. */}
        <div
          className="rounded-md bg-white px-4 py-4 text-[9px] leading-[1.4] text-slate-900 shadow-[0_18px_40px_-22px_rgb(16_48_94/0.6)] ring-1 ring-slate-900/5"
          style={{ fontFamily: JAKES_FACE, width: PAPER_W }}
        >
          <motion.p
            {...reveal()}
            className="text-center text-[16px] leading-tight font-bold tracking-wide"
          >
            {candidate.name}
          </motion.p>
          <motion.p {...reveal()} className="mt-0.5 text-center text-[8px] text-slate-600">
            alex@example.com | linkedin.com/in/alexmorgan | github.com/alexmorgan
          </motion.p>

          <Heading reveal={reveal()}>Education</Heading>
          <Entry
            reveal={reveal()}
            left="Northview University"
            right="Sep 2023 – May 2027"
            sub="B.S. in Computer Science"
          />

          <Heading reveal={reveal()}>Experience</Heading>
          <Entry
            reveal={reveal()}
            left="Teaching Assistant"
            right="Jan 2025 – Present"
            sub="Data Structures, Northview University"
          />
          <Bullet reveal={reveal()} target="ta">
            <Kept on={applied("ta")}>Held weekly office hours for 120 students.</Kept>
          </Bullet>
          <Struck on={applied("help-desk")}>
            <Entry
              reveal={reveal()}
              target="help-desk"
              left="IT Support Intern"
              right="May 2024 – Aug 2024"
              sub="Campus Help Desk"
            />
            <Bullet reveal={reveal()}>Resolved 300+ tickets for laptops and Wi-Fi.</Bullet>
          </Struck>

          <Heading reveal={reveal()}>Projects</Heading>
          <Entry
            reveal={reveal()}
            left={
              <>
                Budget Tracker <span className="font-normal italic">| React, Node.js</span>
              </>
            }
            right="2025"
          />
          <Bullet reveal={reveal()} target="budget">
            <Struck inline on={applied("budget")}>
              Built a budgeting app that 200 students use every week.
            </Struck>
            {applied("budget") && (
              <Inserted>
                {" "}
                Built a TypeScript budgeting app on a REST API, used by 200 students weekly.
              </Inserted>
            )}
          </Bullet>

          <Heading reveal={reveal()}>Leadership</Heading>
          <Entry
            reveal={reveal()}
            left="Treasurer"
            right="Sep 2024 – Present"
            sub="Coding Club, Northview University"
          />

          <Heading reveal={reveal()}>Technical Skills</Heading>
          <motion.p {...reveal()} data-target="languages">
            <span className="font-bold">Languages: </span>
            {applied("languages") && <Inserted>TypeScript, </Inserted>}
            Python, SQL, JavaScript, Java
          </motion.p>
          <motion.p {...reveal()}>
            <span className="font-bold">Tools: </span>
            Git, React, Node.js, PostgreSQL
          </motion.p>
        </div>

        {/* The suggestions, in the gutters beside the lines they change. */}
        {suggestions.map(
          (suggestion, i) =>
            shown(i) &&
            tops[suggestion.target] !== undefined && (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                // Level with its line, but never past the page's foot.
                top={Math.min(tops[suggestion.target] ?? 0, rowHeight - CARD_H)}
                done={applied(suggestion.target)}
              />
            ),
        )}
      </div>
    </motion.div>
  );
}

/** The props one `reveal()` call returns. */
type Reveal = Pick<HTMLMotionProps<"p">, "initial" | "animate" | "transition">;

function Heading({ reveal, children }: { reveal: Reveal; children: React.ReactNode }) {
  return (
    <motion.p
      {...reveal}
      className="mt-2 border-b border-slate-900 pb-px text-[10px] tracking-wide [font-variant:small-caps]"
    >
      {children}
    </motion.p>
  );
}

function Entry({
  reveal,
  target,
  left,
  right,
  sub,
}: {
  reveal: Reveal;
  target?: Target;
  left: React.ReactNode;
  right: string;
  sub?: string;
}) {
  return (
    <motion.div {...reveal} data-target={target} className="mt-1">
      <p className="flex justify-between gap-2">
        <span className="font-bold">{left}</span>
        <span>{right}</span>
      </p>
      {sub && <p className="italic">{sub}</p>}
    </motion.div>
  );
}

function Bullet({
  reveal,
  target,
  children,
}: {
  reveal: Reveal;
  target?: Target;
  children: React.ReactNode;
}) {
  return (
    <motion.p {...reveal} data-target={target} className="mt-0.5 flex gap-1.5 pl-2">
      <span aria-hidden="true">•</span>
      <span>{children}</span>
    </motion.p>
  );
}

/** Crossed out in red once a suggestion cuts it: whole entries, or a run of text. */
function Struck({
  on,
  inline = false,
  children,
}: {
  on: boolean;
  inline?: boolean;
  children: React.ReactNode;
}) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      className={cn(
        "line-through decoration-1 transition-[color,text-decoration-color] duration-500 [&_*]:line-through [&_*]:decoration-inherit",
        on ? "decoration-danger text-slate-400" : "decoration-transparent",
      )}
    >
      {children}
    </Tag>
  );
}

/** Added by a suggestion: green, easing in. */
function Inserted({ children }: { children: React.ReactNode }) {
  return (
    <motion.ins
      className="bg-positive-tint text-positive-ink rounded-[2px] no-underline"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.ins>
  );
}

/** Kept on a suggestion's advice: a soft blue wash. */
function Kept({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-[2px] transition-colors duration-500",
        on ? "bg-advanced-tint" : "bg-transparent",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A mock AI suggestion in the gutter, level with the line it changes, with
 * a short rule pointing at the page. Ticks once applied.
 */
function SuggestionCard({
  suggestion,
  top,
  done,
}: {
  suggestion: ResumeSuggestion;
  top: number;
  done: boolean;
}) {
  const left = suggestion.side === "left";
  return (
    <motion.div
      className={cn(
        "absolute w-[86px] rounded-lg bg-white/90 p-1.5 shadow-[0_10px_24px_-14px_rgb(16_48_94/0.55)] ring-1 ring-slate-900/5 backdrop-blur-sm",
        left ? "left-1" : "right-1",
      )}
      // The title row sits level with the line's first row.
      style={{ top: Math.max(0, top - 6) }}
      initial={{ opacity: 0, x: left ? -10 : 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: GLIDE }}
    >
      <p
        className={cn(
          "flex items-center gap-1 text-[10px] font-semibold",
          KIND_TONE[suggestion.kind],
        )}
      >
        {done ? (
          <Check className="size-3 shrink-0" aria-hidden="true" />
        ) : (
          <SparkleIcon className="size-3 shrink-0" />
        )}
        {suggestion.title}
      </p>
      <p className="text-ink-meta mt-0.5 text-[9px] leading-snug">{suggestion.body}</p>
      {/* The rule to the page. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[11px] h-px w-[12px] bg-slate-300",
          left ? "-right-[12px]" : "-left-[12px]",
        )}
      />
    </motion.div>
  );
}

/** The match against the job: counts to each new value, green from 85. */
function MatchChip({ value }: { value: number }) {
  const shown = useMotionValue(value);
  const label = useTransform(shown, (v) => `${Math.round(v)}%`);
  React.useEffect(() => {
    const controls = animate(shown, value, { duration: 0.6, ease: GLIDE });
    return () => controls.stop();
  }, [shown, value]);

  return (
    <span
      className={cn(
        "rounded-md px-[7px] py-0.5 text-[11px] font-bold tabular-nums ring-1 transition-colors duration-500 ring-inset",
        scoreTone(value),
      )}
    >
      <motion.span>{label}</motion.span>
    </span>
  );
}
