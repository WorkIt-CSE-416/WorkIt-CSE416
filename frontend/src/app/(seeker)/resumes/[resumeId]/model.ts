import type { Bank, BankEntry, Bullet, EntryFields, Skill } from "@/lib/bank-actions";
import type { ChoicesUpdate, Choices, RenderBox } from "@/lib/built-resume-actions";
import type { ApplicantProfile } from "@/lib/profile-actions";
import { linkText } from "@/lib/profile-links";

/**
 * The editor's reading of the bank and one resume's choices (KAN-218): what
 * a selected box points at, what waits in the tray, and the PATCH body for a
 * move. The API's view (backend `resume_view.py`) decides what the PDF shows;
 * this only mirrors its order rule, by position and then the bank's order,
 * to number siblings for a move.
 */

/** The profile columns the resume's header prints; a header box's `kind`. */
export type HeaderField =
  | "full_name"
  | "phone_number"
  | "email"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "other_url";
export type Header = Pick<ApplicantProfile, HeaderField>;

export type Line =
  | { kind: "bullet"; entry: BankEntry; bullet: Bullet }
  | { kind: "entry"; entry: BankEntry; field: string }
  | { kind: "skill"; skill: Skill }
  | { kind: "header"; field: HeaderField };

/** A line from the bank: what the assistant and the tray act on. */
export type BankLine = Exclude<Line, { kind: "header" }>;

/** The header's lines come from the profile, not the bank (the API's
 *  `HEADER` item id). */
export const HEADER = "header";

/** The header's link fields, in the order the header prints them. */
export const LINK_FIELDS = ["linkedin_url", "github_url", "portfolio_url", "other_url"] as const;

/** A typed field's text as the field shows it, and the change typed text
 *  makes, or null when it makes none (a required field left empty, a GPA
 *  that is not a number). */
type Codec<T, P> = { read: (from: T) => string; write: (text: string) => P | null };
type EntryPatch = Partial<Omit<EntryFields, "section">>;

const plain = <F extends string>(field: F, required = false) => ({
  read: (from: Partial<Record<F, string | null>>) => from[field] ?? "",
  write: (text: string) =>
    required && !text ? null : ({ [field]: text || null } as Record<F, string | null>),
});

/** A detail line that prints after a label ("GPA: 3.8/4.0"): the field
 *  shows the label too, so it covers the line as printed, and typing drops
 *  it again. An empty value prints no line, so it shows no label. */
function labelled(
  label: string,
  codec: Codec<BankEntry, EntryPatch>,
): Codec<BankEntry, EntryPatch> {
  // The label as printed, or one damaged while typing ("Relevant Coursewok:"),
  // which would otherwise save into the value: text before the first colon
  // that starts with the label's first word
  const prefix = new RegExp(`^\\s*${label.split(" ")[0]}[^:]{0,30}:\\s*`, "i");
  return {
    read: (e) => {
      const value = codec.read(e);
      return value && `${label}: ${value}`;
    },
    write: (text) => codec.write(text.replace(prefix, "").trim()),
  };
}

/** A number as the API's `fields._number` prints it: 3.80 as "3.8", 4 as "4.0". */
function gpaNumber(value: number) {
  const text = String(value);
  return text.includes(".") ? text : `${text}.0`;
}

/** The GPA as the API's `fields.gpa` prints it, the scale as precise as the
 *  score: "3.81/4.00", "3.8/4.0". */
export function gpaText(gpa: number, scale: number | null) {
  const score = gpaNumber(gpa);
  if (scale == null) return score;
  const places = score.split(".")[1].length;
  const plain = gpaNumber(scale);
  const fixed = scale.toFixed(places);
  return `${score}/${fixed.length > plain.length ? fixed : plain}`;
}

/** The entry fields typed in place; they change the bank (user story 61). */
export const ENTRY_CODECS: Record<string, Codec<BankEntry, EntryPatch>> = {
  title: plain("title", true) as Codec<BankEntry, EntryPatch>,
  organization: plain("organization"),
  location: plain("location"),
  honors: labelled("Honors", {
    read: (e) => e.honors ?? "",
    write: (text) => ({ honors: text || null }),
  }),
  coursework: labelled("Relevant Coursework", {
    read: (e) => e.coursework.join(", "),
    write: (text) => ({
      coursework: text
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    }),
  }),
  gpa: labelled("GPA", {
    read: (e) => (e.gpa == null ? "" : gpaText(e.gpa, e.gpa_scale)),
    write: (text) => {
      if (!text) return { gpa: null, gpa_scale: null };
      const m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/.exec(text);
      return m ? { gpa: Number(m[1]), gpa_scale: m[2] ? Number(m[2]) : null } : null;
    },
  }),
};

const link = (field: (typeof LINK_FIELDS)[number]): Codec<Header, Partial<Header>> => ({
  read: (h) => (h[field] ? linkText(h[field]) : ""),
  write: (text) => ({
    [field]: !text ? null : /^https?:\/\//i.test(text) ? text : `https://${text}`,
  }),
});

/** The header fields typed in place; they change the profile. The email is
 *  the profile's contact email, else the sign-in address, so it is set on
 *  My Profile, not typed here. */
export const HEADER_CODECS: Partial<Record<HeaderField, Codec<Header, Partial<Header>>>> = {
  full_name: plain("full_name", true) as Codec<Header, Partial<Header>>,
  phone_number: plain("phone_number"),
  ...Object.fromEntries(LINK_FIELDS.map((f) => [f, link(f)])),
};

/** True when the line's text is typed in place. */
export function typed(line: Line) {
  if (line.kind === "bullet") return true;
  if (line.kind === "entry") return line.field in ENTRY_CODECS;
  if (line.kind === "header") return line.field in HEADER_CODECS;
  return false;
}

/** What the line is, for a heading: the entry's title, the skill, or the
 *  header field. */
export function lineName(line: Line) {
  if (line.kind === "skill") return line.skill.name;
  if (line.kind === "header") return "Header";
  return line.entry.title;
}

export function lineOf(bank: Bank, box: Pick<RenderBox, "item_id" | "kind">): Line | null {
  if (box.item_id === HEADER) return { kind: "header", field: box.kind as HeaderField };
  if (box.kind === "skill") {
    const skill = bank.skills.find((s) => s.id === box.item_id);
    return skill ? { kind: "skill", skill } : null;
  }
  for (const entry of bank.entries) {
    if (box.kind === "bullet") {
      const bullet = entry.bullets.find((b) => b.id === box.item_id);
      if (bullet) return { kind: "bullet", entry, bullet };
    } else if (entry.id === box.item_id) {
      return { kind: "entry", entry, field: box.kind };
    }
  }
  return null;
}

/** The text a bullet shows on this resume: its variant's, else the bank's. */
export function wording(choices: Choices, bullet: Bullet) {
  return choices.bullets.find((c) => c.bullet_id === bullet.id)?.text ?? bullet.text;
}

/** Shown siblings in resume order: by position, ties in bank order. */
function ordered<T extends { id: string }>(
  items: T[],
  choice: (id: string) => { shown: boolean; position: number } | undefined,
): T[] {
  return items
    .map((item, i) => ({ item, i, c: choice(item.id) }))
    .filter((x) => x.c?.shown)
    .sort((a, b) => a.c!.position - b.c!.position || a.i - b.i)
    .map((x) => x.item);
}

/** The PATCH that moves a line one place up (-1) or down (1) among its
 *  shown siblings, renumbering them all so ties can never stall a move; null
 *  at either end. Entries move within their section, bullets within their
 *  entry. */
export function move(bank: Bank, choices: Choices, line: Line, by: -1 | 1): ChoicesUpdate | null {
  if (line.kind === "skill" || line.kind === "header") return null;
  const siblings =
    line.kind === "bullet"
      ? ordered(line.entry.bullets, (id) => choices.bullets.find((c) => c.bullet_id === id))
      : ordered(
          bank.entries.filter((e) => e.section === line.entry.section),
          (id) => choices.entries.find((c) => c.entry_id === id),
        );
  const id = line.kind === "bullet" ? line.bullet.id : line.entry.id;
  const at = siblings.findIndex((s) => s.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= siblings.length) return null;
  const order = siblings.map((s) => s.id);
  [order[at], order[to]] = [order[to], order[at]];
  return line.kind === "bullet"
    ? { bullets: order.map((bullet_id, position) => ({ bullet_id, position })) }
    : { entries: order.map((entry_id, position) => ({ entry_id, position })) };
}

export type TrayItem =
  | { kind: "entry"; entry: BankEntry }
  | { kind: "bullet"; entry: BankEntry; bullet: Bullet; text: string }
  | { kind: "skill"; skill: Skill };

/** "Not on This Resume": bank entries with no row or hidden, hidden bullets
 *  of the entries that show (a hidden entry's bullets come back with it),
 *  and hidden skills. Each comes back with one click. */
export function tray(bank: Bank, choices: Choices): TrayItem[] {
  const entry = new Map(choices.entries.map((c) => [c.entry_id, c]));
  const bullet = new Map(choices.bullets.map((c) => [c.bullet_id, c]));
  const skill = new Map(choices.skills.map((c) => [c.skill_id, c]));
  const items: TrayItem[] = [];
  for (const e of bank.entries) {
    if (!entry.get(e.id)?.shown) {
      items.push({ kind: "entry", entry: e });
      continue;
    }
    for (const b of e.bullets) {
      const c = bullet.get(b.id);
      if (!c?.shown) items.push({ kind: "bullet", entry: e, bullet: b, text: c?.text ?? b.text });
    }
  }
  for (const s of bank.skills) if (!skill.get(s.id)?.shown) items.push({ kind: "skill", skill: s });
  return items;
}

/** The PATCH that puts a tray item back on the resume. */
export function putBack(item: TrayItem): ChoicesUpdate {
  if (item.kind === "entry") return { entries: [{ entry_id: item.entry.id, shown: true }] };
  if (item.kind === "bullet") return { bullets: [{ bullet_id: item.bullet.id, shown: true }] };
  return { skills: [{ skill_id: item.skill.id, shown: true }] };
}

/** The page-count chip: "1 page", or "2 pages · 3 lines over 1 page". */
/** The phone's short count, "3 lines over" (or "2 pages" with no estimate),
 *  for its top bar beside the back arrow. */
export function shortPageLabel(pages: number, linesOver: number) {
  return linesOver > 0
    ? `${linesOver} ${linesOver === 1 ? "line" : "lines"} over`
    : `${pages} pages`;
}

export function pageLabel(pages: number, linesOver: number) {
  if (pages <= 1) return "1 page";
  const over =
    linesOver > 0 ? ` · ${linesOver} ${linesOver === 1 ? "line" : "lines"} over 1 page` : "";
  return `${pages} pages${over}`;
}
