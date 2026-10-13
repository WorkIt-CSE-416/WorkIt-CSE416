'''
The template text test (KAN-204, spec seam 3): render Jake's Resume with real
Tectonic, read the PDF's text back with pdfminer, and check what an ATS would
read. CI installs Tectonic and sets REQUIRE_TECTONIC=1, so there these tests
fail rather than skip when it is missing.
'''

import hashlib
import io
import os

import pytest
from fastapi.testclient import TestClient
from pdfminer.high_level import extract_text
from pdfminer.pdfpage import PDFPage

from app.main import app
from app.services.resume_render import (
    TEMPLATE,
    TectonicUnavailable,
    compile_pdf,
    escape,
    jakes_document,
)

# jakes.tex from the KAN-176 prototype, byte for byte. A change here is a
# change to Jake's template itself: don't
JAKES_TEX_SHA256 = "c673cb35b525347452428b710a0acb4c17858cade15f6b673c8b70784d08b60b"


def _tectonic_or_skip() -> None:
    try:
        compile_pdf(jakes_document("x"))
    except TectonicUnavailable as exc:
        if os.environ.get("REQUIRE_TECTONIC"):
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


def test_endpoint_returns_jakes_resume_as_a_one_page_pdf() -> None:
    _tectonic_or_skip()
    response = TestClient(app).get("/render-proof/jakes.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["server-timing"].startswith("render;dur=")
    pdf = response.content
    assert _pages(pdf) == 1
    text = _text(pdf)
    # pdfminer reads the right-hand column (places, dates) as its own block,
    # so each field is checked alone, not a whole row
    for expected in (
        "Jake Ryan",
        "123-456-7890 | jake@su.edu | linkedin.com/in/jake | github.com/jake",
        "Education",
        "Southwestern University",
        "Bachelor of Arts in Computer Science, Minor in Business",
        "Aug. 2018 – May 2021",
        "Undergraduate Research Assistant",
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


def test_escaped_text_prints_literally_and_runs_nothing() -> None:
    _tectonic_or_skip()
    hostile = "\\input{/etc/passwd}\n\nR&D 100% $5 #1 snake_case ~ ^ <b> a|b"
    pdf = compile_pdf(jakes_document(escape(hostile)))

    text = _text(pdf)
    assert "\\input{/etc/passwd} R&D 100% $5 #1 snake_case ~ ^ <b> a|b" in text
    assert "root:" not in text


def test_endpoint_answers_503_when_tectonic_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing(tex: str) -> bytes:
        raise TectonicUnavailable("no tectonic binary")

    monkeypatch.setattr("app.routers.render_proof.compile_pdf", missing)
    response = TestClient(app).get("/render-proof/jakes.pdf")

    assert response.status_code == 503
    assert response.json() == {"detail": "The resume renderer is unavailable."}
