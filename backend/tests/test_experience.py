"""
The Experience Bank and the resume builder (KAN-176) without a database: the
two converters, rendering (re-read through our own parser, standing in for an
applicant tracking system), tailoring's reordering, and the routes' guards.
What needs Postgres — the queries, ts_rank — is checked on a throwaway local
one (backend/alembic/CLAUDE.md), as the feed import's database half is.
"""

import uuid
from datetime import date
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError
from workit_scout.testing import RepliesLLM

from app.db import get_session
from app.deps import get_current_account
from app.main import app
from app.models.dto import (
    Activity,
    Award,
    Certification,
    Education,
    EntrySection,
    Experience,
    ParsedResume,
    Project,
    Skill,
)
from app.routers import experience as experience_router
from app.routers.resumes import _extract_docx_text
from app.routers.scout import get_llm, get_scout_settings
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services import tailoring
from app.services.experience import bank_to_resume, bullets_of, resume_to_entries
from app.services.resume_render import jakes, render
from app.utils.resume_parser import parse_resume

RESUME = ParsedResume(
    education=[Education(
        institution="Southwestern University", degree="Bachelor of Arts", field_of_study="Computer Science",
        gpa=3.8, location="Georgetown, TX", start_date=date(2018, 8, 1), end_date=date(2021, 5, 1),
    )],
    experience=[Experience(
        company_name="Texas A&M University", title="Undergraduate Research Assistant",
        location="College Station, TX", start_date=date(2020, 6, 1),
        bullets=["Developed a REST API using FastAPI and PostgreSQL", "Explored ways to visualize GitHub data"],
    )],
    projects=[Project(
        project_name="Gitlytics", url="https://github.com/jake/gitlytics", technologies="Python, Flask, React",
        bullets=["Built a full-stack web application with Flask and React"],
    )],
    activities=[Activity(organization="ACM", role="President", bullets=["Grew membership from 12 to 40"])],
    awards=[Award(award_name="HackTX First Place", issuer="HackTX", end_date=date(2020, 10, 1))],
    certifications=[Certification(cert_name="AWS Cloud Practitioner", issuer="Amazon")],
    skills=[
        Skill(skill_name="Python", category="Languages"),
        Skill(skill_name="Java", category="Languages"),
        Skill(skill_name="React", category="Frameworks"),
    ],
)
def _text(pdf: bytes) -> str:
    """The PDF's text in reading order, as an applicant tracking system reads it.
    Plain mode: LaTeX places words rather than writing spaces, so pypdf's
    layout mode puts two spaces between every word of a LaTeX-made PDF."""
    from pypdf import PdfReader

    return "\n".join(p.extract_text(extraction_mode="plain") for p in PdfReader(BytesIO(pdf)).pages)


CONTACTS = [("123-456-7890", None), ("jake@su.edu", "mailto:jake@su.edu"), ("github.com/jake", "https://github.com/jake")]


# --- the converters -----------------------------------------------------------------


def test_every_section_round_trips_through_the_bank():
    entries, skills = resume_to_entries(RESUME)
    assert {e.section for e in entries} == set(EntrySection)
    back = bank_to_resume(entries, skills)
    assert back.education[0].institution == "Southwestern University"
    assert back.education[0].degree == "Bachelor of Arts" and back.education[0].gpa == 3.8
    assert back.experience[0].bullets == RESUME.experience[0].bullets
    assert back.projects[0].technologies == "Python, Flask, React"
    assert back.projects[0].url == "https://github.com/jake/gitlytics"
    assert back.activities[0].role == "President"
    assert back.awards[0].issuer == "HackTX"
    assert back.certifications[0].cert_name == "AWS Cloud Practitioner"
    assert [s.skill_name for s in back.skills] == ["Python", "Java", "React"]
    # What reads only `description` (Scout's facts, the profile) sees every line
    assert back.experience[0].description == "\n".join(RESUME.experience[0].bullets)


def test_a_resume_stored_before_bullets_existed_still_reads():
    old = {"experience": [{"company_name": "Acme", "title": "Intern", "description": "• Built X\n- Shipped Y\n\n"}]}
    parsed = ParsedResume.model_validate(old)
    assert parsed.activities == [] and parsed.awards == []
    assert bullets_of(parsed.experience[0]) == ["Built X", "Shipped Y"]
    entries, _ = resume_to_entries(parsed)
    assert entries[0].bullets == ["Built X", "Shipped Y"]


def test_education_without_a_degree_is_named_for_its_school():
    entries, _ = resume_to_entries(ParsedResume(education=[Education(institution="Stony Brook University")]))
    assert entries[0].title == "Stony Brook University"


# --- rendering ------------------------------------------------------------------------


def test_jakes_pdf_reads_back_through_the_parser():
    rendered = render(RESUME, name="Jake Ryan", contacts=CONTACTS, template="jakes", fmt="pdf")
    assert rendered.data.startswith(b"%PDF") and rendered.pages == 1
    text = _text(rendered.data)
    # pypdf reads a kerned pair ("AW", "Fr") as two words; spacing aside,
    # every heading is there, as on Jake's own Overleaf PDF
    squeezed = "".join(text.split()).upper()
    for heading in ("Education", "Experience", "Projects", "Leadership&Activities", "Awards", "TechnicalSkills"):
        assert heading.upper() in squeezed
    parsed = parse_resume(text)
    assert parsed.education and parsed.experience and parsed.projects and parsed.skills
    assert any(e.title == "Undergraduate Research Assistant" for e in parsed.experience)


def test_jakes_docx_reads_back_through_the_parser():
    rendered = render(RESUME, name="Jake Ryan", contacts=CONTACTS, template="jakes", fmt="docx")
    parsed = parse_resume(_extract_docx_text(rendered.data))
    assert parsed.education and parsed.experience and parsed.skills


def test_a_degree_that_names_its_field_says_it_once():
    lines = jakes.layout(ParsedResume(education=[Education(
        institution="Stony Brook", degree="Bachelor of Science in Computer Science",
        field_of_study="Computer Science", gpa=3.6)]), "A", [])
    assert any(getattr(b, "sub_left", "") == "Bachelor of Science in Computer Science, GPA 3.6" for b in lines)


def test_a_long_resume_reports_its_second_page():
    long = RESUME.model_copy(deep=True)
    long.experience = [RESUME.experience[0].model_copy(update={"bullets": ["Did a thing"] * 8})] * 8
    assert render(long, name="Jake", contacts=[], template="jakes", fmt="pdf").pages > 1


def test_accented_names_render():
    # Latin Modern (LaTeX) has no Cyrillic or CJK; still open
    # (services/resume_render/CLAUDE.md)
    rendered = render(RESUME, name="José Müller", contacts=[], template="jakes", fmt="pdf")
    assert "José Müller" in _text(rendered.data)


def test_the_pdf_is_jakes_own_latex_when_tectonic_is_here():
    from pypdf import PdfReader

    from app.services.resume_render import to_latex

    try:
        to_latex.tectonic()
    except to_latex.LatexUnavailable:
        pytest.skip("no tectonic on this machine; CI draws with fpdf2")
    data, pages = to_latex.write_latex_pdf(jakes.layout(RESUME, "Jake Ryan", CONTACTS))
    assert PdfReader(BytesIO(data)).metadata["/Producer"].startswith("xdvipdfmx") and pages == 1
    text = _text(data)
    assert "Undergraduate Research Assistant" in text and "Technical Skills" in text
    assert parse_resume(text).experience


def test_a_tectonic_that_cannot_run_falls_back(monkeypatch, tmp_path):
    from app.services.resume_render import to_latex

    broken = tmp_path / "tectonic"
    broken.write_text("not a program")
    broken.chmod(0o755)
    monkeypatch.setenv("TECTONIC_BIN", str(broken))
    monkeypatch.setattr(to_latex, "VENDOR", tmp_path / "none")
    rendered = render(RESUME, name="Jake Ryan", contacts=[], template="jakes", fmt="pdf")
    assert rendered.data.startswith(b"%PDF") and rendered.pages == 1


def test_typed_tex_is_printed_not_run():
    from app.services.resume_render.to_latex import body, escape

    hostile = r"\input{/etc/passwd} 100% & $5 #1 a_b {x} ~ ^"
    assert escape(hostile) == (
        r"\textbackslash{}input\{/etc/passwd\} 100\% \& \$5 \#1 a\_b \{x\} "
        r"\textasciitilde{} \textasciicircum{}"
    )
    tex = body(jakes.layout(ParsedResume(experience=[Experience(company_name="X", title=hostile)]), "A", []))
    assert r"\input{" not in tex


def test_dates_read_as_the_original_prints_them():
    from app.services.resume_render.jakes import span

    assert span(date(2018, 8, 1), date(2021, 5, 1)) == "Aug. 2018 – May 2021"
    assert span(date(2020, 6, 1), None) == "June 2020 – Present"
    assert span(None, date(2019, 7, 1)) == "July 2019"


def test_empty_sections_are_left_out():
    rendered = render(ParsedResume(skills=RESUME.skills), name="Jake", contacts=[], template="jakes", fmt="pdf")
    text = _text(rendered.data).upper()
    assert "TECHNICAL SKILLS" in text and "EXPERIENCE" not in text


# --- tailoring ------------------------------------------------------------------------


def test_reorder_moves_relevant_lines_up_within_their_item_only():
    resume = tailoring.normalized(RESUME)
    first, second = resume.experience[0].bullets
    score = {second: 0.5, first: 0.1}
    out = tailoring.reorder(resume, score, [0, 0, 0.3])
    assert out.experience[0].bullets == [second, first]
    assert out.experience[0].description == f"{second}\n{first}"
    assert [s.skill_name for s in out.skills] == ["React", "Python", "Java"]
    # Nothing dropped, nothing added
    assert sorted(tailoring.lines(out), key=str) != [] and len(tailoring.lines(out)) == len(tailoring.lines(resume))


def test_only_lines_the_posting_mentions_are_reworded():
    resume = tailoring.normalized(RESUME)
    score = {resume.projects[0].bullets[0]: 0.2}
    assert [line.section for line in tailoring.to_reword(resume, score)] == ["projects"]


# --- the routes' guards ---------------------------------------------------------------


def _account(account_type=AccountType.APPLICANT, account_id=None) -> AuthenticatedAccount:
    return AuthenticatedAccount(
        id=account_id or uuid.uuid4(), email="seeker@example.com", full_name="Sam Seeker",
        account_type=account_type, onboarding_completed=True,
    )


@pytest.fixture
def client():
    app.dependency_overrides[get_session] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()


ROUTES = [
    ("get", "/experience", None),
    ("post", "/experience/entries", {"section": "project", "title": "X"}),
    ("put", "/experience/skills", {"skills": []}),
    ("post", "/experience/compose", {"entry_ids": []}),
    ("post", "/experience/ai/intake", {"text": "x"}),
    ("post", "/tailor", {"job_id": str(uuid.uuid4())}),
    ("post", "/resumes/generated", {"resume": {}}),
    ("get", f"/resumes/{uuid.uuid4()}/download", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_routes_need_a_signed_in_owner(client, method, path, body):
    me = uuid.uuid4()
    url = f"/applicants/{me}{path}"
    assert client.request(method, url, json=body).status_code == 401
    app.dependency_overrides[get_current_account] = lambda: _account()  # someone else
    assert client.request(method, url, json=body).status_code == 403
    app.dependency_overrides[get_current_account] = lambda: _account(AccountType.COMPANY, me)
    assert client.request(method, url, json=body).status_code == 403


def test_an_unknown_section_is_refused(client):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(account_id=me)
    res = client.post(f"/applicants/{me}/experience/entries", json={"section": "hobby", "title": "Chess"})
    assert res.status_code == 422


def _bullets_request(client, me):
    return client.post(
        f"/applicants/{me}/experience/ai/bullets",
        json={"entry": {"section": "experience", "title": "Barista", "organization": "Starbucks"},
              "notes": "made coffee"},
    )


def test_ai_bullets(client, monkeypatch):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(account_id=me)
    app.dependency_overrides[get_llm] = lambda: RepliesLLM(["- Made coffee for customers at Starbucks"])
    monkeypatch.setattr(experience_router, "builder_quota", experience_router.DailyQuota())
    res = _bullets_request(client, me)
    assert res.status_code == 200
    assert res.json() == {"bullets": ["Made coffee for customers at Starbucks"]}


def test_ai_bullets_when_the_model_is_down(client, monkeypatch):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(account_id=me)
    request = httpx.Request("POST", "http://primary.test/v1/chat/completions")
    app.dependency_overrides[get_llm] = lambda: RepliesLLM([APIConnectionError(request=request)])
    monkeypatch.setattr(experience_router, "builder_quota", experience_router.DailyQuota())
    res = _bullets_request(client, me)
    assert res.status_code == 503 and "offline" in res.json()["detail"]


def test_ai_calls_share_a_daily_cap(client, monkeypatch):
    me = uuid.uuid4()
    app.dependency_overrides[get_current_account] = lambda: _account(account_id=me)
    app.dependency_overrides[get_llm] = lambda: RepliesLLM(["- Made coffee"] * 3)
    monkeypatch.setattr(experience_router, "builder_quota", experience_router.DailyQuota())
    monkeypatch.setattr(get_scout_settings(), "builder_daily_calls", 2)
    assert [_bullets_request(client, me).status_code for _ in range(3)] == [200, 200, 429]
