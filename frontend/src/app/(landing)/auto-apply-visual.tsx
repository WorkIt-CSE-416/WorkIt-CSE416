"use client";

import * as React from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { Check, ChevronDown, FileText, Lock, MousePointer2, Paperclip } from "lucide-react";

import { SparkleIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

import { FaviconLogo } from "./favicon-logo";
import { autoApplyFeature, type ApplicationField, type GridApplication } from "./feature-data";
import { GLIDE, Story, type StoryScene } from "./story";

/**
 * The Auto Apply stop. Auto Apply fills in one whole application, field by
 * field, scrolling down the form to Submit, and the student clicks Submit:
 * auto apply never submits on its own (auto-apply/architecture.md,
 * "Decisions"). Then the camera pulls back: the same window is the middle
 * of a queue of applications filled for the student, nine, then 25, then
 * 49. The run fills one application at a time, in one background tab, so
 * the copy says a queue and never "at once" or "in parallel". Every window
 * is drawn at the stage's full size and the camera scales the whole grid,
 * so the zoom is one transform and the windows keep their proportions at
 * every step. Timing and the scene title are the shared Story's; with
 * reduced motion it holds the finished grid.
 */

/** The stage, and every application window, in px. */
const W = 520;
const H = 440;
/** A window's title bar. */
const BAR = 36;
/** The room between two windows in the grid, at full size. */
const GAP = 44;
/** The grid is SIDE × SIDE windows; the one filled up close sits in the middle. */
const SIDE = 7;
const MID = (SIDE - 1) / 2;
const GRID_W = SIDE * W + (SIDE - 1) * GAP;
const GRID_H = SIDE * H + (SIDE - 1) * GAP;

/** Windows across in each scene: one, then 3 × 3, 5 × 5 and 7 × 7. */
const ACROSS = [1, 3, 5, 7] as const;

/** The camera's scale to frame `n` × `n` windows, with a margin so the next
 * ring peeks in at the edges. */
function frame(n: number) {
  if (n === 1) return 1;
  return 0.9 * Math.min(W / (n * W + (n - 1) * GAP), H / (n * H + (n - 1) * GAP));
}

// --- The schedule of the one application filled up close ---

const FIELDS: ApplicationField[] = autoApplyFeature.sections.flatMap((section) => section.fields);
const COUNT = FIELDS.length;

/** How long a field takes to fill, in ms: fast, since speed is the point. */
function fillMs(field: ApplicationField) {
  if (field.kind === "select") return 230;
  if (field.kind === "file") return 520;
  if (field.kind === "long") return 900;
  return Math.min(260, 90 + field.value.length * 5);
}

const SCHEDULE = (() => {
  let at = 450;
  return FIELDS.map((field) => {
    const ms = fillMs(field);
    const start = at;
    at += ms + 45;
    return { start, ms };
  });
})();
const LAST = SCHEDULE[COUNT - 1];
/** Every field filled: the student's turn. */
const READY_AT = LAST.start + LAST.ms + 250;
/** The student's pointer reaches Submit and clicks it. */
const CLICK_AT = READY_AT + 950;

const SCENES = [
  { id: "one", caption: "Auto Apply fills it in. You click Submit.", hold: CLICK_AT + 1500 },
  { id: "nine", caption: "Then the next job in your queue", hold: 3600 },
  { id: "twentyFive", caption: "And the next, run after run", hold: 3400 },
  { id: "fortyNine", caption: "49 applications filled for you", hold: 4800 },
] as const satisfies readonly StoryScene<string>[];

type SceneId = (typeof SCENES)[number]["id"];
const LEVEL: Record<SceneId, number> = { one: 0, nine: 1, twentyFive: 2, fortyNine: 3 };

export default function AutoApplyVisual() {
  return (
    <Story scenes={SCENES} rest="fortyNine" accent="bg-positive" stageHeight={H}>
      {(scene) => <Stage level={LEVEL[scene]} />}
    </Story>
  );
}

function Stage({ level }: { level: number }) {
  // A new run each time the story comes back to the first scene: the grid
  // fades out and one fresh, empty application fades in, rather than the
  // camera flying back into a window that is already submitted. Set during
  // render, not in an effect.
  const [run, setRun] = React.useState(0);
  const [shownLevel, setShownLevel] = React.useState(level);
  if (level !== shownLevel) {
    setShownLevel(level);
    if (level === 0) setRun((r) => r + 1);
  }

  return (
    // Clipped a little outside the stage, so the close-up window's shadow
    // is not cut off at its edges.
    <div className="absolute -inset-6 overflow-hidden">
      <AnimatePresence>
        <Camera key={run} level={level} />
      </AnimatePresence>
      <SentCount level={level} />
    </div>
  );
}

/** Every cell of the grid but the middle, with its ring (how many steps out
 * it is), its employer and a small head start so the ring does not fill in
 * lockstep. */
const CELLS = (() => {
  const cells: { row: number; col: number; ring: number; lag: number }[] = [];
  for (let row = 0; row < SIDE; row++) {
    for (let col = 0; col < SIDE; col++) {
      const ring = Math.max(Math.abs(row - MID), Math.abs(col - MID));
      if (ring > 0) cells.push({ row, col, ring, lag: ((row * 7 + col * 13) % 10) / 10 });
    }
  }
  // Inner rings take the first employers, so the first nine are all
  // different companies.
  cells.sort((a, b) => a.ring - b.ring);
  return cells.map((cell, i) => ({
    ...cell,
    app: autoApplyFeature.grid[i % autoApplyFeature.grid.length],
  }));
})();

const at = (row: number, col: number) => ({ left: col * (W + GAP), top: row * (H + GAP) });

function Camera({ level }: { level: number }) {
  return (
    <motion.div
      className="absolute"
      style={{
        width: GRID_W,
        height: GRID_H,
        left: (W - GRID_W) / 2 + 24,
        top: (H - GRID_H) / 2 + 24,
      }}
      initial={{ opacity: 0, scale: frame(ACROSS[level]) }}
      animate={{ opacity: 1, scale: frame(ACROSS[level]) }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      transition={{ scale: { duration: 1.2, ease: GLIDE }, opacity: { duration: 0.35 } }}
    >
      {/* The rings are mounted one step ahead of the camera, so the next
          one is there as it comes into frame, and no further, since 48
          windows cost more to draw than the few on screen. */}
      {CELLS.filter((cell) => cell.ring <= level + 1).map((cell) => (
        <MiniApplication
          key={`${cell.row}-${cell.col}`}
          app={cell.app}
          go={cell.ring <= level}
          // Starts as the camera settles, each a little apart.
          delay={0.55 + cell.lag * 0.8}
          style={at(cell.row, cell.col)}
        />
      ))}
      <Application live={level === 0} level={level} style={at(MID, MID)} />
    </motion.div>
  );
}

// --- The application filled up close ---

/** An element's offset from `root`, through any positioned ancestors. */
function topWithin(el: HTMLElement, root: HTMLElement) {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/** The visible height of the page, under the title bar. */
const VIEW = H - BAR;

function Application({
  live,
  level,
  style,
}: {
  live: boolean;
  level: number;
  style: React.CSSProperties;
}) {
  const { job, url, sections } = autoApplyFeature;
  // The field being filled: -1 before the first, COUNT once every field is
  // filled and it waits for the student, COUNT + 1 once they submit. A
  // window that is not live is already submitted.
  const [active, setActive] = React.useState(live ? -1 : COUNT + 1);

  React.useEffect(() => {
    if (!live) return;
    const timers = SCHEDULE.map(({ start }, i) => window.setTimeout(() => setActive(i), start));
    timers.push(window.setTimeout(() => setActive(COUNT), READY_AT));
    timers.push(window.setTimeout(() => setActive(COUNT + 1), CLICK_AT));
    return () => timers.forEach(window.clearTimeout);
  }, [live]);

  // Where each field sits on the page, so the page scrolls to keep the
  // field being filled in view.
  const pageRef = React.useRef<HTMLDivElement>(null);
  const [tops, setTops] = React.useState<number[]>([]);
  const [pageH, setPageH] = React.useState(0);
  React.useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    setTops(
      FIELDS.map((field) => {
        const el = page.querySelector<HTMLElement>(`[data-field="${field.id}"]`);
        return el ? topWithin(el, page) : 0;
      }),
    );
    setPageH(page.offsetHeight);
  }, []);
  const maxScroll = Math.max(0, pageH - VIEW);
  const scroll =
    active >= COUNT
      ? maxScroll
      : active < 0
        ? 0
        : Math.min(maxScroll, Math.max(0, (tops[active] ?? 0) - VIEW * 0.3));

  const sent = active > COUNT;
  let index = 0;

  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-900/10 transition-shadow duration-700 motion-reduce:transition-none"
      style={{
        ...style,
        width: W,
        height: H,
        // Ringed in the stop's green once the camera pulls back, so the
        // window that was filled up close stays easy to find; thicker as
        // the grid grows, since the camera shrinks it.
        boxShadow: `0 0 0 ${[0, 10, 18, 26][level]}px color-mix(in oklab, var(--color-positive) 75%, transparent), 0 24px 48px -24px rgb(16 48 94 / 0.55)`,
      }}
    >
      <WindowBar>
        <span className="text-ink-meta flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2 text-[10.5px] ring-1 ring-slate-900/5">
          <Lock className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{url}</span>
        </span>
        <ExtensionChip active={active} />
      </WindowBar>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          ref={pageRef}
          className="relative px-6 pt-5 pb-6"
          initial={false}
          animate={{ y: -scroll }}
          transition={{ duration: 0.5, ease: GLIDE }}
        >
          <div className="flex items-center gap-3">
            <FaviconLogo domain={job.domain} eager className="size-11 rounded-xl" />
            <div className="min-w-0">
              <p className="text-ink text-[17px] leading-tight font-semibold">{job.title}</p>
              <p className="text-ink-meta mt-0.5 text-[11px]">
                {job.company} · {job.place}
              </p>
            </div>
          </div>

          {sections.map((section) => (
            <section key={section.title} className="mt-5 border-t border-slate-900/5 pt-4">
              <h4 className="text-ink text-[12.5px] font-semibold">{section.title}</h4>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
                {section.fields.map((field) => {
                  const i = index++;
                  const state = i < active ? "filled" : i === active ? "filling" : "empty";
                  return (
                    <Field
                      key={field.id}
                      field={field}
                      state={state}
                      ms={SCHEDULE[i].ms}
                      instant={!live}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <motion.div
            className={cn(
              "mt-6 flex h-10 items-center justify-center gap-2 rounded-lg text-[13px] font-semibold text-white transition-colors duration-300",
              sent ? "bg-positive" : "bg-slate-900",
            )}
            // Pressed by the student's click.
            animate={{ scale: sent && live ? [1, 0.95, 1] : 1 }}
            transition={{ duration: 0.3 }}
          >
            {sent ? (
              <>
                <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                Application submitted
              </>
            ) : (
              "Submit application"
            )}
          </motion.div>
        </motion.div>

        {/* The student's pointer: in once every field is filled, onto Submit,
            and clicks. Submit is at the page's foot, which is scrolled into
            view by then: 24px of padding under a 40px button. */}
        <AnimatePresence>
          {live && active >= COUNT && (
            <motion.span
              aria-hidden="true"
              className="text-ink absolute z-10"
              initial={{ left: W * 0.86, top: VIEW + 10, opacity: 0 }}
              animate={{
                left: W / 2 + 28,
                top: VIEW - 50,
                // Gone a moment after the click, off the button's label.
                opacity: sent ? 0 : 1,
                scale: sent ? [1, 0.8, 1] : 1,
              }}
              exit={{ opacity: 0 }}
              transition={{
                left: { duration: 0.75, ease: GLIDE },
                top: { duration: 0.75, ease: GLIDE },
                opacity: { duration: 0.25, delay: sent ? 0.5 : 0 },
                scale: { duration: 0.25 },
              }}
            >
              <MousePointer2 className="size-5 fill-white drop-shadow" />
            </motion.span>
          )}
        </AnimatePresence>

        {/* Submitted: a banner drops in over the top of the page. */}
        <AnimatePresence>
          {sent && (
            <motion.div
              className="glass-card text-ink absolute inset-x-6 top-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            >
              <span className="bg-positive grid size-7 shrink-0 place-items-center rounded-full text-white">
                <Check className="size-4" strokeWidth={3} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold">
                  Submitted to {job.company}
                </span>
                <span className="text-ink-meta block text-[11px]">
                  {COUNT} fields filled, tailored resume attached
                </span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** WorkIt's extension in the browser bar, counting the fields. */
function ExtensionChip({ active }: { active: number }) {
  const sent = active > COUNT;
  const label =
    active < 0
      ? "Auto Apply"
      : active < COUNT
        ? `Filling ${active + 1} of ${COUNT}`
        : sent
          ? "Submitted"
          : "Your turn: Submit";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white tabular-nums transition-colors duration-300",
        sent ? "bg-positive" : "bg-brand",
      )}
    >
      {sent ? (
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      ) : (
        <SparkleIcon className="size-3" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

type FieldState = "empty" | "filling" | "filled";

function Field({
  field,
  state,
  ms,
  instant,
}: {
  field: ApplicationField;
  state: FieldState;
  ms: number;
  /** Already filled when it appears: no typing. */
  instant: boolean;
}) {
  const on = state !== "empty";
  const kind = field.kind ?? "text";
  return (
    <div data-field={field.id} className={field.half ? undefined : "col-span-2"}>
      <p className="text-ink mb-1 flex items-center gap-1.5 text-[10.5px] leading-tight font-medium">
        <span>
          {field.label} <span className="text-danger">*</span>
        </span>
        {kind === "long" && on && (
          <motion.span
            className="text-brand ml-auto flex shrink-0 items-center gap-1 text-[10px] font-semibold"
            initial={instant ? false : { opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <SparkleIcon className="size-3" aria-hidden="true" />
            Drafted from your experience bank
          </motion.span>
        )}
      </p>
      <div
        className={cn(
          "relative flex min-h-8 items-center rounded-md bg-white px-2.5 pr-7 text-[11.5px] ring-1 transition-[box-shadow,background-color] duration-200",
          kind === "long" && "min-h-[62px] items-start py-1.5 leading-snug",
          state === "filling"
            ? "bg-positive-tint/60 ring-positive/70 ring-2"
            : kind === "file" && !on
              ? "border border-dashed border-slate-300 ring-0"
              : "ring-slate-900/15",
        )}
      >
        <FieldValue field={field} kind={kind} on={on} ms={ms} instant={instant} />
        <AnimatePresence>
          {state === "filled" && (
            <motion.span
              className={cn(
                "bg-positive absolute right-2 grid size-3.5 place-items-center rounded-full text-white",
                kind === "long" ? "top-2" : "top-1/2 -mt-[7px]",
              )}
              initial={instant ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
            >
              <Check className="size-2.5" strokeWidth={3.5} aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FieldValue({
  field,
  kind,
  on,
  ms,
  instant,
}: {
  field: ApplicationField;
  kind: NonNullable<ApplicationField["kind"]>;
  on: boolean;
  ms: number;
  instant: boolean;
}) {
  const seconds = ms / 1000;

  if (kind === "select") {
    return (
      <>
        {on ? (
          <motion.span
            className="text-ink truncate"
            initial={instant ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: seconds * 0.7, ease: GLIDE }}
          >
            {field.value}
          </motion.span>
        ) : (
          <span className="truncate text-slate-400">Select...</span>
        )}
        <ChevronDown
          className="absolute right-2 size-3.5 text-slate-400 transition-opacity data-[on=true]:opacity-0"
          data-on={on}
          aria-hidden="true"
        />
      </>
    );
  }

  if (kind === "file") {
    if (!on) {
      return (
        <span className="flex items-center gap-1.5 text-slate-400">
          <Paperclip className="size-3.5" aria-hidden="true" />
          Attach, or drop a file here
        </span>
      );
    }
    return (
      <span className="relative flex min-w-0 flex-1 items-center gap-2 py-1">
        <motion.span
          className="text-ink flex min-w-0 items-center gap-1.5 rounded-md bg-slate-50 px-1.5 py-0.5 font-medium ring-1 ring-slate-900/5"
          initial={instant ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: instant ? 0 : seconds * 0.55,
            type: "spring",
            stiffness: 420,
            damping: 24,
          }}
        >
          <FileText className="text-danger size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{field.value}</span>
        </motion.span>
        <motion.span
          className="bg-advanced-tint text-advanced shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          initial={instant ? false : { opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: instant ? 0 : seconds * 0.8, duration: 0.2 }}
        >
          Tailored for this job
        </motion.span>
        {/* The upload's progress, under the chip. */}
        {!instant && (
          <motion.span
            aria-hidden="true"
            className="bg-positive absolute -bottom-1 left-0 h-0.5 rounded-full"
            initial={{ width: "0%", opacity: 1 }}
            animate={{ width: "100%", opacity: [1, 1, 0] }}
            transition={{ duration: seconds, ease: "easeOut" }}
          />
        )}
      </span>
    );
  }

  if (kind === "long") {
    if (!on) return <span className="text-slate-400">Type your answer</span>;
    // Word by word, as if written.
    const words = field.value.split(" ");
    return (
      <span className="text-ink">
        {words.map((word, i) => (
          <motion.span
            key={i}
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: (i / words.length) * seconds * 0.95, duration: 0.12 }}
          >
            {word}{" "}
          </motion.span>
        ))}
      </span>
    );
  }

  if (!on) return null;
  // Typed: the value is uncovered left to right.
  return (
    <motion.span
      className="text-ink truncate"
      initial={instant ? false : { clipPath: "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0% 0 0)" }}
      transition={{ duration: seconds * 0.9, ease: "linear" }}
    >
      {field.value}
    </motion.span>
  );
}

// --- The other windows in the grid ---

/** A window's title bar: the three window buttons, then what goes in it. */
function WindowBar({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-slate-900/5 bg-slate-50 px-3.5"
      style={{ height: BAR }}
    >
      <span className="flex gap-1.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="size-2.5 rounded-full bg-[#28c840]/80" />
      </span>
      {children}
    </div>
  );
}

/** The widths of a far window's six fields' values, in %. */
const MINI_VALUES = [62, 74, 88, 58, 80, 46];

/**
 * A window seen only from afar: drawn with big type and plain bars, since
 * the camera shows it at a third of its size or less. Its fields fill and
 * it is marked filled by CSS transitions, each with its own delay, once `go` is set.
 */
function MiniApplication({
  app,
  go,
  delay,
  style,
}: {
  app: GridApplication;
  go: boolean;
  delay: number;
  style: React.CSSProperties;
}) {
  const step = 0.16;
  const after = (k: number) => ({ transitionDelay: go ? `${delay + k * step}s` : "0s" });
  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-30px_rgb(16_48_94/0.5)] ring-2 ring-slate-900/5"
      style={{ ...style, width: W, height: H }}
    >
      <WindowBar>
        <span className="h-6 flex-1 rounded-md bg-white ring-1 ring-slate-900/5" />
        <span
          className={cn(
            "size-6 rounded-full transition-colors duration-300 motion-reduce:transition-none",
            go ? "bg-positive" : "bg-brand",
          )}
          style={after(MINI_VALUES.length + 1)}
        />
      </WindowBar>
      <div className="px-8 pt-6">
        <div className="flex items-center gap-4">
          <FaviconLogo domain={app.domain} eager className="size-16 rounded-2xl" />
          <div className="min-w-0">
            <p className="text-ink truncate text-[30px] leading-tight font-semibold">
              {app.company}
            </p>
            <p className="text-ink-meta truncate text-[20px]">{app.title}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4">
          {MINI_VALUES.map((width, k) => (
            <div key={k}>
              <span className="block h-3 w-2/5 rounded-full bg-slate-200" />
              <span className="mt-2 flex h-10 items-center rounded-xl px-4 ring-2 ring-slate-200">
                <span
                  className={cn(
                    "block h-3 origin-left rounded-full bg-slate-500 transition-transform duration-300 ease-out motion-reduce:transition-none",
                    go ? "scale-x-100" : "scale-x-0",
                  )}
                  style={{ width: `${width}%`, ...after(k) }}
                />
              </span>
            </div>
          ))}
        </div>
        <div
          className={cn(
            "mt-5 flex h-12 items-center justify-center gap-2 rounded-2xl text-[20px] font-semibold transition-colors duration-300 motion-reduce:transition-none",
            go ? "bg-positive text-white" : "bg-slate-100 text-transparent",
          )}
          style={after(MINI_VALUES.length + 1)}
        >
          <Check className="size-6" strokeWidth={3} aria-hidden="true" />
          Filled
        </div>
      </div>
    </div>
  );
}

/** The tally under the grid: every window filled so far. */
function SentCount({ level }: { level: number }) {
  const reduceMotion = useReducedMotion();
  const total = ACROSS[level] ** 2;
  const value = useMotionValue(level === 0 ? 0 : total);
  const text = useTransform(value, (v) => {
    const n = Math.round(v);
    return `${n} ${n === 1 ? "application" : "applications"} filled`;
  });

  React.useEffect(() => {
    if (level === 0) {
      value.jump(0);
      return;
    }
    if (reduceMotion) {
      value.jump(total);
      return;
    }
    // From the last grid's total, as the new ring's windows are filled.
    value.jump(Math.max(ACROSS[level - 1] ** 2, Math.min(value.get(), total)));
    const controls = animate(value, total, { delay: 0.9, duration: 1.9, ease: "easeInOut" });
    return () => controls.stop();
  }, [level, total, value, reduceMotion]);

  return (
    <AnimatePresence>
      {level > 0 && (
        <motion.div
          className="glass-card text-ink absolute bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-[13px] font-semibold whitespace-nowrap"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={{ duration: 0.35, ease: GLIDE }}
        >
          <span className="bg-positive grid size-6 place-items-center rounded-full text-white">
            <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="tabular-nums">
            <motion.span>{text}</motion.span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
