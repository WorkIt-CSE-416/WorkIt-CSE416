'''
Blocks as a PDF, with fpdf2: pure Python, so it runs inside the Vercel
Function, which has no TeX and no system fonts.

The type is CMU Serif (Computer Modern Unicode, SIL OFL 1.1, fonts/OFL.txt),
the face Jake's Resume prints in. It is embedded and subset per file, and
being Unicode it draws names like "José" or "李" that the PDF core fonts
cannot. Sizes and indents follow the LaTeX original (constants below).
'''
import logging
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.services.resume_render.blocks import (
    Block,
    Bullet,
    Contact,
    EntryHeader,
    Heading,
    Name,
    SkillLine,
)

FONTS = Path(__file__).parent / "fonts"
FAMILY = "cmu"
# The LaTeX original's sizes and measures (jakegut/resume: 11pt article,
# \small 10pt, \large 12pt, \Huge 24.88pt, half-inch margins), checked
# against its Overleaf render
BODY = 11
SMALL = 10
HEADING = 12
NAME = 24.88
MARGIN = 36  # half an inch, in points
LINE = 1.2  # line height as a multiple of the font size
# Spacing measured off the Overleaf render, in points: a bullet's line, an
# entry header's two rows, and the gap before each header
BULLET_LINE = 13.9
TITLE_ROW = 14.3
SUB_ROW = 13
ENTRY_GAP = 4
# Entries sit 0.15in in from the heading's rule (leftmargin=0.15in) and end
# 3% of the text width short of it (tabular* 0.97\textwidth)
INDENT = 0.15 * 72
INSET = 0.03 * (612 - 2 * MARGIN) - INDENT
# A bullet's dot 0.37in in, its text 0.47in, as the nested itemize sets them
BULLET_DOT = 0.37 * 72
BULLET_TEXT = 0.47 * 72

# fontTools warns about every table it can't subset (CMU's "TeX " table) on
# each render; the file is fine without it
logging.getLogger("fontTools.subset").setLevel(logging.ERROR)


def _small_caps(pdf: FPDF, text: str, size: float, y: float) -> None:
    '''LaTeX's \\scshape: capitals full size, lower-case letters as smaller
    capitals, on one baseline. fpdf2 has no small caps, so each run is drawn
    at its own size with `text()`, which places a baseline exactly.'''
    x = pdf.l_margin
    for ch in text:
        pdf.set_font_size(size * 0.8 if ch.islower() else size)
        pdf.text(x, y, ch.upper())
        x += pdf.get_string_width(ch.upper())


def _fit(pdf: FPDF, text: str, width: float) -> str:
    '''One line never runs into the text beside it: trim it to the room.'''
    if pdf.get_string_width(text) <= width:
        return text
    while text and pdf.get_string_width(text + "…") > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _row(pdf: FPDF, left: str, right: str, *, italic: bool, size: float, right_size: float,
         h: float, note: str = "") -> None:
    '''One line of an entry's header: `left` (bold, or italic on the second
    row) and `note` after an upright bar, flush left at the indent; `right`
    flush right at the inset.'''
    x, y = pdf.l_margin + INDENT, pdf.get_y()
    width = pdf.epw - INDENT - INSET
    pdf.set_font(FAMILY, "I" if italic else "", right_size)
    right_w = pdf.get_string_width(right) + (8 if right else 0)
    pdf.set_xy(x, y)
    pdf.set_font(FAMILY, "I" if italic else "B", size)
    left = _fit(pdf, left, width - right_w)
    pdf.cell(pdf.get_string_width(left), h, left)
    if note:
        pdf.set_font(FAMILY, "", size)
        pdf.cell(pdf.get_string_width(" | "), h, " | ")
        pdf.set_font(FAMILY, "I", size)
        room = width - right_w - (pdf.get_x() - x)
        pdf.cell(room, h, _fit(pdf, note, room))
    if right:
        pdf.set_font(FAMILY, "I" if italic else "", right_size)
        pdf.set_xy(x, y)
        pdf.cell(width, h, right, align="R")
    pdf.set_xy(pdf.l_margin, y + h)


def write_pdf(blocks: list[Block]) -> tuple[bytes, int]:
    '''The file and how many pages it ran to.'''
    pdf = FPDF(unit="pt", format="letter")
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.set_auto_page_break(True, MARGIN)
    pdf.c_margin = 0  # the LaTeX original has no padding inside a line
    pdf.add_font(FAMILY, "", FONTS / "cmu-serif-regular.ttf")
    pdf.add_font(FAMILY, "B", FONTS / "cmu-serif-bold.ttf")
    pdf.add_font(FAMILY, "I", FONTS / "cmu-serif-italic.ttf")
    pdf.add_font(FAMILY, "BI", FONTS / "cmu-serif-bold-italic.ttf")
    pdf.set_title(next((b.text for b in blocks if isinstance(b, Name)), "Resume"))
    pdf.add_page()

    for block in blocks:
        match block:
            case Name(text):
                # \textbf{\Huge \scshape}: Computer Modern has no bold small
                # caps, so LaTeX prints the name in plain bold, and so does this
                pdf.set_font(FAMILY, "B", NAME)
                pdf.cell(pdf.epw, NAME * 1.1, text, align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            case Contact(items):
                pdf.set_font(FAMILY, "", SMALL)
                sep = " | "
                total = sum(pdf.get_string_width(t) for t, _ in items) + pdf.get_string_width(sep) * (len(items) - 1)
                pdf.set_x((pdf.w - min(total, pdf.epw)) / 2)
                h = SMALL * LINE
                for i, (text, link) in enumerate(items):
                    if i:
                        pdf.set_font(FAMILY, "", SMALL)
                        pdf.cell(pdf.get_string_width(sep), h, sep)
                    pdf.set_font(FAMILY, "U" if link else "", SMALL)
                    pdf.cell(pdf.get_string_width(text), h, text, link=link or "")
                pdf.set_xy(pdf.l_margin, pdf.get_y() + h)
            case Heading(text):
                # Keep a heading with the entry under it
                if pdf.will_page_break(HEADING * 2 + BODY * LINE * 2):
                    pdf.add_page()
                pdf.set_y(pdf.get_y() + 7)
                pdf.set_font(FAMILY, "", HEADING)
                _small_caps(pdf, text, HEADING, pdf.get_y() + HEADING)
                rule = pdf.get_y() + HEADING + 4
                pdf.set_line_width(0.4)
                pdf.line(pdf.l_margin, rule, pdf.w - pdf.r_margin, rule)
                pdf.set_y(rule + 2)
            case EntryHeader(left, right, sub_left, sub_right, note):
                two_rows = bool(sub_left or sub_right)
                if pdf.will_page_break(BODY * LINE * 2 + SMALL * LINE):
                    pdf.add_page()
                pdf.set_y(pdf.get_y() + ENTRY_GAP)
                if two_rows:
                    # \resumeSubheading: bold title and plain date, then the
                    # organization and place in small italics
                    _row(pdf, left, right, italic=False, size=BODY, right_size=BODY, h=TITLE_ROW)
                    _row(pdf, sub_left, sub_right, italic=True, size=SMALL, right_size=SMALL, h=SUB_ROW)
                else:
                    # \resumeProjectHeading: the name and its tools small,
                    # the date full size
                    _row(pdf, left, right, italic=False, size=SMALL, right_size=BODY, h=TITLE_ROW, note=note)
            case Bullet(text):
                pdf.set_font(FAMILY, "", SMALL)
                h = BULLET_LINE
                if pdf.will_page_break(h):
                    pdf.add_page()
                y = pdf.get_y()
                # \tiny\bullet, centred on the line
                pdf.set_font_size(6)
                pdf.text(pdf.l_margin + BULLET_DOT, y + h * 0.72, "•")
                pdf.set_font_size(SMALL)
                pdf.set_xy(pdf.l_margin + BULLET_TEXT, y)
                pdf.multi_cell(pdf.epw - BULLET_TEXT - INSET, h, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            case SkillLine(label, text):
                # Indented like an entry; the label alone is bold
                pdf.set_left_margin(MARGIN + INDENT)
                pdf.set_x(MARGIN + INDENT)
                h = SMALL * LINE
                pdf.set_font(FAMILY, "B", SMALL)
                pdf.write(h, label)
                pdf.set_font(FAMILY, "", SMALL)
                pdf.write(h, f": {text}")
                pdf.ln(h)
                pdf.set_left_margin(MARGIN)

    return bytes(pdf.output()), pdf.page_no()
