"""Text a page draws inside Form XObjects reads once, where it shows.

A Google Docs resume on the shared test account had been through an editor
built on MuPDF, which deleted a band across the page by drawing the whole
page twice, as two forms each boxed to the part it shows. pypdf's plain mode
read the resume twice (every entry imported twice), and its layout mode read
nothing. Each PDF here is built by hand: one page of made-up resume drawn as
a form (`FULL`), placed by the page in different ways."""
from io import BytesIO

from app.services.text_extraction import extract_pdf_text
from app.utils.resume_parser import parse_resume

FONT = ("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 "
        f"/Widths [278 {' '.join(['556'] * 94)}] /Encoding /WinAnsiEncoding >>")
BAND = "The band the editor deleted"


def _line(y: int, words: str, right: str = "") -> str:
    """A line of text, and maybe a date or a city set at the right."""
    return f"BT /F1 10 Tf 72 {y} Td ({words}) Tj" + (f" 378 0 Td ({right}) Tj" if right else "") + " ET"


FULL = "\n".join([
    _line(740, "EXPERIENCE"),
    _line(726, "Acme Corp", "Stony Brook, NY"),
    _line(712, "Data Analyst Intern", "Jan 2025 - May 2025"),
    _line(698, "* Built a parser that reads resumes"),
    _line(394, BAND),
    _line(380, "EDUCATION"),
    _line(366, "Example State University", "Aug 2024 - May 2028"),
    _line(352, "Bachelor of Science in Computer Science"),
])


def _stream(data: str, entries: str = "") -> str:
    return f"<< {entries} /Length {len(data)} >>\nstream\n{data}\nendstream"


def _form(data: str, resources: str, box: str = "0 0 612 792", matrix: str = "1 0 0 1 0 0") -> str:
    return _stream(data, f"/Type /XObject /Subtype /Form /BBox [{box}] /Matrix [{matrix}] /Resources << {resources} >>")


def _pdf(content: str, resources: str, *objs: str) -> bytes:
    """A one-page PDF: the page's content and resources, then objects 5 on."""
    objs = (
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << {resources} >> /Contents 4 0 R >>",
        _stream(content),
        *objs,
    )
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


def _drawn_twice() -> bytes:
    # MuPDF's two forms: the top one shows the page above the band; the
    # bottom one shows it below the band, moved up over it
    full = "/XObject << /Full 7 0 R >>"
    return _pdf("q /Top Do Q q /Bottom Do Q", "/XObject << /Top 5 0 R /Bottom 6 0 R >>",
                _form("/Full Do", full, box="0 400 612 792"),
                _form("/Full Do", full, box="0 0 612 388", matrix="1 0 0 1 0 12"),
                _form(FULL, "/Font << /F1 8 0 R >>"),
                FONT)


def test_a_page_drawn_twice_in_two_boxes_reads_once():
    text = extract_pdf_text(_drawn_twice())
    for line in ("EXPERIENCE", "Acme Corp", "* Built a parser", "EDUCATION", "Bachelor of Science"):
        assert text.count(line) == 1, line
    assert text.index("EXPERIENCE") < text.index("EDUCATION")


def test_text_outside_every_box_is_not_read():
    # the band lies in neither form's box: the page never shows it
    assert BAND not in extract_pdf_text(_drawn_twice())


def test_a_page_drawn_twice_imports_each_entry_once():
    parsed = parse_resume(extract_pdf_text(_drawn_twice()))
    assert parsed and len(parsed.experience) == 1 and len(parsed.education) == 1


def test_a_form_reads_with_its_column_gaps():
    # layout mode now reads the forms: plain mode joins a city onto the
    # company with one space, and the parser needs the gap to tell them apart
    assert "Acme Corp  Stony Brook, NY" in extract_pdf_text(_drawn_twice())


def test_a_page_wrapped_whole_in_one_form_reads_as_the_page_itself():
    drawn = _pdf(FULL, "/Font << /F1 5 0 R >>", FONT)
    wrapped = _pdf("q /Full Do Q", "/XObject << /Full 5 0 R >>", _form(FULL, "/Font << /F1 6 0 R >>"), FONT)
    assert extract_pdf_text(wrapped) == extract_pdf_text(drawn)


def test_a_form_it_cannot_read_leaves_the_page_as_it_was():
    # a box of two numbers: the page's own text still reads
    page = _line(740, "EXPERIENCE") + "\nq /Odd Do Q"
    pdf = _pdf(page, "/Font << /F1 5 0 R >> /XObject << /Odd 6 0 R >>", FONT,
               _form(_line(700, "Inside the odd form"), "/Font << /F1 5 0 R >>", box="0 0"))
    assert "EXPERIENCE" in extract_pdf_text(pdf)
