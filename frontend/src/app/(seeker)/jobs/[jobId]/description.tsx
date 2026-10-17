/**
 * A scraped posting's description, readable. The scraper keeps it as plain
 * text, one line per paragraph or list item of the employer's page, with
 * neither headings nor bullets marked: "Responsibilities" is just a short
 * line, and the duties under it are just lines. Postings don't share
 * sections either (one has "What You'll Do", the next "Who You Are", most
 * something else), so this reads the text's own shape rather than sorting it
 * into the mock's three sections:
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
 * The scraper cuts a long posting at 8,000 characters and ends it " …"
 * (providers.cap); then the last line says so and links to the whole posting
 * on the employer's site.
 */

import type { ComponentType } from "react";

import {
  CoinIcon,
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
};

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] };

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
  const heading = candidate.map(
    (c, i) =>
      c &&
      i < lines.length - 1 &&
      (lines[i].endsWith(":") || (!candidate[i - 1] && !candidate[i + 1])),
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
}: {
  text: string;
  company: string;
  applyUrl: string;
}) {
  const cut = isCut(text);
  const blocks = toBlocks(cut ? text.slice(0, -CUT.length) : text);
  // One fixed heading means the KAN-229 format, where the employer's other
  // headings are subheadings.
  const sectioned = blocks.some(
    (b) => b.kind === "heading" && Object.hasOwn(SECTION_ICONS, b.text),
  );
  return (
    <div className="mt-3 flex max-w-[68ch] flex-col gap-3">
      {blocks.map((block, i) =>
        block.kind === "heading" ? (
          <Heading key={i} text={block.text} sectioned={sectioned} />
        ) : block.kind === "list" ? (
          <ul key={i} role="list" className="flex flex-col gap-1.5 pl-4">
            {block.items.map((item, j) => (
              <li key={j} className="text-body text-ink flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="bg-ink-faint mt-2 size-1.5 shrink-0 rounded-full"
                />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-body text-ink">
            {block.text}
          </p>
        ),
      )}
      {cut && (
        <p className="text-body text-ink-meta">
          This is the start of the posting.{" "}
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:text-brand-hover underline decoration-current underline-offset-2 transition-colors duration-150"
          >
            Read the full posting on {company}&apos;s site
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
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
