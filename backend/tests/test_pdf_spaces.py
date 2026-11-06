"""KAN-303: a visible gap between two words reads as a space.

A PDF shows a space as a character or as a gap. pypdf drops some gaps: one
under half a space (layout mode rounds it to none), a small TJ kern (plain
mode wants half a space), and a gap after a run that pypdf never moved past
(a font change inside one text block). Each PDF here is built by hand, one
way of drawing "scanning 2,000+"; LaTeX and Chrome PDFs kept every space."""
from io import BytesIO

from app.services.text_extraction import extract_pdf_text
from app.utils.resume_parser import parse_resume

SIZE = 10
SPACE, GLYPH = 278, 556  # Helvetica-like widths, 1/1000 em
WORD = 8 * GLYPH * SIZE / 1000  # "scanning" in points


def _font(base: str) -> str:
    widths = " ".join(str(SPACE if c == 32 else GLYPH) for c in range(32, 127))
    return (f"<< /Type /Font /Subtype /Type1 /BaseFont /{base} /FirstChar 32 "
            f"/LastChar 126 /Widths [{widths}] /Encoding /WinAnsiEncoding >>")


def _pdf(stream: str) -> bytes:
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
         "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"),
        _font("Helvetica"),
        _font("Helvetica-Bold"),
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    ]
    out = BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def _line(shows: str, y: int = 700) -> str:
    return f"BT /F1 {SIZE} Tf 72 {y} Td {shows} ET"


def _text(*lines: str) -> str:
    # a second line, so layout mode has more than one line to lay out
    stream = "\n".join([*lines, _line("(Reduced latency by forty percent.) Tj", 686)])
    return extract_pdf_text(_pdf(stream)) or ""


def _words(text: str) -> str:
    return " ".join(text.split())


# --- gaps that are spaces ---

def test_a_small_kern_is_a_space():
    # a tenth of an em: plain mode wants half a space, layout mode rounds to 0
    assert "scanning 2,000+" in _words(_text(_line("[(scanning) -100 (2,000+)] TJ")))


def test_a_gap_after_a_font_change_is_a_space():
    # pypdf never moves past "scanning", so the kern after Tf measured from
    # the line's start and both modes glued the words
    text = _text(_line(f"(scanning) Tj /F2 {SIZE} Tf [-333 (2,000+)] TJ"))
    assert "scanning 2,000+" in _words(text)


def test_half_a_space_between_placed_words_is_a_space():
    # Word and Canva place words one by one; layout mode rounds 0.5 to 0
    second = 72 + WORD + SPACE * SIZE / 1000 / 2
    text = _text(f"BT /F1 {SIZE} Tf 72 700 Td (scanning) Tj ET",
                 f"BT /F1 {SIZE} Tf {second:.2f} 700 Td (2,000+) Tj ET")
    assert "scanning 2,000+" in _words(text)


def test_each_gap_on_a_line_is_restored_in_order():
    text = _text(_line("[(Automated) -100 (scanning) -100 (2,000+) -100 (records)] TJ"))
    assert "Automated scanning 2,000+ records" in _words(text)


def test_a_restored_space_reaches_the_parsed_bullet():
    text = _text(
        _line("(EXPERIENCE) Tj", 760),
        _line("(Acme Corp    June 2025 - Aug 2025) Tj", 740),
        _line("(Data Intern) Tj", 726),
        _line(f"(* Automated) Tj [-278 (scanning)] TJ /F2 {SIZE} Tf [-333 (2,000+)] TJ "
              f"/F1 {SIZE} Tf [-333 (records)] TJ", 712),
    )
    parsed = parse_resume(text)
    assert parsed and parsed.experience
    assert "Automated scanning 2,000+ records" in parsed.experience[0].description


# --- gaps that are not spaces ---

def test_a_space_character_stays_one_space():
    assert "scanning 2,000+" in _text(_line("(scanning 2,000+) Tj"))


def test_a_kern_that_tightens_adds_no_space():
    assert "World" in _words(_text(_line("[(W) 80 (orld)] TJ")))


def test_a_hairline_gap_adds_no_space():
    # glyph positioning rounds by a few hundredths of an em
    assert "2,000+" in _words(_text(_line("[(2,) -30 (000+)] TJ")))


def test_a_word_split_into_pieces_never_splits_another_word():
    # pdfTeX breaks a word into runs at its kerns: "over" came as "o" and
    # "ver", and the gap before it made ("with", "o") a pair that turned
    # "without" on Xiang's resume into "with out"
    text = _text(_line("[(with) -150 (o) 20 (ver) -333 (it)] TJ"),
                 _line("(without warning) Tj", 672))
    assert "with over it" in _words(text)
    assert "without warning" in _words(text)


def test_a_gap_before_closing_punctuation_adds_no_space():
    # Word placed a comma, and pdfTeX a closing bracket, a little apart
    # (team resumes: "JavaScript ," and "(Protobuf )"), under the half space
    # at which pypdf itself adds one
    text = _text(_line("[(JavaScript) -100 (,) -333 (Python) -333 (\\() -100 (Protobuf) -100 (\\))] TJ"))
    assert "JavaScript, Python (Protobuf)" in _words(text)


def test_a_raised_run_adds_no_space():
    # a superscript sits off the baseline: "1st", not "1 st"
    assert "1st" in _words(_text(_line("(1) Tj 4 Ts [-100 (st)] TJ 0 Ts")))
