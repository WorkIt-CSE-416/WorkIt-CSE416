/**
 * A scraped posting's description, readable. The scraper keeps it as plain
 * text, one line per paragraph or list item of the employer's page. Headings
 * are not marked: "Responsibilities" is just a short line. Since KAN-229 a
 * line the employer's HTML listed is stored as "• item", which the rules below
 * read as a list item; one stored before then is just a line. The scraper
 * also stores a description's kept sections under fixed headings ("Overview",
 * "Responsibilities", "Requirements"...; scraper/docs/sections.md),
 * but a posting stored before then, or one kept whole, still has its
 * employer's own ("What You'll Do", "Who You Are"), so this reads the text's
 * own shape rather than looking for those names:
 *
 *   a short Title Case line with no full stop,    a subheading
 *     with text after it (or any short line
 *     ending ":")
 *   two or more lines under a subheading, none    a list
 *     a long paragraph
 *   a line opening "-", "•", "*" or "1."          a list item, anywhere
 *   the text before the first subheading, and     paragraphs
 *     a lone or long line under one
 *
 * A run of short lines ("Python", "Go", "Rust") is a list, never a stack of
 * subheadings, but a line ending ":" heads one whatever follows it. Measured on live postings (2026-10-09): about half came out as
 * thirty-odd one-line paragraphs before this read their subheadings.
 *
 * Its paragraphs and list items are ink, the headings' colour, not the body
 * copy's ink-muted: a posting is long reading, and the lighter grey was hard
 * to read at length (2026-10-17). The page's "Open in …" line above it
 * matches.
 *
 * THE FIXED SECTIONS GET AN ICON (`SECTION_ICONS`). Since KAN-229 the scraper
 * stores a description under fixed headings (scraper/workit_scraper/
 * sections.py, `KEPT`), and each of those draws its glyph beside it in brand
 * purple, so a long posting can be scanned by section. All Filters' section
 * icons stay grey: there they label controls, here they mark where to read. Those
 * names are part of the feed's contract here too: a heading renamed in the
 * scraper alone loses its icon. In a description that has them, any other
 * heading the employer wrote ("California Hourly Rate:" under Pay) is a
 * smaller subheading with no icon, so it never reads as a section missing
 * one. A description stored before KAN-229 has none of them, and its headings
 * draw as before, all alike and without icons.
 *
 * THE EXTRAS ARE FOLDED UNDER THE JOB (`EXTRA_SECTIONS`). Since 2026-10-18 the
 * scraper also keeps Benefits, How to Apply and About the Company, after the
 * job's sections (sections.py, `EXTRA`). They show last, in one "More from the
 * posting" fold that names them, closed at first, so the job itself is what a
 * student reads first; matching never reads them. Before, they were left out,
 * and with them what an employer wrote about the job under a perks heading.
 * Only the job's sections make a description "sectioned": a description stored
 * before KAN-229 with its own "Benefits" line draws as before.
 *
 * The scraper cuts a long posting at 8,000 characters and ends it " …"
 * (providers.cap); then the last line says so and links to the whole posting
 * on the employer's site.
 */

import type { ComponentType } from "react";

import {
  ApplyIcon,
  BenefitsIcon,
  ChevronDownIcon,
  CoinIcon,
  CompanyIcon,
  DetailsIcon,
  OverviewIcon,
  PreferredIcon,
  RequirementsIcon,
  ResponsibilitiesIcon,
} from "@/components/icons";

/** Each fixed section heading's icon (KAN-229). */
const SECTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Overview: OverviewIcon,
  Responsibilities: ResponsibilitiesIcon,
  Requirements: RequirementsIcon,
  "Preferred Qualifications": PreferredIcon,
  Pay: CoinIcon,
  Details: DetailsIcon,
  Benefits: BenefitsIcon,
  "How to Apply": ApplyIcon,
  "About the Company": CompanyIcon,
};

/** The extras the scraper keeps after the job's sections (sections.py, `EXTRA`),
 *  in its order: shown folded, last. */
const EXTRA_SECTIONS = ["Benefits", "How to Apply", "About the Company"];

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  /** A core section the description lacks, and why (`withCoreSections`). */
  | { kind: "missing"; why: "cut" | "unlisted" }
  /** Pay the posting sent as a field rather than in its text. */
  | { kind: "listed-pay"; pay: string };

/** The fixed sections in the order the scraper stores them (KAN-229, `KEPT`). */
const SECTION_ORDER = [
  "Overview",
  "Responsibilities",
  "Requirements",
  "Preferred Qualifications",
  "Pay",
  "Details",
  ...EXTRA_SECTIONS,
];

/** The sections every sectioned description shows, there or not. Preferred
 *  Qualifications and Details are missing from 52% and 78% of postings
 *  (2026-10-17), so a placeholder there would be mostly noise. */
const CORE = new Set(["Overview", "Responsibilities", "Requirements", "Pay"]);

/**
 * The blocks with every core section in its place: a missing one gets its
 * heading and a line saying why (KAN-229 fix 5). Why is what WorkIt can know:
 *
 * - Pay the hiring system sent as a field (Ashby, Lever) is the card's, and it
 *   shows here as the employer's listing: 79 postings had pay on the card and
 *   no "$" in their text at all.
 * - A description cut at 8,000 characters may hold the section past the cut,
 *   which is WorkIt's limit, not the posting's.
 * - Otherwise the posting has no heading for it. That is said as such rather
 *   than "the posting doesn't say": the facts may still be in a paragraph the
 *   scraper could not place.
 */
function withCoreSections(blocks: Block[], cut: boolean, pay: string | null): Block[] {
  const at = (name: string) => blocks.findIndex((b) => b.kind === "heading" && b.text === name);
  const starts = SECTION_ORDER.map(at).filter((i) => i >= 0);
  const intro = blocks.slice(0, starts.length > 0 ? Math.min(...starts) : blocks.length);
  const out: Block[] = [...intro];
  for (const name of SECTION_ORDER) {
    const start = at(name);
    if (start >= 0) {
      const next = blocks.findIndex(
        (b, i) => i > start && b.kind === "heading" && SECTION_ORDER.includes(b.text),
      );
      out.push(...blocks.slice(start, next < 0 ? blocks.length : next));
    } else if (CORE.has(name)) {
      out.push({ kind: "heading", text: name });
      out.push(
        name === "Pay" && pay
          ? { kind: "listed-pay", pay }
          : { kind: "missing", why: cut ? "cut" : "unlisted" },
      );
    }
  }
  return out;
}

const BULLET = /^(?:[-•*·▪●◦]|\d{1,2}[.)])\s+/;

/** The marker the scraper adds after a cut, and so the sign it was cut. */
const CUT = " …";

/** Longest line that still reads as a list item rather than a paragraph. */
const ITEM_MAX = 300;

export function isCut(text: string): boolean {
  return text.endsWith(CUT);
}

/** Words a title leaves lowercase ("Nice to Have", "Examples of Projects"). */
const SMALL = new Set(
  "a an and as at but by for from in into nor of on or per the to vs via with".split(" "),
);

/** "Who You Are", "Nice to Have", "WHAT YOU'LL DO": every word but the small
 *  ones capitalised. A list item is written like a sentence ("Strong
 *  attention to detail", "Proficiency in Python and C++"), which is what
 *  keeps a short item in the middle of a list from reading as a subheading. */
function titleCased(line: string): boolean {
  const words = line.split(/\s+/);
  return words.every((word, i) => (i > 0 && SMALL.has(word.toLowerCase())) || !/^[a-z]/.test(word));
}

/** Could this line be a subheading, on its own? */
function headingLike(line: string): boolean {
  const words = line.split(/\s+/);
  if (line.endsWith(":")) return words.length <= 8 && line.length <= 60;
  return words.length <= 6 && line.length <= 50 && titleCased(line) && !/[.!?;,)]$/.test(line);
}

export function toBlocks(text: string): Block[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // A subheading stands alone with text after it: two heading-like lines in a
  // row are short list items ("Python", "Go"), and a last line heads nothing.
  const candidate = lines.map((line) => !BULLET.test(line) && headingLike(line));
  // A line ending ":" says it heads what follows, so it stays one even when
  // the first item under it is short ("Requirements:" then "Python"); that
  // demoted 184 of 1,160 postings' subheadings (review, 2026-10-10).
  // A fixed section heading (KAN-229) always heads its section, even straight
  // before an employer's own ("Requirements" then "Required Qualifications"),
  // which the neighbour rule read as two list items: TensorWave's requirements
  // then showed as missing and sat under the section above. The scraper never
  // leaves a content line that is exactly one of these names.
  const heading = candidate.map(
    (c, i) =>
      SECTION_ORDER.includes(lines[i]) ||
      (c &&
        i < lines.length - 1 &&
        (lines[i].endsWith(":") || (!candidate[i - 1] && !candidate[i + 1]))),
  );

  const blocks: Block[] = [];
  let section: string[] = [];
  let underHeading = false;

  // A section's plain lines: a list when there are several short ones under a
  // subheading, paragraphs otherwise (and always before the first subheading).
  const flush = () => {
    if (section.length === 0) return;
    if (underHeading && section.length >= 2 && section.every((l) => l.length <= ITEM_MAX)) {
      blocks.push({ kind: "list", items: section });
    } else {
      for (const l of section) blocks.push({ kind: "paragraph", text: l });
    }
    section = [];
  };

  lines.forEach((line, i) => {
    if (heading[i]) {
      flush();
      blocks.push({ kind: "heading", text: line.replace(/:$/, "") });
      underHeading = true;
    } else if (BULLET.test(line)) {
      flush();
      const item = line.replace(BULLET, "");
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else {
      section.push(line);
    }
  });
  flush();
  return blocks;
}

export function JobDescription({
  text,
  company,
  applyUrl,
  pay = null,
}: {
  text: string;
  company: string;
  applyUrl: string;
  /** The card's pay ("$50–70/hr"), shown under Pay when the text has none. */
  pay?: string | null;
}) {
  const cut = isCut(text);
  const parsed = toBlocks(cut ? text.slice(0, -CUT.length) : text);
  // One of the job's fixed headings means the KAN-229 format, where the
  // employer's other headings are subheadings and every core section shows.
  const sectioned = parsed.some(
    (b) =>
      b.kind === "heading" &&
      Object.hasOwn(SECTION_ICONS, b.text) &&
      !EXTRA_SECTIONS.includes(b.text),
  );
  const all = sectioned ? withCoreSections(parsed, cut, pay) : parsed;
  // withCoreSections puts the extras last, so they are one tail to fold.
  const firstExtra = sectioned
    ? all.findIndex((b) => b.kind === "heading" && EXTRA_SECTIONS.includes(b.text))
    : -1;
  const blocks = firstExtra < 0 ? all : all.slice(0, firstExtra);
  const extras = firstExtra < 0 ? [] : all.slice(firstExtra);
  const extraNames = extras.flatMap((b) =>
    b.kind === "heading" && EXTRA_SECTIONS.includes(b.text) ? [b.text] : [],
  );
  const fullPosting = (label: string) => (
    <a
      href={applyUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand hover:text-brand-hover underline decoration-current underline-offset-2 transition-colors duration-150"
    >
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  const draw = (block: Block, i: number) =>
    block.kind === "heading" ? (
      <Heading key={i} text={block.text} sectioned={sectioned} />
    ) : block.kind === "list" ? (
      <ul key={i} role="list" className="flex flex-col gap-1.5 pl-4">
        {block.items.map((item, j) => (
          <li key={j} className="text-body text-ink flex items-start gap-2">
            {/* Ink like the text: in the faintest grey the bullets were
                    hard to see (2026-10-17). */}
            <span aria-hidden="true" className="bg-ink mt-2 size-1.5 shrink-0 rounded-full" />
            {item}
          </li>
        ))}
      </ul>
    ) : block.kind === "listed-pay" ? (
      <p key={i} className="text-body text-ink">
        {block.pay}{" "}
        <span className="text-ink-meta">
          (from {company}&apos;s listing, not the posting&apos;s text)
        </span>
      </p>
    ) : block.kind === "missing" ? (
      <p key={i} className="text-body text-ink-meta">
        {block.why === "cut" ? (
          <>Not in the part shown here. It may be further down the posting. </>
        ) : (
          // Never "not available": a heading the scraper doesn't know
          // ("Role Purpose") leaves its text in the section above.
          <>Not under its own heading in this posting. It may be in the text above. </>
        )}
        {fullPosting(`Read the full posting on ${company}'s site`)}.
      </p>
    ) : (
      <p key={i} className="text-body text-ink">
        {block.text}
      </p>
    );
  return (
    <div className="mt-3 flex max-w-[68ch] flex-col gap-3">
      {blocks.map(draw)}
      {extras.length > 0 && (
        <details className="group border-border mt-3 rounded-xl border">
          <summary className="hover:bg-hover focus-visible:ring-brand-ring flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <span className="text-body text-ink font-semibold">More from the posting</span>
            <span className="text-note text-ink-meta min-w-0 flex-1 truncate">
              {extraNames.join(", ")}
            </span>
            <ChevronDownIcon className="text-ink-meta size-4 shrink-0 transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">{extras.map(draw)}</div>
        </details>
      )}
      {cut && (
        <p className="text-body text-ink-meta">
          This is the start of the posting.{" "}
          {fullPosting(`Read the full posting on ${company}'s site`)}.
        </p>
      )}
    </div>
  );
}

/** A heading in the description: a fixed section's with its icon, an
 *  employer's own inside a sectioned description as a smaller subheading, or
 *  any heading of a description stored before KAN-229, the same size as a
 *  section's with no icon. Sections are 16px bold with a 20px icon, a step
 *  under "About the Role" (20px) above them: at 14px semibold they were too
 *  small to scan by (2026-10-17; Jobright's are 20px with no wrapper title).
 *  Subheadings are 14px semibold. */
function Heading({ text, sectioned }: { text: string; sectioned: boolean }) {
  const Icon = Object.hasOwn(SECTION_ICONS, text) ? SECTION_ICONS[text] : null;
  if (Icon) {
    return (
      <h3 className="text-subtitle text-ink mt-3 flex items-center gap-2 font-bold">
        <Icon className="text-brand size-5 shrink-0" />
        {text}
      </h3>
    );
  }
  if (sectioned) return <h4 className="text-body text-ink font-semibold">{text}</h4>;
  return <h3 className="text-subtitle text-ink mt-3 font-bold">{text}</h3>;
}
