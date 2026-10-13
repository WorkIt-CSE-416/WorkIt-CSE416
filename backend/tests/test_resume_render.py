'''
The renderer's tests (KAN-204, KAN-207, spec seam 3): render a fixed view of
Jake's sample with real Tectonic, read the PDF's text back with pdfminer, and
check what an ATS would read, the page count, and the missing-character
warning. CI installs Tectonic, and where `CI` is set these tests fail rather than
skip when it is missing.
'''

import hashlib
import io
import os
import uuid
from dataclasses import replace

import pytest
from pdfminer.high_level import extract_text
from pdfminer.pdfpage import PDFPage

from app.services.resume_render import (
    TEMPLATE,
    TectonicUnavailable,
    compile_pdf,
    escape,
    jakes_document,
    render,
)
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
