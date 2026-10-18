"""
Seam-1 tests for import (KAN-211, ADR 0003) on real Postgres: an upload, and
Import Again, read a resume and write it into the experience bank, merging an
entry the bank already has. The model reads a resume only when the student
asks. backend/CLAUDE.md's Tests section has the setup.
"""

import json
import uuid

import httpx
import pytest
from openai import RateLimitError
from sqlalchemy import text
from workit_scout.testing import ScriptedLLM

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.scripts.import_uploads import backfill
from app.services import bank as bank_service
from app.services.bank_import import read

pytestmark = pytest.mark.anyio

# Starts at the first section header, like the parser fixtures: no contact details.
RESUME_TEXT = """\
Education
Riverside State University  Expected May 2099
B.S. in Mechanical Engineering
•GPA: 3.62
•Coursework: Thermodynamics, Fluid Mechanics, Statics
Experience
Harbor Robotics  Jun 2026 - Aug 2026
Mechanical Engineering Intern  Portland, OR
•Designed a sheet-metal bracket that cut assembly time by 20%
•Ran tolerance stack-up analyses in SolidWorks
Projects
Budget Buddy  Jan 2026 - Mar 2026
https://github.com/example/budget-buddy
•Built a shared expense tracker
Leadership & Activities
Society of Women Engineers  Sep 2025 - Present
Vice President  Riverside, CA
•Organized 12 technical workshops
Awards
Dean's List – Riverside State University  Dec 2025
Certifications
Certified SolidWorks Associate – Dassault Systemes
Skills
•Tools: SolidWorks, MATLAB
"""


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text("INSERT INTO applicant_profiles (id, email, full_name) VALUES (:id, :email, 'Sam Seeker')"),
        {"id": applicant_id, "email": f"{applicant_id.hex[:8]}@example.com"},
    )
    await session.commit()
    return applicant_id


async def _seed_resume(database, applicant_id: uuid.UUID, raw_text: str | None, *, minutes_ago: int = 0) -> uuid.UUID:
    resume_id = uuid.uuid4()
    async with database() as session:
        await session.execute(
            text(
                "INSERT INTO resumes (id, applicant_id, original_filename, storage_path, status, raw_text, created_at)"
                " VALUES (:id, :applicant, 'resume.pdf', :path, 'parsed', :raw,"
                " now() - make_interval(mins => :ago))"
            ),
            {"id": resume_id, "applicant": applicant_id, "path": f"{applicant_id}/{resume_id}.pdf", "raw": raw_text, "ago": minutes_ago},
        )
        await session.commit()
    return resume_id


async def _set_default(database, applicant_id: uuid.UUID, resume_id: uuid.UUID) -> None:
    async with database() as session:
        await session.execute(
            text("UPDATE applicant_profiles SET default_resume_id = :r WHERE id = :a"),
            {"r": resume_id, "a": applicant_id},
        )
        await session.commit()


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
    """A signed-in applicant and an API client. Yields (client, applicant id, bank URL)."""
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client, applicant_id, f"/applicants/{applicant_id}/bank"
    finally:
        app.dependency_overrides.pop(get_current_account, None)



def _summary(entry: dict) -> tuple:
    return (entry["section"], entry["title"], entry["organization"])


def _counts(body: dict) -> tuple:
    return (body["entries_added"], body["entries_updated"], body["skills_added"])


class _Bucket:
    """The Resume bucket, in memory."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.storage = self

    def from_(self, bucket):
        return self

    def upload(self, path, contents, options):
        self.files[path] = contents

    def remove(self, paths):
        self.removed.extend(paths)


@pytest.fixture
def upload(monkeypatch):
    """Uploads a file whose extracted text is the given string. Returns the
    in-memory bucket beside the call."""
    bucket = _Bucket()
    monkeypatch.setattr("app.routers.resumes.get_supabase", lambda: bucket)

    async def send(client, applicant_id, raw_text):
        async def extract(contents, ext):
            return raw_text

        monkeypatch.setattr("app.routers.resumes._extract", extract)
        files = {"file": ("resume.pdf", b"%PDF-1.4 not really a pdf", "application/pdf")}
        return await client.post(f"/applicants/{applicant_id}/resumes", files=files)

    send.bucket = bucket
    return send


# --- upload fills the bank ------------------------------------------------------


async def test_an_upload_writes_its_reading_into_the_bank(student, upload):
    client, applicant_id, bank = student

    res = await upload(client, applicant_id, RESUME_TEXT)
    assert res.status_code == 200
    body = res.json()
    assert "parsed_json" not in body
    assert body["status"] == "parsed"
    assert body["bank"] == {
        "found": 8, "entries_added": 6, "entries_updated": 0, "skills_added": 2, "read_by": "parser", "uses_left": 1,
    }

    saved = (await client.get(bank)).json()
    # The bank's own order: section order, ongoing first, then newest.
    assert [_summary(e) for e in saved["entries"]] == [
        ("education", "Riverside State University", None),
        ("experience", "Mechanical Engineering Intern", "Harbor Robotics"),
        ("projects", "Budget Buddy", None),
        ("leadership", "Vice President", "Society of Women Engineers"),
        ("awards", "Dean's List", "Riverside State University"),
        ("certifications", "Certified SolidWorks Associate", None),
    ]
    education, job, project, club, award, cert = saved["entries"]

    assert (education["degree"], education["field_of_study"], education["gpa"]) == ("B.S", "Mechanical Engineering", 3.62)
    assert education["coursework"] == ["Thermodynamics", "Fluid Mechanics", "Statics"]
    assert (education["end_month"], education["end_kind"]) == ("2099-05", "expected")
    assert education["bullets"] == []

    # The resume's own words, unchanged.
    assert [b["text"] for b in job["bullets"]] == [
        "Designed a sheet-metal bracket that cut assembly time by 20%",
        "Ran tolerance stack-up analyses in SolidWorks",
    ]
    assert (job["location"], job["start_month"], job["end_month"], job["end_kind"]) == (
        "Portland, OR", "2026-06", "2026-08", "month",
    )
    assert project["link"] == "https://github.com/example/budget-buddy"
    assert [b["text"] for b in project["bullets"]] == ["Built a shared expense tracker"]
    assert (club["start_month"], club["end_month"], club["end_kind"]) == ("2025-09", None, "present")
    assert (award["award_date"], award["start_month"], award["end_kind"]) == ("2025-12", None, None)
    assert cert["issuer"] == "Dassault Systemes"
    assert [(s["name"], s["group"]) for s in saved["skills"]] == [("MATLAB", "Tools"), ("SolidWorks", "Tools")]


async def test_a_second_resume_merges_into_the_entries_the_bank_has(student, upload):
    client, applicant_id, bank = student
    # What the student typed, and fixed, before uploading.
    mine = (
        await client.post(
            f"{bank}/entries",
            json={
                "section": "experience",
                "title": "mechanical engineering intern",
                "organization": "HARBOR ROBOTICS",
                "location": "Seattle, WA",
                "bullets": ["Ran tolerance  stack-up analyses in solidworks"],
            },
        )
    ).json()
    await client.post(f"{bank}/skills", json={"name": "matlab"})

    body = (await upload(client, applicant_id, RESUME_TEXT)).json()["bank"]
    assert _counts(body) == (5, 1, 1)

    saved = (await client.get(bank)).json()
    jobs = [e for e in saved["entries"] if e["section"] == "experience"]
    assert [j["id"] for j in jobs] == [mine["id"]]
    job = jobs[0]
    # The student's values stay; what the bank lacked is filled.
    assert (job["title"], job["organization"], job["location"]) == (
        "mechanical engineering intern", "HARBOR ROBOTICS", "Seattle, WA",
    )
    assert (job["start_month"], job["end_month"]) == ("2026-06", "2026-08")
    # The same bullet, in other case and spacing, is not added again.
    assert [b["text"] for b in job["bullets"]] == [
        "Ran tolerance  stack-up analyses in solidworks",
        "Designed a sheet-metal bracket that cut assembly time by 20%",
    ]
    assert sorted(s["name"] for s in saved["skills"]) == ["SolidWorks", "matlab"]


async def test_the_same_resume_twice_adds_nothing_the_second_time(student, upload):
    client, applicant_id, bank = student
    await upload(client, applicant_id, RESUME_TEXT)
    second = (await upload(client, applicant_id, RESUME_TEXT)).json()["bank"]
    assert (second["found"], _counts(second)) == (8, (0, 0, 0))
    assert len((await client.get(bank)).json()["entries"]) == 6


async def test_an_upload_the_parser_cannot_read_adds_nothing_and_never_asks_the_model(student, upload, use_model):
    client, applicant_id, bank = student
    fake = use_model(_reading())

    res = await upload(client, applicant_id, UNREADABLE_TEXT)
    assert res.status_code == 200
    assert res.json()["status"] == "parse_failed"
    assert (res.json()["bank"]["found"], _counts(res.json()["bank"])) == (0, (0, 0, 0))
    assert fake.prompts == []
    assert (await client.get(bank)).json() == {"entries": [], "skills": []}


async def test_a_failed_bank_write_keeps_no_resume_and_no_file(student, upload, monkeypatch):
    client, applicant_id, _ = student

    async def broken(*args, **kwargs):
        raise RuntimeError("the database went away")

    monkeypatch.setattr("app.services.bank.merge_import", broken)
    res = await upload(client, applicant_id, RESUME_TEXT)
    assert res.status_code == 500
    assert upload.bucket.removed == list(upload.bucket.files)
    assert (await client.get(f"/applicants/{applicant_id}/resumes")).json() == []


# --- Import Again ---------------------------------------------------------------


async def test_import_again_writes_into_the_bank_and_merges_on_a_second_run(student, database):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)

    res = await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})
    assert res.status_code == 200
    body = res.json()
    assert (body["resume_id"], body["filename"], body["read_by"]) == (str(resume_id), "resume.pdf", "parser")
    assert _counts(body) == (6, 0, 2)

    again = (await client.post(f"{bank}/import", json={"resume_id": str(resume_id)})).json()
    assert _counts(again) == (0, 0, 0)
    assert len((await client.get(bank)).json()["entries"]) == 6


async def test_without_a_resume_id_import_reads_the_default_resume_else_the_newest(student, database):
    client, applicant_id, bank = student
    older = await _seed_resume(database, applicant_id, RESUME_TEXT, minutes_ago=10)
    newest = await _seed_resume(database, applicant_id, "Projects\nWorkIt  Jan 2026 - Present\n• Built it")

    res = await client.post(f"{bank}/import", json={})
    assert res.json()["resume_id"] == str(newest)
    assert [e["title"] for e in (await client.get(bank)).json()["entries"]] == ["WorkIt"]

    await _set_default(database, applicant_id, older)
    assert (await client.post(f"{bank}/import", json={})).json()["resume_id"] == str(older)


async def test_a_resume_with_no_readable_sections_writes_nothing(student, database):
    client, applicant_id, bank = student
    unreadable = await _seed_resume(database, applicant_id, None)
    res = await client.post(f"{bank}/import", json={"resume_id": str(unreadable)})
    assert res.status_code == 200
    assert _counts(res.json()) == (0, 0, 0)


async def test_import_with_no_uploaded_resume_is_not_found(student):
    client, _, bank = student
    assert (await client.post(f"{bank}/import", json={})).status_code == 404


async def test_another_students_resume_cannot_be_imported(student, database):
    client, _, bank = student
    async with database() as session:
        other = await _seed_applicant(session)
    theirs = await _seed_resume(database, other, RESUME_TEXT)

    assert (await client.post(f"{bank}/import", json={"resume_id": str(theirs)})).status_code == 404
    assert (await client.post(f"/applicants/{other}/bank/import", json={})).status_code == 403


async def test_a_filled_field_that_clashes_leaves_the_entry_but_adds_its_bullets(student, database):
    client, applicant_id, bank = student
    school = (
        await client.post(
            f"{bank}/entries",
            json={"section": "education", "title": "Lakeview University", "gpa_scale": 4.0},
        )
    ).json()
    draft = {"section": "education", "title": "Lakeview University", "gpa": 85, "gpa_scale": 100, "bullets": ["Tutored calculus"]}
    async with database() as session:
        from app.schemas.bank import DraftEntry

        merged = await bank_service.merge_import(session, applicant_id, [DraftEntry.model_validate(draft)], [])
        await session.commit()
    assert merged.entries_updated == 1
    saved = (await client.get(bank)).json()["entries"]
    assert [(e["id"], e["gpa"], e["gpa_scale"]) for e in saved] == [(school["id"], None, 4.0)]
    assert [b["text"] for b in saved[0]["bullets"]] == ["Tutored calculus"]


# --- the backfill of old uploads ------------------------------------------------


async def test_the_backfill_fills_only_empty_banks_newest_upload_first(student, database):
    client, applicant_id, bank = student
    await _seed_resume(database, applicant_id, "Projects\nWorkIt  Jan 2025 - Mar 2025\n• Built it", minutes_ago=10)
    await _seed_resume(database, applicant_id, "Projects\nWorkIt  Jan 2026 - Present\n• Shipped it")
    async with database() as session:
        busy = await _seed_applicant(session)
    await _seed_resume(database, busy, RESUME_TEXT)
    async with database() as session:
        await bank_service.add_skill(session, busy, "Python")
        await session.commit()

    async with database() as session:
        report = await backfill(session)
        await session.commit()
    assert (report.students, report.resumes, report.entries_added) == (1, 2, 1)

    (workit,) = (await client.get(bank)).json()["entries"]
    # The newest upload's dates win; the older one adds its bullet.
    assert (workit["start_month"], workit["end_kind"]) == ("2026-01", "present")
    assert [b["text"] for b in workit["bullets"]] == ["Shipped it", "Built it"]

    async with database() as session:
        assert (await backfill(session)).resumes == 0


# --- reading with the model (KAN-222) ----------------------------------------------
#
# ScriptedLLM stands in for the model (seam 2); its script is the model's JSON.

MODEL_READING = {
    "entries": [
        {
            "section": "experience",
            "title": "Lab Assistant",
            "organization": "Riverside Materials Lab",
            "location": "Riverside, CA",
            "start_month": "2025-01",
            "end_month": None,
            "end_kind": "present",
            "bullets": ["Prepared tensile test samples", "Logged results in Excel"],
        },
        # An end before the start: kept, without its dates.
        {"section": "projects", "title": "Wind Tunnel", "start_month": "2025-05", "end_month": "2024-01", "end_kind": "month"},
        # No title: not an entry, dropped.
        {"section": "awards", "title": ""},
        # A field the model saw only as a placeholder is never filled with it.
        {"section": "education", "title": "Riverside State University", "degree": "B.S.", "field_of_study": "[link]", "gpa": 3.5},
    ],
    "skills": [{"name": "Excel", "group": "Tools"}, {"name": "excel", "group": None}],
}

# Text the heuristic parser finds no section in.
UNREADABLE_TEXT = "Sam Seeker\nsam.seeker@example.com\n(631) 555-0142\nlinkedin.com/in/samseeker\nLab Assistant at Riverside Materials Lab since January 2025."


@pytest.fixture
def parsing_caps(monkeypatch):
    """Set the parsing cap and the daily pool for one test."""

    def set_caps(*, cap: int | None = None, pool: int | None = None):
        if cap is not None:
            monkeypatch.setattr(get_settings(), "ai_parsing_cap", cap)
        if pool is not None:
            monkeypatch.setattr(get_settings(), "ai_daily_pool", pool)

    return set_caps


@pytest.fixture
def use_model():
    def install(*scripts) -> ScriptedLLM:
        fake = ScriptedLLM(*scripts)
        app.dependency_overrides[get_llm] = lambda: fake
        return fake

    yield install
    app.dependency_overrides.pop(get_llm, None)


def rate_limited() -> RateLimitError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return RateLimitError("quota", response=httpx.Response(429, request=request), body=None)


def _reading(data: dict = MODEL_READING) -> list[str]:
    return [json.dumps(data)]


async def test_read_with_ai_writes_the_models_entries_checked_against_the_entry_schema(student, database, use_model):
    client, applicant_id, bank = student
    resume_id = await _seed_resume(database, applicant_id, RESUME_TEXT)
    use_model(_reading())

    res = await client.post(f"{bank}/import", json={"resume_id": str(resume_id), "read_with_ai": True})
    assert res.status_code == 200
    body = res.json()
    assert (body["read_by"], body["uses_left"]) == ("model", 0)
    assert _counts(body) == (3, 0, 1)

    saved = (await client.get(bank)).json()
    school, lab, tunnel = saved["entries"]
    assert _summary(lab) == ("experience", "Lab Assistant", "Riverside Materials Lab")
    assert (lab["start_month"], lab["end_kind"], [b["text"] for b in lab["bullets"]]) == (
        "2025-01", "present", ["Prepared tensile test samples", "Logged results in Excel"],
    )
    assert (tunnel["title"], tunnel["start_month"], tunnel["end_month"]) == ("Wind Tunnel", None, None)
    assert (school["degree"], school["field_of_study"], school["gpa"]) == ("B.S.", None, 3.5)
    assert [(s["name"], s["group"]) for s in saved["skills"]] == [("Excel", "Tools")]


async def test_import_never_asks_the_model_unless_the_student_does(student, database, use_model):
    client, applicant_id, bank = student
    await _seed_resume(database, applicant_id, UNREADABLE_TEXT)
    fake = use_model(_reading())

    body = (await client.post(f"{bank}/import", json={})).json()
    assert (body["read_by"], _counts(body), body["uses_left"]) == ("parser", (0, 0, 0), 1)
    assert fake.prompts == []


async def test_the_prompt_sent_holds_no_identity_data(student, database, use_model):
    client, applicant_id, bank = student
    async with database() as session:
        await session.execute(
            text("UPDATE applicant_profiles SET phone_number = '631-555-0142', linkedin_url = 'https://linkedin.com/in/samseeker' WHERE id = :id"),
            {"id": applicant_id},
        )
        await session.commit()
    await _seed_resume(database, applicant_id, UNREADABLE_TEXT)
    fake = use_model(_reading())

    await client.post(f"{bank}/import", json={"read_with_ai": True})
    sent = json.dumps(fake.prompts)
    for secret in ("Sam", "Seeker", "sam.seeker@example.com", "555-0142", "linkedin.com/in/samseeker"):
        assert secret not in sent
    assert "Riverside Materials Lab" in sent


async def test_an_invalid_model_reply_writes_nothing_and_counts_no_use(student, database, use_model):
    client, applicant_id, bank = student
    await _seed_resume(database, applicant_id, RESUME_TEXT)

    use_model(["not json"])
    res = await client.post(f"{bank}/import", json={"read_with_ai": True})
    assert res.status_code == 503
    assert "detail" in res.json()
    assert (await client.get(bank)).json() == {"entries": [], "skills": []}

    use_model(_reading())
    res = await client.post(f"{bank}/import", json={"read_with_ai": True})
    assert (res.status_code, res.json()["uses_left"]) == (200, 0)


async def test_a_model_that_is_down_does_not_count_a_use(student, database, use_model):
    client, applicant_id, bank = student
    await _seed_resume(database, applicant_id, RESUME_TEXT)

    use_model(rate_limited())
    assert (await client.post(f"{bank}/import", json={"read_with_ai": True})).status_code == 503
    assert (await client.post(f"{bank}/import", json={})).json()["uses_left"] == 1


async def test_read_with_ai_stops_at_the_parsing_cap(student, database, use_model, parsing_caps):
    client, applicant_id, bank = student
    await _seed_resume(database, applicant_id, UNREADABLE_TEXT)
    parsing_caps(cap=1)
    fake = use_model(_reading())

    assert (await client.post(f"{bank}/import", json={"read_with_ai": True})).status_code == 200
    assert (await client.post(f"{bank}/import", json={"read_with_ai": True})).status_code == 429
    body = (await client.post(f"{bank}/import", json={})).json()
    assert (body["read_by"], body["uses_left"]) == ("parser", 0)
    assert len(fake.prompts) == 1


async def test_parsing_stops_when_its_share_of_the_pool_is_spent(student, database, use_model, parsing_caps):
    client, applicant_id, bank = student
    parsing_caps(pool=10)  # parsing's 10% share: one use across all students
    await _seed_resume(database, applicant_id, UNREADABLE_TEXT)
    use_model(_reading())
    assert (await client.post(f"{bank}/import", json={"read_with_ai": True})).status_code == 200

    async with database() as session:
        other = await _seed_applicant(session)
    await _seed_resume(database, other, UNREADABLE_TEXT)
    _sign_in(other)
    res = await client.post(f"/applicants/{other}/bank/import", json={"read_with_ai": True})
    assert res.status_code == 429


def test_the_reading_keeps_the_gpa_scale_and_project_tools():
    # Pure, no database: "GPA: 3.62/4.00" fills the scale, and a project's
    # "| C++, CMake" tools become ungrouped skills after the skills section's own.
    entries, skills = read(
        "Education\nLakeview University  Expected Graduation: May 2099\n"
        "Bachelor of Science, Computer Science  GPA: 3.62/4.00\n"
        "Projects\nLine Robot| C++, CMake\n• Built a robot.\n"
        "Skills\nLanguages: C++, Python\n"
    )
    school = entries[0]
    assert (school.title, school.degree, school.field_of_study, school.gpa, school.gpa_scale) == (
        "Lakeview University", "Bachelor of Science", "Computer Science", 3.62, 4.0,
    )
    assert skills == [("C++", "Languages"), ("Python", "Languages"), ("CMake", None)]


def test_a_model_reading_with_null_lists_still_counts():
    # Groq's gpt-oss sends coursework: null on a job. That is an empty list,
    # not a failed reading.
    from app.schemas.bank import ModelReading
    from app.services.bank_import import model_drafts

    reading = ModelReading.model_validate({
        "entries": [{"section": "experience", "title": "Intern", "organization": "Acme",
                     "coursework": None, "bullets": ["Built  a tool."]}],
        "skills": None,
    })
    assert [(d.title, d.coursework, d.bullets) for d in model_drafts(reading)] == [
        ("Intern", [], ["Built a tool."]),
    ]
