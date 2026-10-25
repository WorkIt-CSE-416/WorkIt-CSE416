"""
Bringing a student's Apply files into WorkIt (scripts/import_apply_profile.py),
spec seam 2: the import against this run's throwaway test database (never
Supabase), then the API the extension reads as it reads it: the Fill engine's
profile and policies, the answer bank, and the resume's bytes. Every value
here is made up.
"""

import uuid

import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.models.bank import Bank_Entry
from app.models.resume import Resume
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.scripts.import_apply_profile import import_apply

pytestmark = pytest.mark.anyio

PDF = b"%PDF-1.4\n% a made-up resume\n%%EOF\n"
TRANSCRIPT = b"%PDF-1.4\n% a made-up transcript\n%%EOF\n"

PROFILE = """\
identity:
  legal_first_name: Riley
  legal_middle_name: Quinn
  legal_last_name: Example
  email: riley.example@example.com
  phone: '+15550100142'
  current_location: {city: Springfield, state: IL, country: United States}
  age_18_or_over: true
files:
  resume_pdf: ../final/Riley_Example_Resume.pdf
  unofficial_transcript_pdf: ../records/transcript.pdf
links:
  linkedin_url: https://www.linkedin.com/in/riley-example
  github_url: https://github.com/riley-example
  portfolio_url: https://riley.example.com
education:
  school: Example State University
  degree: Bachelor's degree
  degree_type: Bachelor of Science
  majors: [Computer Science]
  start_date: 2024-08
  expected_graduation: 2028-05
  gpa_cumulative: 3.71
  gpa_scale: 4.0
voluntary_self_id:
  gender: Female
  veteran: I am not a protected veteran
screeners:
  previously_employed_by: [Initech]
answered_questions:
  Which role are you applying to?: Software Engineering Intern
"""

POLICIES = """\
live_runs: true
daily_cap: 12
employer_limits: {Initech: {applications: 1, days: 90}}
cover_letter: always
cover_letter_never: [Globex]
compensation: {expectation: posted range, fallback_hourly: 40, accept_stated_rate: true}
how_heard: {prefer: [careers page], text: Careers page}
"""

ANSWERS = """\
'what is your favorite programming language?':
  question: What is your favorite programming language?
  answer: Python, for how quickly an idea becomes a working program.
  options: []
  source: claude
  reviewed: false
  first_seen: {date: 2026-10-16, company: Initech}
'which of these tools have you used?':
  question: Which of these tools have you used?
  answer: [Git, Docker]
  options: [Git, Docker, Kubernetes]
  source: lisul
  reviewed: true
  first_seen: {date: 2026-10-17, company: Globex}
'why do you want to work at initech?':
  question: Why do you want to work at Initech?
  answer: Initech's printers are in every office I have worked in.
  options: []
  source: lisul
  reviewed: true
  first_seen: {date: 2026-10-18, company: Initech}
"""


@pytest.fixture
async def running():
    """The API with its lifespan running."""
    async with app.router.lifespan_context(app):
        yield
    app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
async def applicant(database) -> uuid.UUID:
    from tests.test_built_resumes import _seed_applicant

    async with database() as session:
        return await _seed_applicant(session)


@pytest.fixture
def apply_dir(tmp_path):
    """An Apply checkout's files: its folder beside the resume's."""
    folder = tmp_path / "repo" / "apply"
    folder.mkdir(parents=True)
    (folder / "applicant-profile.yaml").write_text(PROFILE)
    (folder / "policies.yaml").write_text(POLICIES)
    (folder / "answer-bank.yaml").write_text(ANSWERS)
    (tmp_path / "repo" / "final").mkdir()
    (tmp_path / "repo" / "final" / "Riley_Example_Resume.pdf").write_bytes(PDF)
    (tmp_path / "repo" / "records").mkdir()
    (tmp_path / "repo" / "records" / "transcript.pdf").write_bytes(TRANSCRIPT)
    return folder


@pytest.fixture
def local_files(tmp_path, monkeypatch):
    """LOCAL_FILES_DIR, as the developer's .env sets it."""
    folder = tmp_path / "local-files"
    monkeypatch.setattr(get_settings(), "local_files_dir", folder)
    return folder


def _signed_in_as(applicant: uuid.UUID) -> None:
    app.dependency_overrides[get_current_account] = lambda: AuthenticatedAccount(
        id=applicant, email="sam@example.com", full_name="Sam Seeker",
        account_type=AccountType.APPLICANT, onboarding_completed=True,
    )


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _import(database, applicant, apply_dir):
    async with database() as session:
        report = await import_apply(session, applicant, apply_dir)
        await session.commit()
    return report


async def _get(applicant, path: str) -> httpx.Response:
    _signed_in_as(applicant)
    async with _api() as extension:
        return await extension.get(f"/applicants/{applicant}{path}")


async def test_the_import_gives_workit_s_own_fields_the_apply_identity(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)

    profile = (await _get(applicant, "/profile")).json()
    assert profile | {"id": None, "email": None} == profile | {
        "id": None, "email": None,
        "full_name": "Riley Quinn Example", "first_name": "Riley", "middle_name": "Quinn", "last_name": "Example",
        "contact_email": "riley.example@example.com", "phone_number": "+15550100142",
        "linkedin_url": "https://www.linkedin.com/in/riley-example", "github_url": "https://github.com/riley-example",
        "portfolio_url": "https://riley.example.com", "location": "Springfield, IL",
    }
    entries = (await _get(applicant, "/bank")).json()["entries"]
    [school] = [e for e in entries if e["section"] == "education"]
    assert school | {"id": None} == school | {
        "id": None, "title": "Example State University", "degree": "Bachelor of Science",
        "field_of_study": "Computer Science", "start_month": "2024-08", "end_month": "2028-05",
    }
    assert float(school["gpa"]) == 3.71 and float(school["gpa_scale"]) == 4


async def test_the_fill_profile_holds_the_engine_s_facts_and_only_its_policies(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)

    res = await _get(applicant, "/fill-profile")

    assert res.status_code == 200, res.text
    fill = res.json()
    assert fill["profile"]["voluntary_self_id"] == {"gender": "Female", "veteran": "I am not a protected veteran"}
    assert fill["profile"]["screeners"] == {"previously_employed_by": ["Initech"]}
    assert fill["profile"]["answered_questions"] == {"Which role are you applying to?": "Software Engineering Intern"}
    # Files are WorkIt's own (its resume); a transcript's path never comes over.
    assert "files" not in fill["profile"]
    # Apply's run settings (live runs, caps, limits) are not answers.
    assert fill["policies"] == {
        "cover_letter": "always", "cover_letter_never": ["Globex"],
        "compensation": {"expectation": "posted range", "fallback_hourly": 40, "accept_stated_rate": True},
        "how_heard": {"prefer": ["careers page"], "text": "Careers page"},
    }


async def test_a_student_with_nothing_brought_gets_empty_fill_profile(running, applicant):
    res = await _get(applicant, "/fill-profile")

    assert res.status_code == 200, res.text
    assert res.json() == {"profile": {}, "policies": {}}


async def test_the_fill_profile_is_only_its_owner_s(running, applicant):
    _signed_in_as(uuid.uuid4())
    async with _api() as someone:
        res = await someone.get(f"/applicants/{applicant}/fill-profile")

    assert res.status_code == 403


async def test_brought_answers_reach_later_forms_and_keep_to_their_company(
    running, applicant, database, apply_dir, local_files,
):
    from tests.test_connector import _student_queues
    from tests.test_connector_checks import _company

    await _import(database, applicant, apply_dir)
    _, (job,) = await _student_queues(database, applicant, 1)
    await _company(database, job, "Hooli")

    bank = (await _get(applicant, f"/applications/{job}/answer-bank")).json()

    assert bank == {
        "What is your favorite programming language?": {
            "answer": "Python, for how quickly an idea becomes a working program.", "own": False,
        },
        "Which of these tools have you used?": {"answer": ["Git", "Docker"], "own": True},
    }
    # Asked at Initech, about Initech: only an Initech form gets it.
    await _company(database, job, "Initech")
    bank = (await _get(applicant, f"/applications/{job}/answer-bank")).json()
    assert bank["Why do you want to work at Initech?"]["own"] is True


DRAFTS = """\
'what drew you to logistics?':
  question: What drew you to logistics?
  answer: Watching a warehouse route its trucks.
  source: claude
  reviewed: false
'what do you build on weekends?':
  question: What do you build on weekends?
  answer: Small robots that sort marbles by colour.
  source: claude
  reviewed: true
'which shifts can you work?':
  question: Which shifts can you work?
  answer: [Mornings, Evenings]
  options: [Mornings, Evenings, Nights]
  source: claude
  reviewed: false
'what is your dream project?':
  question: What is your dream project?
  answer: A tram timetable that rewrites itself when a line closes.
  source: lisul
  reviewed: true
"""


async def test_only_the_student_s_answers_come_as_their_own_and_their_claude_s_drafts_stay_its(
    running, applicant, database, apply_dir, local_files,
):
    from tests.test_connector import _student_queues
    from tests.test_connector_checks import _company

    (apply_dir / "answer-bank.yaml").write_text(DRAFTS)
    await _import(database, applicant, apply_dir)
    await _import(database, applicant, apply_dir)
    _, (job,) = await _student_queues(database, applicant, 1)
    await _company(database, job, "Hooli")

    bank = (await _get(applicant, f"/applications/{job}/answer-bank")).json()

    # As in Apply, only source lisul is the student's: a draft they marked
    # reviewed is still their Claude's, so a form that bans AI text never takes it.
    assert bank == {
        "What is your dream project?": {"answer": "A tram timetable that rewrites itself when a line closes.", "own": True},
        "What drew you to logistics?": {"answer": "Watching a warehouse route its trucks.", "own": False},
        "What do you build on weekends?": {"answer": "Small robots that sort marbles by colour.", "own": False},
        "Which shifts can you work?": {"answer": ["Mornings", "Evenings"], "own": False},
    }


async def test_the_student_s_own_words_on_an_application_win_over_a_brought_answer(
    running, applicant, database, apply_dir, local_files,
):
    from tests.test_connector import _student_queues, _tab_asks
    from tests.test_connector_saved_answers import _student_answers

    await _import(database, applicant, apply_dir)
    me, (first, second) = await _student_queues(database, applicant, 2)
    question = {"name": "question_1", "label": "What is your favorite programming language?", "required": True, "max_length": None}
    await _tab_asks(me, first, question)
    await _student_answers(me, first, question, "Rust, for its compiler's help.")

    bank = (await _get(applicant, f"/applications/{second}/answer-bank")).json()

    assert bank["What is your favorite programming language?"] == {"answer": "Rust, for its compiler's help.", "own": True}


async def test_the_resume_attaches_from_this_computer_and_is_the_default(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)

    [resume] = (await _get(applicant, "/resumes")).json()
    assert resume["is_default"] is True
    assert resume["original_filename"] == "Riley_Example_Resume.pdf"
    res = await _get(applicant, f"/resumes/{resume['id']}/bytes")
    assert res.status_code == 200, res.text
    assert res.content == PDF
    assert res.headers["content-type"] == "application/pdf"


async def test_the_transcript_attaches_from_this_computer_and_a_rerun_keeps_one(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)
    await _import(database, applicant, apply_dir)

    [document] = (await _get(applicant, "/documents")).json()
    assert document["kind"] == "transcript"
    assert document["original_filename"] == "transcript.pdf"
    res = await _get(applicant, "/documents/transcript/bytes")
    assert res.status_code == 200, res.text
    assert res.content == TRANSCRIPT


async def test_two_students_files_of_the_same_name_stay_each_their_own(
    running, applicant, database, apply_dir, local_files, tmp_path,
):
    from tests.test_built_resumes import _seed_applicant

    async with database() as session:
        other = await _seed_applicant(session)
    other_dir = tmp_path / "other" / "apply"
    other_dir.mkdir(parents=True)
    for name in ("applicant-profile.yaml", "policies.yaml", "answer-bank.yaml"):
        (other_dir / name).write_text((apply_dir / name).read_text())
    for folder, name in (("final", "Riley_Example_Resume.pdf"), ("records", "transcript.pdf")):
        (tmp_path / "other" / folder).mkdir()
        (tmp_path / "other" / folder / name).write_bytes(b"%PDF-1.4\n% another student's file\n%%EOF\n")
    await _import(database, applicant, apply_dir)
    await _import(database, other, other_dir)

    [resume] = (await _get(applicant, "/resumes")).json()
    assert (await _get(applicant, f"/resumes/{resume['id']}/bytes")).content == PDF
    assert (await _get(applicant, "/documents/transcript/bytes")).content == TRANSCRIPT


async def test_a_local_resume_has_no_file_without_the_local_folder(
    running, applicant, database, apply_dir, local_files, monkeypatch,
):
    await _import(database, applicant, apply_dir)
    [resume] = (await _get(applicant, "/resumes")).json()
    monkeypatch.setattr(get_settings(), "local_files_dir", None)

    res = await _get(applicant, f"/resumes/{resume['id']}/bytes")

    assert res.status_code == 404


async def test_without_a_local_folder_the_resume_is_left_out_and_the_rest_comes(
    running, applicant, database, apply_dir, monkeypatch,
):
    monkeypatch.setattr(get_settings(), "local_files_dir", None)

    report = await _import(database, applicant, apply_dir)

    assert (await _get(applicant, "/resumes")).json() == []
    assert report.resume is None
    assert (await _get(applicant, "/fill-profile")).json()["profile"]["screeners"]


async def test_running_the_import_again_changes_nothing(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)
    first = [(await _get(applicant, path)).json() for path in ("/profile", "/fill-profile", "/bank", "/resumes")]

    await _import(database, applicant, apply_dir)

    again = [(await _get(applicant, path)).json() for path in ("/profile", "/fill-profile", "/bank", "/resumes")]
    assert again == first
    async with database() as session:
        assert len((await session.scalars(select(Resume).where(Resume.applicant_id == applicant))).all()) == 1
        assert len((await session.scalars(select(Bank_Entry).where(Bank_Entry.applicant_id == applicant))).all()) == 1


async def test_an_edited_apply_file_reaches_workit_on_the_next_import(running, applicant, database, apply_dir, local_files):
    await _import(database, applicant, apply_dir)
    (apply_dir / "applicant-profile.yaml").write_text(PROFILE.replace("Springfield", "Shelbyville").replace("3.71", "3.8"))

    await _import(database, applicant, apply_dir)

    assert (await _get(applicant, "/profile")).json()["location"] == "Shelbyville, IL"
    [school] = [e for e in (await _get(applicant, "/bank")).json()["entries"] if e["section"] == "education"]
    assert float(school["gpa"]) == 3.8
    assert (await _get(applicant, "/fill-profile")).json()["profile"]["identity"]["current_location"]["city"] == "Shelbyville"



def test_a_local_path_never_leaves_the_folder(local_files):
    from app.services.local_files import file_for

    student = uuid.uuid4()
    assert file_for(f"local:{student}/cv.pdf") == local_files / str(student) / "cv.pdf"
    assert file_for("local:cv.pdf") == local_files / "cv.pdf"
    for path in ("local:../cv.pdf", "local:notes/cv.pdf", f"local:{student}/../cv.pdf", f"local:{student}/a/cv.pdf",
                 "local:/etc/passwd", f"local:{student}/"):
        assert file_for(path) is None, path
