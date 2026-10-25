// A written answer as a one-page-or-more PDF, for a form that takes it only as
// an upload (an optional cover letter): plain text in Helvetica, wrapped to the
// page, no library, perhaps under the student's name and contact line, as
// their resume heads itself. Uses no chrome.* (the tests import it as is).

const PAGE = { width: 612, height: 792, margin: 72 }; // US Letter, 1 inch margins
const SIZE = 11;
const LEADING = 15;
// The header: the name, larger, over the contact line, centred; it takes four of the letter's lines on page one.
const NAME_SIZE = 20;
const CONTACT_SIZE = 10;
const HEADER_LINES = 4;

// Helvetica's advance widths (per 1000 units) for ASCII 32-126, from its AFM.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// The characters past Latin-1 that WinAnsiEncoding holds, with their codes and widths.
const WIN_ANSI = { "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333], "”": [0x94, 333], "•": [0x95, 350],
  "–": [0x96, 556], "—": [0x97, 1000], "…": [0x85, 1000], "€": [0x80, 556] };

/** The character as one WinAnsi byte, and its width; "?" for one Helvetica can't show. */
function glyph(ch) {
  const code = ch.codePointAt(0);
  if (code >= 32 && code <= 126) return [ch, WIDTHS[code - 32]];
  if (WIN_ANSI[ch]) return [String.fromCharCode(WIN_ANSI[ch][0]), WIN_ANSI[ch][1]];
  if (code >= 0xa0 && code <= 0xff) return [ch, 556];
  return ["?", 556];
}

const width = (text, size = SIZE) => [...text].reduce((sum, ch) => sum + glyph(ch)[1], 0) * size / 1000;

/** The text's lines, each paragraph wrapped to the page's width; a blank line between paragraphs stays. */
function lines(text) {
  const room = PAGE.width - 2 * PAGE.margin;
  const out = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > room) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** A PDF string literal: WinAnsi bytes, with \, ( and ) escaped. */
const literal = (text) => `(${[...text].map((ch) => glyph(ch)[0]).join("").replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** A line centred on the page with its top `down` points below the margin. */
function centred(text, size, down) {
  const x = ((PAGE.width - width(text, size)) / 2).toFixed(2);
  return `BT /F1 ${size} Tf ${x} ${PAGE.height - PAGE.margin - down} Td ${literal(text)} Tj ET`;
}

/**
 * `text` as a PDF, base64: as many Letter pages as it needs, the first
 * headed by `header` when given (the student's name over their contact line).
 * @param {string} text
 * @param {{ name?: string, contact?: string }} [header]
 * @returns {string}
 */
export function letterPdf(text, header) {
  const perPage = Math.floor((PAGE.height - 2 * PAGE.margin) / LEADING);
  const headed = Boolean(header?.name || header?.contact);
  const all = lines(text);
  const pages = [];
  for (let i = 0, room = perPage - (headed ? HEADER_LINES : 0); i < all.length; i += room, room = perPage) pages.push(all.slice(i, i + room));
  if (!pages.length) pages.push([]);
  // Objects: 1 catalog, 2 page tree, 3 font, then each page and its content.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  for (const [i, page] of pages.entries()) {
    const top = i === 0 && headed ? [
      header.name && centred(header.name, NAME_SIZE, NAME_SIZE),
      header.contact && centred(header.contact, CONTACT_SIZE, NAME_SIZE + 15),
    ].filter(Boolean) : [];
    const down = SIZE + (top.length ? HEADER_LINES * LEADING : 0);
    const body = [...top, `BT /F1 ${SIZE} Tf ${LEADING} TL ${PAGE.margin} ${PAGE.height - PAGE.margin - down} Td`, ...page.map((l) => `${literal(l)} Tj T*`), "ET"].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return btoa(pdf);
}
