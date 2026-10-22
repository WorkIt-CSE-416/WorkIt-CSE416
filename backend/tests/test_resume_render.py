'''
The renderer's tests (KAN-204, KAN-207, spec seam 3): render a fixed view of
Jake's sample with real Tectonic, read the PDF's text back with pdfminer, and
check what a hiring system would read, the page count, and the missing-character
warning. CI installs Tectonic, and where `CI` is set these tests fail rather than
skip when it is missing.
'''

import hashlib
import io
import os
import shutil
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest
from pdfminer.high_level import extract_text
from pdfminer.pdfpage import PDFPage

from app.services import resume_render
from app.services.resume_render import (
    TEMPLATE,
    TectonicUnavailable,
    compile_pdf,
    escape,
    jakes_document,
    render,
)
from app.services.resume_render.jakes import body as jakes_body
from app.services.resume_render.sample import IDENTITY, VIEW
from app.services.resume_view import ResumeView, ViewBullet, ViewEntry, ViewSection

# jakes.tex from the KAN-176 prototype, byte for byte. A change here is a
# change to Jake's template itself: don't
JAKES_TEX_SHA256 = "c673cb35b525347452428b710a0acb4c17858cade15f6b673c8b70784d08b60b"


def _tectonic_or_skip() -> None:
    try:
        compile_pdf(jakes_document("x"))
    except TectonicUnavailable as exc:
        if os.environ.get("CI"):
            raise
        pytest.skip(f"tectonic not set up ({exc}); run python3 scripts/fetch_tectonic.py")


def _text(pdf: bytes) -> str:
    # Plain text, no layout: the PDF is untagged (ADR 0002)
    return " ".join(extract_text(io.BytesIO(pdf)).split())


def _pages(pdf: bytes) -> int:
    return sum(1 for _ in PDFPage.get_pages(io.BytesIO(pdf)))


def test_jakes_preamble_is_byte_for_byte() -> None:
    assert hashlib.sha256(TEMPLATE.read_bytes()).hexdigest() == JAKES_TEX_SHA256
    preamble = TEMPLATE.read_text(encoding="utf-8").split("%%BODY%%")[0]
    assert jakes_document(r"\section{X}").startswith(preamble)


def test_jakes_sample_renders_as_one_page_with_its_text() -> None:
    _tectonic_or_skip()
    rendered = render(VIEW, IDENTITY, "jakes")

    assert rendered.page_count == 1
    assert _pages(rendered.pdf) == 1
    assert rendered.missing_characters == ()
    text = _text(rendered.pdf)
    # pdfminer reads the right-hand column (places, dates) as its own block,
    # so each field is checked alone, not a whole row
    for expected in (
        "Jake Ryan",
        "123-456-7890 | jake@su.edu | linkedin.com/in/jake | github.com/jake",
        "Education",
        "Southwestern University",
        "Bachelor of Arts in Computer Science, Minor in Business",
        "Aug. 2018 – May 2021",
        "GPA: 3.8/4.0",
        "Undergraduate Research Assistant",
        "June 2020 – Present",
        "Texas A&M University",
        "College Station, TX",
        "Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems",
        "Gitlytics | Python, Flask, React, PostgreSQL, Docker",
        "Implemented GitHub OAuth to get data from user’s repositories",
        "Technical Skills",
        "Languages: Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS, R",
        "Libraries: pandas, NumPy, Matplotlib",
    ):
        assert expected in text


def _with_entries(view: ResumeView, *entries: ViewEntry) -> ResumeView:
    return replace(view, sections=(*view.sections, ViewSection("leadership", entries)))


def test_a_resume_past_one_page_reports_its_page_count() -> None:
    _tectonic_or_skip()
    bullets = tuple(ViewBullet(uuid.uuid4(), f"Led weekly meeting number {i} for the robotics club") for i in range(30))
    long = _with_entries(VIEW, ViewEntry(uuid.uuid4(), "leadership", "President", organization="Robotics Club",
                                         bullets=bullets))

    rendered = render(long, IDENTITY, "jakes")
    assert rendered.page_count == 2
    assert _pages(rendered.pdf) == 2
    assert "Leadership & Activities" in _text(rendered.pdf)


def test_characters_the_font_lacks_are_reported_once_each() -> None:
    _tectonic_or_skip()
    view = _with_entries(VIEW, ViewEntry(uuid.uuid4(), "leadership", "Президент клуба 中文", organization="José"))

    rendered = render(view, replace(IDENTITY, name="Jake Ryan 中"), "jakes")
    # In the order the page meets them: the name, then the entry
    assert rendered.missing_characters == (
        "中", "П", "р", "е", "з", "и", "д", "н", "т", "к", "л", "у", "б", "а", "文",
    )
    # Accented Latin is in the font
    assert "é" not in rendered.missing_characters


def _link_targets(pdf: bytes) -> list[str]:
    from pypdf import PdfReader

    page = PdfReader(io.BytesIO(pdf)).pages[0]
    return [a.get_object()["/A"]["/URI"] for a in page.get("/Annots", []) if "/A" in a.get_object()]


def test_header_links_with_underscores_and_tildes_stay_clickable() -> None:
    _tectonic_or_skip()
    links = ("https://github.com/john_doe", "https://cs.example.edu/~jdoe/a%20b#top")
    identity = replace(IDENTITY, email="john_doe@example.com",
                       links=(("github_url", links[0]), ("other_url", links[1])))

    pdf = render(VIEW, identity, "jakes").pdf

    assert set(_link_targets(pdf)) >= {"mailto:john_doe@example.com", *links}
    assert "github.com/john_doe" in _text(pdf)
    assert "cs.example.edu/~jdoe" in _text(pdf)


def test_an_unknown_template_is_refused() -> None:
    with pytest.raises(ValueError):
        render(VIEW, IDENTITY, "no-such-template")


def test_escaped_text_prints_literally_and_runs_nothing() -> None:
    _tectonic_or_skip()
    hostile = "\\input{/etc/passwd}\n\nR&D 100% $5 #1 snake_case ~ ^ <b> a|b"
    pdf = compile_pdf(jakes_document(escape(hostile)))

    text = _text(pdf)
    assert "\\input{/etc/passwd} R&D 100% $5 #1 snake_case ~ ^ <b> a|b" in text
    assert "root:" not in text


def _content_streams(pdf: bytes) -> list[bytes]:
    from pypdf import PdfReader

    return [page.get_contents().get_data() for page in PdfReader(io.BytesIO(pdf)).pages]


def _long_view() -> ResumeView:
    bullets = tuple(ViewBullet(uuid.uuid4(), f"Led weekly meeting number {i} for the robotics club") for i in range(30))
    return _with_entries(VIEW, ViewEntry(uuid.uuid4(), "leadership", "President", organization="Robotics Club",
                                         location="Georgetown, TX", bullets=bullets))


@pytest.mark.parametrize("view", [VIEW, _long_view()], ids=["one page", "two pages"])
def test_position_markers_leave_the_page_unchanged(view) -> None:
    # The preview must be the file that downloads (ADR 0002): the markers
    # that place the editor's click targets may not move one glyph
    from app.services.resume_render import compile_document, jakes

    _tectonic_or_skip()
    marked = compile_document(jakes_document(jakes.body(view, IDENTITY)))
    plain = compile_document(jakes_document(jakes.body(view, IDENTITY, marks=False)))

    assert marked.boxes and not plain.boxes
    assert _content_streams(marked.pdf) == _content_streams(plain.pdf)


def _text_lines(pdf: bytes) -> list[tuple[str, int, tuple[float, float, float, float]]]:
    '''Each text line pdfminer finds: (text, page, (x0, top, x1, bottom)) in
    PDF points from the page's top left, like a box.'''
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar, LTTextContainer, LTTextLine

    lines = []
    for number, page in enumerate(extract_pages(io.BytesIO(pdf)), start=1):
        for element in page:
            if isinstance(element, LTTextContainer):
                for line in element:
                    # The list's bullet glyph is the template's, not the line's
                    chars = [c for c in line if isinstance(c, LTChar) and c.get_text() not in "• "] \
                        if isinstance(line, LTTextLine) else []
                    if chars:
                        x0, x1 = min(c.x0 for c in chars), max(c.x1 for c in chars)
                        y0, y1 = min(c.y0 for c in chars), max(c.y1 for c in chars)
                        text = line.get_text().strip().removeprefix("• ")
                        lines.append((text, number, (x0, page.height - y1, x1, page.height - y0)))
    return lines


def _inside(inner, box, slack=1.5) -> bool:
    x0, top, x1, bottom = inner
    return (box.x0 - slack <= x0 and x1 <= box.x1 + slack
            and box.y0 - slack <= top and bottom <= box.y1 + slack)


def _line(lines, text):
    return next((page, bbox) for t, page, bbox in lines if t.startswith(text))


def test_render_gives_a_box_for_each_line_the_editor_can_select() -> None:
    _tectonic_or_skip()
    rendered = render(VIEW, IDENTITY, "jakes")
    boxes = {(b.item_id, b.kind): b for b in rendered.boxes}
    assert len(boxes) == len(rendered.boxes)  # one box for each

    school = VIEW.sections[0].entries[0]
    assert {kind for item, kind in boxes if item == str(school.id)} == {"title", "location", "degree", "dates", "gpa"}
    job = VIEW.sections[1].entries[0]
    assert {kind for item, kind in boxes if item == str(job.id)} == {"title", "organization", "location", "dates"}
    project = VIEW.sections[2].entries[0]
    assert {kind for item, kind in boxes if item == str(project.id)} == {"title", "organization", "dates"}
    every_bullet = {str(b.id) for s in VIEW.sections for e in s.entries for b in e.bullets}
    assert {item for item, kind in boxes if kind == "bullet"} == every_bullet
    assert {item for item, kind in boxes if kind == "skill"} == {str(s.id) for s in VIEW.skills}
    assert all(b.page == 1 and 0 <= b.x0 < b.x1 <= 612 and 0 <= b.y0 < b.y1 <= 792 for b in rendered.boxes)

    # Each box covers its text where pdfminer, reading the PDF on its own,
    # finds it. Places and dates are pdfminer's own lines
    lines = _text_lines(rendered.pdf)
    _, bbox = _line(lines, "Southwestern University")
    assert _inside(bbox, boxes[(str(school.id), "title")])
    _, bbox = _line(lines, "Georgetown, TX")
    assert _inside(bbox, boxes[(str(school.id), "location")])
    _, bbox = _line(lines, "June 2020 – Present")
    assert _inside(bbox, boxes[(str(job.id), "dates")])
    first = job.bullets[0]
    _, bbox = _line(lines, first.text[:30])
    assert _inside(bbox, boxes[(str(first.id), "bullet")])


def test_the_header_gives_a_box_for_each_profile_field() -> None:
    _tectonic_or_skip()
    rendered = render(VIEW, IDENTITY, "jakes")
    boxes = {b.kind: b for b in rendered.boxes if b.item_id == "header"}

    assert set(boxes) == {"full_name", "phone_number", "email", "linkedin_url", "github_url"}
    lines = _text_lines(rendered.pdf)
    for kind, text in [("full_name", "Jake Ryan"), ("phone_number", "123-456-7890"),
                       ("email", "jake@su.edu"), ("github_url", "github.com/jake")]:
        bbox = next(bbox for t, _, bbox in lines if text in t)
        box = boxes[kind]
        if kind == "full_name":
            assert _inside(bbox, box)
        else:
            # The contact line is one pdfminer line, its "|" taller than the
            # text, so a field's box sits inside it rather than around it
            assert box.y0 < bbox[3] and bbox[1] < box.y1
            assert bbox[0] - 1.5 <= box.x0 and box.x1 <= bbox[2] + 1.5


def test_the_header_says_us_citizen_only_when_checked() -> None:
    assert "U.S. Citizen" not in jakes_body(VIEW, IDENTITY)
    # Last on the contact line, after the links
    assert r"\underline{github.com/jake}} $|$ U.S. Citizen" in jakes_body(
        VIEW, replace(IDENTITY, us_citizen=True), marks=False)
    _tectonic_or_skip()
    rendered = render(VIEW, replace(IDENTITY, us_citizen=True), "jakes")
    assert any("U.S. Citizen" in t for t, _, _ in _text_lines(rendered.pdf))
    # No box: the editor cannot type it
    assert {b.kind for b in rendered.boxes if b.item_id == "header"} == {
        "full_name", "phone_number", "email", "linkedin_url", "github_url"}


def test_a_wrapped_bullet_box_covers_both_lines() -> None:
    _tectonic_or_skip()
    long = ViewBullet(uuid.uuid4(), "Mentored twelve first-year students in data structures and algorithms each "
                                    "week, and wrote practice problems that the course staff later adopted for exams")
    view = _with_entries(VIEW, ViewEntry(uuid.uuid4(), "leadership", "Tutor", organization="Learning Center",
                                         bullets=(long,)))
    rendered = render(view, IDENTITY, "jakes")
    (box,) = [b for b in rendered.boxes if b.item_id == str(long.id)]

    lines = _text_lines(rendered.pdf)
    _, first = _line(lines, "Mentored twelve")
    second = next(bbox for text, _, bbox in lines if "course staff" in text or "for exams" in text)
    assert second[1] > first[1]  # it did wrap
    assert _inside(first, box) and _inside(second, box)


def test_boxes_on_the_second_page_say_so() -> None:
    _tectonic_or_skip()
    view = _long_view()
    rendered = render(view, IDENTITY, "jakes")

    last = view.sections[-1].entries[0].bullets[-1]
    (box,) = [b for b in rendered.boxes if b.item_id == str(last.id)]
    assert box.page == 2
    _, bbox = next((p, bbox) for t, p, bbox in _text_lines(rendered.pdf) if t == last.text and p == 2)
    assert _inside(bbox, box)


@pytest.fixture
def read_only_vendor(tmp_path, monkeypatch):
    '''A vendored binary without its execute bit and a cache the process
    cannot write, as in a Vercel Function, with /tmp under tmp_path.'''
    vendor = tmp_path / "vendor"
    (vendor / "cache" / "fonts").mkdir(parents=True)
    for i in range(50):
        (vendor / "cache" / "fonts" / f"{i}.otf").write_bytes(os.urandom(4096))
    (vendor / "tectonic").write_bytes(b"#!/bin/sh\n")
    (vendor / "tectonic").chmod(0o644)
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    monkeypatch.setattr(resume_render, "VENDOR", vendor)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp))
    real_access = os.access
    monkeypatch.setattr(
        resume_render.os, "access",
        lambda path, mode: False if Path(path).parent == vendor else real_access(path, mode),
    )
    return vendor, tmp


def test_concurrent_renders_share_one_complete_cache_copy(read_only_vendor) -> None:
    vendor, tmp = read_only_vendor
    with ThreadPoolExecutor(8) as pool:
        copies = list(pool.map(lambda _: resume_render._cache(), range(16)))
    assert set(copies) == {tmp / "workit-tectonic-cache"}
    assert sorted(p.name for p in (copies[0] / "fonts").iterdir()) == sorted(
        p.name for p in (vendor / "cache" / "fonts").iterdir()
    )
    # No staging folder is left behind
    assert [p.name for p in tmp.iterdir()] == ["workit-tectonic-cache"]


def test_a_failed_cache_copy_leaves_nothing_and_the_next_one_works(read_only_vendor, monkeypatch) -> None:
    _, tmp = read_only_vendor
    real_copytree = shutil.copytree

    def dies_partway(src, dst, **kwargs):
        Path(dst).mkdir()
        (Path(dst) / "half").write_text("x")
        raise OSError("disk full")

    monkeypatch.setattr(resume_render.shutil, "copytree", dies_partway)
    with pytest.raises(TectonicUnavailable):
        resume_render._cache()
    assert list(tmp.iterdir()) == []

    monkeypatch.setattr(resume_render.shutil, "copytree", real_copytree)
    assert (resume_render._cache() / "fonts").is_dir()


def test_a_binary_without_its_execute_bit_runs_from_an_executable_copy(read_only_vendor) -> None:
    _, tmp = read_only_vendor
    with ThreadPoolExecutor(8) as pool:
        copies = set(pool.map(lambda _: resume_render._binary(), range(16)))
    assert copies == {tmp / "workit-tectonic"}
    assert os.access(tmp / "workit-tectonic", os.X_OK)


def test_the_word_file_says_us_citizen_when_checked() -> None:
    from docx import Document

    from app.services.resume_render.word import render_docx

    doc = Document(io.BytesIO(render_docx(VIEW, replace(IDENTITY, us_citizen=True))))
    assert doc.paragraphs[1].text.endswith(" | U.S. Citizen")


def test_an_unchecked_header_hashes_as_before_the_check_box() -> None:
    from app.services.sent_resumes import _identity

    # A resume sent before the field existed still matches its repeat
    assert "us_citizen" not in _identity(IDENTITY)
    assert _identity(replace(IDENTITY, us_citizen=True))["us_citizen"] is True
