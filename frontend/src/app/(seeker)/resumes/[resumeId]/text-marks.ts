/**
 * Bold and italic in a bullet's wording (KAN-435): `**` and `*` around the
 * words, kept in the resume's own wording, as the API reads them
 * (`resume_view.runs`, the same pattern). A marker needs a letter beside it,
 * so "5 * 3" and a lone "*" stay what they are.
 */
const MARK =
  /\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*|\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=[^\s*])(.+?)(?<=[^\s*])\*/g;

export type Run = { text: string; bold: boolean; italic: boolean };

/** A marked wording as runs of words, in order. */
export function runs(text: string, bold = false, italic = false): Run[] {
  const found: Run[] = [];
  let done = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > done) found.push({ text: text.slice(done, match.index), bold, italic });
    const stars = match[1] ? 3 : match[2] ? 2 : 1;
    found.push(...runs(match[1] ?? match[2] ?? match[3], bold || stars > 1, italic || stars !== 2));
    done = match.index + match[0].length;
  }
  if (done < text.length) found.push({ text: text.slice(done), bold, italic });
  return found;
}

/** The words alone, for anywhere that lists a bullet in plain text. */
export function unmarked(text: string) {
  return runs(text)
    .map((run) => run.text)
    .join("");
}

/** Runs as a marked wording. Runs of one look join, and spaces stay outside
 *  the markers, which need a letter beside them. */
export function markedOf(parts: Run[]) {
  const letters = parts.flatMap(({ text, bold, italic }) =>
    [...text].map((letter) => ({ letter, bold, italic })),
  );
  const words = (from: number, to: number) =>
    letters
      .slice(from, to)
      .map((l) => l.letter)
      .join("");
  let text = "";
  for (let at = 0; at < letters.length;) {
    const { bold, italic } = letters[at];
    let stop = at;
    while (letters[stop]?.bold === bold && letters[stop]?.italic === italic) stop++;
    let from = at;
    let to = stop;
    while (from < to && !letters[from].letter.trim()) from++;
    while (to > from && !letters[to - 1].letter.trim()) to--;
    const stars = from < to ? "*".repeat((bold ? 2 : 0) + (italic ? 1 : 0)) : "";
    text += words(at, from) + stars + words(from, to) + stars + words(to, stop);
    at = stop;
  }
  return text;
}

/** What an open field holds, as a marked wording. Each piece's weight is read
 *  from its style, so it does not matter which tags the browser wrote. */
export function readMarked(field: HTMLElement) {
  const found: Run[] = [];
  const pieces = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  while (pieces.nextNode()) {
    const style = getComputedStyle(pieces.currentNode.parentElement as Element);
    found.push({
      // The browser writes a space at a line's end as a no-break space
      text: (pieces.currentNode.nodeValue ?? "").replaceAll("\u00a0", " "),
      bold: Number(style.fontWeight) >= 600,
      italic: style.fontStyle === "italic",
    });
  }
  return markedOf(found);
}

/** Puts a marked wording in an open field, unless it holds that already: a
 *  field rewritten on every keystroke would lose its caret. */
export function showMarked(field: HTMLElement, text: string) {
  if (readMarked(field) === text) return;
  field.replaceChildren(
    ...runs(text).map((run) => {
      const words = document.createTextNode(run.text);
      const slanted = document.createElement("i");
      const heavy = document.createElement("b");
      slanted.append(words);
      heavy.append(run.italic ? slanted : words);
      return run.bold ? heavy : run.italic ? slanted : words;
    }),
  );
}
