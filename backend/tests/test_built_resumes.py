"""
Seam-1 tests for Generate (KAN-207): base resumes through the API on real
Postgres. Content is read back from the Word download, which needs no
Tectonic; the PDF render's own tests are in test_resume_render.py, and the
render route's tests below skip without Tectonic (backend/CLAUDE.md, Tests).
"""

import uuid

import httpx
import pytest
from sqlalchemy import text

from app.deps import get_current_account
from app.main import app
from app.schemas.auth import AccountType, AuthenticatedAccount

pytestmark = pytest.mark.anyio


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name, phone_number, github_url)"
            " VALUES (:id, :email, 'Sam Seeker', '555-010-2030', 'https://github.com/samseeker')"
        ),
        {"id": applicant_id, "email": f"sam{applicant_id.hex[:6]}@example.com"},
    )
    await session.commit()
    return applicant_id


def _sign_in(applicant_id: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant_id,
        email="sam@example.com",
        full_name="Sam Seeker",
        account_type=AccountType.APPLICANT,
        onboarding_completed=True,
    )


@pytest.fixture
async def student(database):
    """A signed-in applicant and an API client. Yields (client, applicant URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, f"/applicants/{applicant_id}"
    finally:
        app.dependency_overrides.pop(get_current_account, None)


async def test_generate_makes_a_base_resume_the_list_reads_back(student):
    client, me = student
    res = await client.post(f"{me}/built-resumes", json={"name": "General SWE"})

    assert res.status_code == 201
    made = res.json()
    assert made["name"] == "General SWE"
    assert made["template"] == "jakes"
    assert made["job_posting_id"] is None
    assert made["is_default"] is False

    listed = (await client.get(f"{me}/built-resumes")).json()
    assert [(r["id"], r["name"]) for r in listed] == [(made["id"], "General SWE")]


async def _fill_bank(client, me) -> None:
    """Entries posted out of order, so the resume's order is the bank's."""
    bank = f"{me}/bank"
    for body in (
        {"section": "projects", "title": "WorkIt", "organization": "CSE 416", "start_month": "2026-01",
         "end_kind": "present", "bullets": ["Built a resume builder with FastAPI"]},
        {"section": "experience", "title": "Tutor", "organization": "Campus Center", "location": "Stony Brook, NY",
         "start_month": "2023-09", "end_month": "2024-05", "bullets": ["Tutored 40 students in calculus"]},
        {"section": "experience", "title": "Software Intern", "organization": "Acme", "location": "New York, NY",
         "start_month": "2025-06", "end_month": "2025-08",
         "bullets": ["Cut page load time by 30%", "Wrote the billing service's tests"]},
        {"section": "education", "title": "Stony Brook University", "location": "Stony Brook, NY",
         "degree": "Bachelor of Science", "field_of_study": "Computer Science", "gpa": 3.8, "gpa_scale": 4.0,
         "coursework": ["Data Structures", "Algorithms"], "start_month": "2023-08",
         "end_kind": "expected", "end_month": "2027-05"},
        {"section": "awards", "title": "Dean's List", "organization": "Stony Brook University", "award_date": "2024-12"},
    ):
        assert (await client.post(f"{bank}/entries", json=body)).status_code == 201
    for skill in ({"name": "Python", "group": "Languages"}, {"name": "Docker", "group": "Tools"}):
        assert (await client.post(f"{bank}/skills", json=skill)).status_code == 201


def _docx_lines(content: bytes) -> list[str]:
    from io import BytesIO

    from docx import Document

    return [p.text for p in Document(BytesIO(content)).paragraphs if p.text.strip()]


async def _generate(client, me, name="Base Resume") -> str:
    res = await client.post(f"{me}/built-resumes", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_the_word_file_has_every_entry_in_section_order_newest_first(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me, "General SWE")

    res = await client.get(f"{me}/built-resumes/{resume_id}/docx")
    assert res.status_code == 200
    assert res.headers["content-disposition"] == 'attachment; filename="General SWE.docx"'
    assert _docx_lines(res.content) == [
        "Sam Seeker",
        f"555-010-2030 | sam{me.split('/')[2].replace('-', '')[:6]}@example.com | github.com/samseeker",
        "EDUCATION",
        "Stony Brook University\tStony Brook, NY",
        "Bachelor of Science in Computer Science\tAug. 2023 – Expected May 2027",
        "GPA: 3.8/4.0",
        "Relevant Coursework: Data Structures, Algorithms",
        "EXPERIENCE",
        "Software Intern\tJune 2025 – Aug. 2025",
        "Acme\tNew York, NY",
        "Cut page load time by 30%",
        "Wrote the billing service's tests",
        "Tutor\tSep. 2023 – May 2024",
        "Campus Center\tStony Brook, NY",
        "Tutored 40 students in calculus",
        "PROJECTS",
        "WorkIt | CSE 416\tJan. 2026 – Present",
        "Built a resume builder with FastAPI",
        "AWARDS",
        "Dean's List | Stony Brook University\tDec. 2024",
        "TECHNICAL SKILLS",
        "Languages: Python",
        "Tools: Docker",
    ]


async def test_the_word_file_is_letter_size(student):
    from io import BytesIO

    from docx import Document
    from docx.shared import Inches

    client, me = student
    resume_id = await _generate(client, me)
    section = Document(BytesIO((await client.get(f"{me}/built-resumes/{resume_id}/docx")).content)).sections[0]
    assert (section.page_width, section.page_height) == (Inches(8.5), Inches(11))


async def test_a_bank_fix_shows_but_a_new_entry_waits_off_the_resume(student):
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)
    bank = (await client.get(f"{me}/bank")).json()
    tutor = next(e for e in bank["entries"] if e["title"] == "Tutor")

    # A typo fixed in the bank shows on the resume (a live view)...
    await client.patch(f"{me}/bank/bullets/{tutor['bullets'][0]['id']}", json={"text": "Tutored 45 students in calculus"})
    # ...but an entry, bullet or skill added after Generate has no choice row.
    await client.post(f"{me}/bank/entries", json={"section": "experience", "title": "Barista", "organization": "Cafe"})
    await client.post(f"{me}/bank/entries/{tutor['id']}/bullets", json={"text": "Ran review sessions"})
    await client.post(f"{me}/bank/skills", json={"name": "Rust", "group": "Languages"})

    lines = _docx_lines((await client.get(f"{me}/built-resumes/{resume_id}/docx")).content)
    assert "Tutored 45 students in calculus" in lines
    assert "Tutored 40 students in calculus" not in lines
    assert not any("Barista" in line or "Rust" in line or "Ran review sessions" in line for line in lines)

    # A resume made now has them all.
    fresh = _docx_lines((await client.get(f"{me}/built-resumes/{await _generate(client, me)}/docx")).content)
    assert "Barista" in fresh and "Ran review sessions" in fresh and "Languages: Python, Rust" in fresh


class _FakeBucket:
    def upload(self, path, contents, options):
        return {"path": path}

    def remove(self, paths):
        return []


class _FakeSupabase:
    class storage:
        @staticmethod
        def from_(bucket):
            return _FakeBucket()


async def _upload(client, me):
    files = {"file": ("resume.pdf", b"%PDF-1.4 not really a pdf", "application/pdf")}
    return await client.post(f"{me}/resumes", files=files)


async def test_five_resumes_uploaded_and_base_together_and_no_sixth(student, monkeypatch):
    monkeypatch.setattr("app.routers.resumes.get_supabase", lambda: _FakeSupabase())
    monkeypatch.setattr("app.routers.resumes._extract", _no_text)
    client, me = student
    for _ in range(2):
        assert (await _upload(client, me)).status_code == 200
    built = [await _generate(client, me) for _ in range(3)]

    res = await client.post(f"{me}/built-resumes", json={})
    assert res.status_code == 409
    assert "5 resumes" in res.json()["detail"]
    res = await _upload(client, me)
    assert res.status_code == 409
    assert "5 resumes" in res.json()["detail"]

    # Deleting one makes room again.
    assert (await client.delete(f"{me}/built-resumes/{built[0]}")).status_code == 204
    assert (await client.post(f"{me}/built-resumes", json={})).status_code == 201


async def _no_text(contents, ext):
    return ""


async def test_a_tailored_resume_does_not_count_toward_the_five(student, database):
    client, me = student
    applicant_id = uuid.UUID(me.split("/")[2])
    async with database() as session:
        posting = await session.scalar(
            text(
                "INSERT INTO job_postings (id, title, status, company_name, apply_url) VALUES"
                " (gen_random_uuid(), 'Intern', 'published', 'Acme', 'https://example.com/apply') RETURNING id"
            )
        )
        await session.execute(
            text(
                "INSERT INTO built_resumes (applicant_id, name, template, job_posting_id)"
                " VALUES (:a, 'Tailored', 'jakes', :p)"
            ),
            {"a": applicant_id, "p": posting},
        )
        await session.commit()
    for _ in range(5):
        await _generate(client, me)
    assert (await client.post(f"{me}/built-resumes", json={})).status_code == 409


async def test_the_default_resume_is_an_uploaded_or_a_base_resume(student, monkeypatch):
    monkeypatch.setattr("app.routers.resumes.get_supabase", lambda: _FakeSupabase())
    monkeypatch.setattr("app.routers.resumes._extract", _no_text)
    client, me = student
    uploaded = (await _upload(client, me)).json()["id"]
    built = await _generate(client, me)

    assert (await client.put(f"{me}/resumes/{uploaded}/default")).status_code == 200
    assert (await client.put(f"{me}/built-resumes/{built}/default")).status_code == 200
    assert [r["is_default"] for r in (await client.get(f"{me}/built-resumes")).json()] == [True]
    assert [r["is_default"] for r in (await client.get(f"{me}/resumes")).json()] == [False]

    assert (await client.put(f"{me}/resumes/{uploaded}/default")).status_code == 200
    assert [r["is_default"] for r in (await client.get(f"{me}/built-resumes")).json()] == [False]
    assert [r["is_default"] for r in (await client.get(f"{me}/resumes")).json()] == [True]

    # Deleting the default base resume leaves no default.
    await client.put(f"{me}/built-resumes/{built}/default")
    await client.delete(f"{me}/built-resumes/{built}")
    assert [r["is_default"] for r in (await client.get(f"{me}/resumes")).json()] == [False]


async def test_another_students_built_resumes_are_out_of_reach(student, database):
    client, me = student
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    theirs = await _generate(client, f"/applicants/{other}")
    _sign_in(uuid.UUID(me.split("/")[2]))

    assert (await client.get(f"/applicants/{other}/built-resumes")).status_code == 403
    assert (await client.post(f"/applicants/{other}/built-resumes", json={})).status_code == 403
    for path in ("docx", "render"):
        assert (await client.get(f"{me}/built-resumes/{theirs}/{path}")).status_code == 404
    assert (await client.put(f"{me}/built-resumes/{theirs}/default")).status_code == 404
    assert (await client.delete(f"{me}/built-resumes/{theirs}")).status_code == 404


def _tectonic_or_skip() -> None:
    from tests.test_resume_render import _tectonic_or_skip as check

    check()


def _pdf_text(encoded: str) -> str:
    import base64
    import io

    from pdfminer.high_level import extract_text

    return " ".join(extract_text(io.BytesIO(base64.b64decode(encoded))).split())


async def test_generate_then_render_gives_a_one_page_pdf_with_the_bank(student):
    _tectonic_or_skip()
    client, me = student
    await _fill_bank(client, me)
    resume_id = await _generate(client, me)

    res = await client.get(f"{me}/built-resumes/{resume_id}/render")
    assert res.status_code == 200
    body = res.json()
    assert body["page_count"] == 1
    assert body["missing_characters"] == []
    text = _pdf_text(body["pdf"])
    for expected in ("Sam Seeker", "Stony Brook University", "Software Intern", "Cut page load time by 30%",
                     # TeX's font mapping prints a straight apostrophe curly
                     "Dean’s List | Stony Brook University", "Languages: Python"):
        assert expected in text


async def test_render_reports_a_long_resume_and_the_characters_the_font_lacks(student):
    _tectonic_or_skip()
    client, me = student
    bullets = [f"Organized event number {i} for two hundred members of the society" for i in range(30)]
    for title in ("Президент", "Treasurer"):
        res = await client.post(f"{me}/bank/entries", json={"section": "leadership", "title": title,
                                                            "organization": "Chess Society", "bullets": bullets})
        assert res.status_code == 201
    resume_id = await _generate(client, me)

    body = (await client.get(f"{me}/built-resumes/{resume_id}/render")).json()
    assert body["page_count"] == 2
    assert body["missing_characters"] == ["П", "р", "е", "з", "и", "д", "н", "т"]


async def test_render_answers_503_when_tectonic_is_missing(student, monkeypatch):
    from app.services.resume_render import TectonicUnavailable

    def missing(view, identity, template):
        raise TectonicUnavailable("no tectonic binary")

    monkeypatch.setattr("app.routers.built_resumes.render", missing)
    client, me = student
    resume_id = await _generate(client, me)

    res = await client.get(f"{me}/built-resumes/{resume_id}/render")
    assert res.status_code == 503
    assert res.json() == {"detail": "The PDF could not be made. Try again, or download the Word file."}


async def test_recommendations_still_work_when_the_default_is_a_base_resume(student, database, monkeypatch):
    async def no_embedding(texts):
        return None

    monkeypatch.setattr("app.services.matching.embeddings.embed", no_embedding)
    client, me = student
    applicant_id = uuid.UUID(me.split("/")[2])
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO resumes (id, applicant_id, original_filename, storage_path, status, parsed_json)"
                " VALUES (gen_random_uuid(), :a, 'r.pdf', 'x/r.pdf', 'parsed', :p)"
            ),
            {"a": applicant_id, "p": '{"education": [], "experience": [], "skills": [], "projects": [], "certifications": []}'},
        )
        await session.commit()
    built = await _generate(client, me)
    await client.put(f"{me}/built-resumes/{built}/default")

    # Until the recommender reads the bank (KAN-212), it scores against the
    # newest parsed upload, as Scout does.
    assert (await client.get(f"/jobs/recommended/{applicant_id}")).status_code == 200
