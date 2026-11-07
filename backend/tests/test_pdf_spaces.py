"""KAN-303: a visible gap between two words reads as a space.

A PDF shows a space as a character or as a gap. pypdf drops some gaps: one
under half a space (layout mode rounds it to none), a small TJ kern (plain
mode wants half a space), and a gap after a run that pypdf never moved past
(a font change inside one text block). Each PDF here is built by hand, one
way of drawing "scanning 2,000+"; Chrome PDFs kept every space.

XeTeX PDFs kept every space twice: their fonts draw no space glyph, so pypdf
guesses a space's width, and each word gap read as a column gap (the second
part, below)."""
from io import BytesIO

from app.services.resume_render import render
from app.services.resume_render.sample import IDENTITY, VIEW
from app.services.text_extraction import extract_pdf_text
from app.utils.resume_parser import parse_resume
from tests.test_resume_render import _tectonic_or_skip

SIZE = 10
SPACE, GLYPH = 278, 556  # Helvetica-like widths, 1/1000 em
WORD = 8 * GLYPH * SIZE / 1000  # "scanning" in points
# Latin Modern's word spaces, 1/1000 em: regular, bold, and after a period
# that ends a sentence, where TeX adds a third
TEX_SPACE, TEX_BOLD_SPACE, TEX_PERIOD_SPACE, TEX_BOLD_PERIOD_SPACE = 333, 383, 444, 511


def _font(base: str) -> str:
    widths = " ".join(str(SPACE if c == 32 else GLYPH) for c in range(32, 127))
    return (f"<< /Type /Font /Subtype /Type1 /BaseFont /{base} /FirstChar 32 "
            f"/LastChar 126 /Widths [{widths}] /Encoding /WinAnsiEncoding >>")


def _xetex_font(base: str, descendant: int, width: int) -> list[str]:
    """A font as xdvipdfmx writes it (Tectonic, Overleaf's XeLaTeX): two-byte
    glyph ids, no space glyph (TeX spaces words with kerns), and /DW 280, from
    which pypdf guessed a space of 0.14 em. Glyph id = character code, and
    object 10 is the ToUnicode map they share."""
    return [
        (f"<< /Type /Font /Subtype /Type0 /BaseFont /{base} /Encoding /Identity-H "
         f"/DescendantFonts [{descendant} 0 R] /ToUnicode 10 0 R >>"),
        (f"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /{base} "
         "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
         f"/DW 280 /W [33 [{' '.join([str(width)] * 94)}]] >>"),
    ]


_TO_UNICODE = """/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange <0021> <007E> <0021> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end"""


def _stream(data: str) -> str:
    return f"<< /Length {len(data)} >>\nstream\n{data}\nendstream"


def _pdf(stream: str) -> bytes:
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font "
         "<< /F1 4 0 R /F2 5 0 R /T1 6 0 R /T2 8 0 R >> >> /Contents 11 0 R >>"),
        _font("Helvetica"),
        _font("Helvetica-Bold"),
        *_xetex_font("LMRoman10-Regular", 7, 500),
        *_xetex_font("LMRoman10-Bold", 9, 575),
        _stream(_TO_UNICODE),
        _stream(stream),
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


def test_a_non_breaking_space_is_a_space():
    # Google Docs kept one in a resume's name, where the parser's spaces
    # never match it (ftfy keeps it too)
    text = _text(_line("(TEST\\240PERSON) Tj"))
    assert "TEST PERSON" in text
    assert "\xa0" not in text


# --- word spaces in XeTeX PDFs ---
# Tectonic (WorkIt's own resumes) and Overleaf's XeLaTeX write PDFs through
# xdvipdfmx, whose fonts draw no space glyph: pypdf guessed 0.14 em from their
# /DW 280, so each TeX word space (0.33 em) read as two spaces, which the
# parser reads as a column gap. The text checks below keep the spaces as
# extracted, never `_words`.

def _cid(text: str) -> str:
    return "<" + "".join(f"{ord(c):04X}" for c in text) + ">"


def _kerned(words: str, space: int = TEX_SPACE) -> str:
    return f" {-space} ".join(_cid(word) for word in words.split())


def _tj(words: str, space: int = TEX_SPACE) -> str:
    """Words as TeX shows them: one TJ array, a kern for each space."""
    return f"[{_kerned(words, space)}] TJ"


def _tex_line(words: str, y: int, right: str = "", font: str = "/T1",
              space: int = TEX_SPACE, x: int = 72) -> str:
    """A line of words, and maybe a date or a city set at the right after a
    column gap, as \\hfill sets them, in the regular font."""
    shows = _tj(words, space) + (f" /T1 {SIZE} Tf 400 0 Td {_tj(right)}" if right else "")
    return f"BT {font} {SIZE} Tf {x} {y} Td {shows} ET"


def _tex_text(*lines: str) -> str:
    return extract_pdf_text(_pdf("\n".join(lines))) or ""


BULLET = "* Built 12 dashboards in Python and SQL"


def test_a_tex_word_space_is_one_space():
    text = _tex_text(_tex_line("Bachelor of Science in Computer Science", 700), _tex_line(BULLET, 686))
    assert "Bachelor of Science in Computer Science" in text
    assert BULLET in text


def test_a_column_gap_after_tex_words_stays_two_spaces():
    text = _tex_text(_tex_line("Data Analyst Intern", 700, right="Stony Brook, NY"), _tex_line(BULLET, 686))
    assert "Data Analyst Intern  Stony Brook, NY" in text


def test_a_wider_space_after_a_period_is_one_space():
    dates = f"[{_cid('Aug.')} {-TEX_PERIOD_SPACE} {_cid('2024')}] TJ"
    text = _tex_text(f"BT /T1 {SIZE} Tf 72 700 Td {dates} ET", _tex_line(BULLET, 686))
    assert "Aug. 2024" in text


def test_each_font_keeps_its_own_word_space():
    # bold Latin Modern spaces its words 0.38 em, and 0.51 after "St.":
    # measured against the regular font's 0.33, that read as a column gap
    johns = _cid("John's")
    school = f"[{_cid('St.')} {-TEX_BOLD_PERIOD_SPACE} {johns} {-TEX_BOLD_SPACE} {_cid('University')}] TJ"
    text = _tex_text(f"BT /T2 {SIZE} Tf 72 700 Td {school} ET",
                     _tex_line("Bachelor of Science in Computer Science", 686), _tex_line(BULLET, 672))
    assert "St. John's University" in text


def test_tex_words_reach_the_parser_whole():
    # the field of study read "Computer", and the city "Brook, NY" with
    # "Stony" left on the title
    text = _tex_text(
        _tex_line("EDUCATION", 760, font="/T2"),
        _tex_line("Example State University", 746, right="Stony Brook, NY", font="/T2", space=TEX_BOLD_SPACE),
        _tex_line("Bachelor of Science in Computer Science", 732, right="Aug 2024 - May 2028"),
        _tex_line("EXPERIENCE", 712, font="/T2"),
        _tex_line("Example Analytics", 698, right="Jan 2025 - May 2025", font="/T2", space=TEX_BOLD_SPACE),
        _tex_line("Data Analyst Intern", 684, right="Stony Brook, NY"),
        _tex_line(BULLET, 670),
    )
    parsed = parse_resume(text)
    assert parsed and parsed.education and parsed.experience
    assert parsed.education[0].field_of_study == "Computer Science"
    assert (parsed.experience[0].title, parsed.experience[0].location) == ("Data Analyst Intern", "Stony Brook, NY")


def test_a_two_column_xetex_resume_reads_by_column_with_its_words_whole():
    # plain mode reads column by column, and read the kern that tightens "T"
    # against "e" (0.095 em) as a space: "T echnical Skills" was no heading
    left = [_tex_line(words, y, font=font) for words, y, font in (
        ("EXPERIENCE", 740, "/T2"), ("Example Analytics", 726, "/T2"), ("Data Analyst Intern", 712, "/T1"),
        (BULLET, 698, "/T1"), ("* Cleaned a customer table before a CRM move", 684, "/T1"),
        ("EDUCATION", 656, "/T2"), ("Example State University", 642, "/T2"),
        ("Bachelor of Science in Computer Science", 628, "/T1"))]
    skills = f"[{_cid('T')} 95 {_cid('echnical')} {-TEX_BOLD_SPACE} {_cid('Skills')}] TJ"
    tools = f"[{_cid('T')} 95 {_cid('ools:')} {-TEX_SPACE} {_kerned('Git, Tableau, Excel')}] TJ"
    right = [f"BT /T2 {SIZE} Tf 330 740 Td {skills} ET", f"BT /T1 {SIZE} Tf 330 726 Td {tools} ET",
             _tex_line("Languages: Python, SQL, R", 712, x=330)]
    lines = _tex_text(*left, *right).splitlines()
    assert "Technical Skills" in lines
    assert "Tools: Git, Tableau, Excel" in lines
    assert "EXPERIENCE" in lines


def test_a_resume_workit_rendered_reads_back_one_space_a_word():
    # the real thing: Jake's template through Tectonic, as a student who
    # uploads a resume WorkIt made sends it back
    _tectonic_or_skip()
    text = extract_pdf_text(render(VIEW, IDENTITY, "jakes").pdf)
    assert "Southwestern University  Georgetown, TX" in text
    assert "Bachelor of Arts in Computer Science, Minor in Business  Aug. 2018 – May 2021" in text
    assert "Information Technology Support Specialist  Sep. 2018 – Present" in text
