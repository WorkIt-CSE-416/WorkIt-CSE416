"""
Seam-1 tests for Tailor (KAN-217): a run proposes changes to a tailored
resume for one job posting, and Done saves the approved ones. Through the API
on real Postgres, with ScriptedLLM standing in for the model (seam 2).
backend/CLAUDE.md's Tests section has the setup.
"""

import io
import json
import uuid

import docx
import httpx
import pytest
from openai import APIStatusError, RateLimitError
from sqlalchemy import text
from workit_scout.testing import ScriptedLLM

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.models.built_resume import Built_Resume_Skill
from app.models.jobs import Job_Post
from app.routers import tailor as tailor_router
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.schemas.tailor import Placement
from app.services import tailor
from app.services.ai_messages import TOO_LARGE
from app.services.bank import add_local_skill
from app.services.keywords import posting_hash
from app.services.models import get_large_llm, get_small_llm
from app.services.resume_view import ResumeView, ViewSkill
from tests import fake_models

pytestmark = pytest.mark.anyio

DESCRIPTION = "Build services in Python and Go. Docker a plus. Kubernetes preferred."
KEYWORDS = [
    {"keyword": "Python", "kind": "required"},
    {"keyword": "Go", "kind": "required"},
    {"keyword": "Docker", "kind": "preferred"},
    {"keyword": "Kubernetes", "kind": "preferred"},
]
LINKEDIN = "https://linkedin.com/in/sam-seeker"


def reply(rewords=(), placements=()) -> list[str]:
    """A ScriptedLLM script: the model's Tailor reply. Bullets are named by
    their handles in the prompt (b1: the resume's bullets, in its order)."""
    return [json.dumps({
        "rewords": [{"bullet": b, "text": t} for b, t in rewords],
        "placements": list(placements),
    })]


def rate_limited() -> RateLimitError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return RateLimitError("quota", response=httpx.Response(429, request=request), body=None)


def too_large() -> APIStatusError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return APIStatusError("Request too large", response=httpx.Response(413, request=request), body=None)


class QueuedLLM(ScriptedLLM):
    """One reply per call, in order: keyword extraction, then Tailor."""

    def __init__(self, *replies: str):
        super().__init__(["unused"])
        self._replies = list(replies)

    async def _complete_json(self, client, endpoint, messages, schema, max_tokens=None) -> str:
        self.prompts.append(list(messages))
        return self._replies.pop(0)


async def _seed_applicant(session) -> uuid.UUID:
    applicant_id = uuid.uuid4()
    await session.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": applicant_id})
    await session.execute(
        text(
            "INSERT INTO applicant_profiles (id, email, full_name, linkedin_url)"
            " VALUES (:id, :email, 'Sam Seeker', :linkedin)"
        ),
        {"id": applicant_id, "email": f"sam{applicant_id.hex[:6]}@example.com", "linkedin": LINKEDIN},
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


class Student:
    def __init__(self, client: httpx.AsyncClient, applicant_id: uuid.UUID):
        self.client = client
        self.id = applicant_id
        self.me = f"/applicants/{applicant_id}"

    async def post(self, path: str, body: dict) -> httpx.Response:
        return await self.client.post(f"{self.me}{path}", json=body)

    async def entry(self, **body) -> dict:
        res = await self.post("/bank/entries", body)
        assert res.status_code == 201, res.text
        return res.json()

    async def skill(self, name: str) -> dict:
        res = await self.post("/bank/skills", {"name": name})
        assert res.status_code == 201, res.text
        return res.json()

    async def generate(self) -> str:
        res = await self.post("/built-resumes", {"name": "Base Resume"})
        assert res.status_code == 201, res.text
        return res.json()["id"]

    async def tailor(self, posting: str, source: dict | None = None, skills: list[str] = ()) -> httpx.Response:
        """A run from `source`, by default the base resume, adding `skills`."""
        return await self.post(
            "/tailor", {"job_posting_id": posting, **(source or built(self.base)), "skills": list(skills)})

    async def stream(
        self, posting: str, source: dict | None = None, skills: list[str] = ()
    ) -> tuple[int, list[dict]]:
        """A streamed run from `source`, by default the base resume: its status and its lines."""
        res = await self.post(
            "/tailor/stream", {"job_posting_id": posting, **(source or built(self.base)), "skills": list(skills)})
        if res.status_code != 200:
            return res.status_code, [res.json()]
        return 200, [json.loads(line) for line in res.text.splitlines() if line.strip()]

    async def match(self, posting: str, source: dict | None = None) -> httpx.Response:
        return await self.post("/tailor/match", {"job_posting_id": posting, **(source or built(self.base))})

    async def resumes(self) -> list[dict]:
        return (await self.client.get(f"{self.me}/built-resumes")).json()

    async def words(self, resume_id: str) -> str:
        """The text of the resume's Word file: what it shows."""
        res = await self.client.get(f"{self.me}/built-resumes/{resume_id}/docx")
        assert res.status_code == 200, res.text
        return "\n".join(p.text for p in docx.Document(io.BytesIO(res.content)).paragraphs)


@pytest.fixture
async def signed_in(database):
    async with database() as session:
        applicant_id = await _seed_applicant(session)
    _sign_in(applicant_id)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield Student(client, applicant_id)
    finally:
        app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
async def student(signed_in):
    """A bank with one Experience entry (bullets b1, b2), the skill Docker,
    and a base resume of all of it."""
    await signed_in.entry(
        section="experience", title="Software Intern", organization="Acme",
        start_month="2025-06", end_month="2025-08",
        bullets=["Fixed bugs in a React dashboard", "Wrote billing services in python"],
    )
    await signed_in.skill("Docker")
    signed_in.base = await signed_in.generate()
    return signed_in


@pytest.fixture
def use_model():
    def install(*scripts) -> ScriptedLLM:
        fake = ScriptedLLM(*scripts)
        fake_models.use(fake)
        return fake

    yield install
    fake_models.clear()


async def _seed_posting(database, description: str | None = DESCRIPTION, *, cached=True) -> str:
    """A posting; `cached` stores its keywords as KAN-215's extraction would."""
    async with database() as session:
        posting = await session.scalar(
            text(
                "INSERT INTO job_postings (title, status, company_name, apply_url, description)"
                " VALUES ('Backend Intern', 'published', 'Acme', :url, :description) RETURNING id"
            ),
            {"url": f"https://boards.example.com/acme/{uuid.uuid4().hex[:6]}", "description": description},
        )
        if cached:
            await session.execute(
                text("UPDATE job_postings SET keywords = CAST(:k AS jsonb), keywords_hash = :h WHERE id = :id"),
                {"k": json.dumps(KEYWORDS), "h": posting_hash(Job_Post(title="Backend Intern", description=description)), "id": posting},
            )
        await session.commit()
    return str(posting)


def built(resume_id: str) -> dict:
    return {"built_resume_id": resume_id}


def _kinds(body: dict) -> list[str]:
    return [c["kind"] for c in body["edits"]]


def _edits(body: dict, kind: str) -> list[dict]:
    return [c for c in body["edits"] if c["kind"] == kind]


def _words(keywords: list[dict]) -> list[str]:
    return [k["keyword"] for k in keywords]


# --- A run: what it changes ----------------------------------------------


async def test_a_run_proposes_a_truthful_rewording_and_drops_an_invented_one(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[
        ("b2", "Built Python billing services packaged with Docker"),
        ("b1", "Fixed bugs in a React dashboard running on Kubernetes for 30 teams"),
    ]))

    res = await student.tailor(posting)

    assert res.status_code == 200, res.text
    body = res.json()
    assert [(c["before"], c["text"]) for c in _edits(body, "reword")] == [
        ("Wrote billing services in python", "Built Python billing services packaged with Docker"),
    ]
    assert body["dropped"] == 1


async def test_a_rewording_under_another_bullet_s_handle_is_dropped(student, database, use_model):
    posting = await _seed_posting(database)
    # b1 is the React bullet: this is b2's rewording under the wrong handle.
    # It adds no number or tool, so only the overlap check catches it.
    use_model(reply(rewords=[("b1", "Wrote billing services in Python")]))

    body = (await student.tailor(posting)).json()

    assert "reword" not in _kinds(body)
    assert body["dropped"] == 1


def test_a_rewording_keeps_its_bullet_and_another_bullet_s_does_not():
    original = "Wrote Python scripts to clean survey data"
    assert tailor.keeps_its_bullet("Cleaned survey datasets with Python scripts", original)
    assert not tailor.keeps_its_bullet("Developed web endpoints with Flask", original)


async def test_a_prompt_over_budget_leaves_out_the_lowest_ranked_bullets(signed_in, database, use_model):
    # An entry holds at most 30 bullets: five of them, about 30,000 characters.
    for n in range(5):
        await signed_in.entry(section="leadership", title=f"Volunteer {n}", organization="Pantry", bullets=[
            f"Organized volunteer shift number {n}-{i} for the campus food pantry drive, " * 3 for i in range(30)])
    await signed_in.entry(
        section="experience", title="Volunteer", organization="Pantry",
        bullets=["Wrote billing services in Python and Go"],
    )
    base = await signed_in.generate()
    posting = await _seed_posting(database)
    fake = use_model(reply())

    assert (await signed_in.tailor(posting, built(base))).status_code == 200

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert len(sent) <= tailor.PROMPT_TOKENS * tailor.CHARS_PER_TOKEN
    # The posting's bullet is last in the bank but first by rank, so it stays.
    assert "Wrote billing services in Python and Go" in sent and "Volunteer, Pantry" in sent
    assert 0 < sent.count("Organized volunteer") < 150 * 3
    assert fake.max_tokens == [tailor.REPLY_TOKENS]


async def test_a_request_too_large_for_every_model_answers_503_saying_so(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(too_large())

    res = await student.tailor(posting)

    assert res.status_code == 503
    assert res.json()["detail"] == TOO_LARGE


async def test_the_match_before_a_run_reads_the_source_and_saves_nothing(student, database, use_model):
    posting = await _seed_posting(database)
    fake = use_model(reply())

    body = (await student.match(posting)).json()

    assert _words(body["matched"]) == ["Python", "Docker"]
    assert _words(body["missing"]) == ["Go", "Kubernetes"]
    assert body["weak_match"] is False and body["tailored_resume_id"] is None
    # The keywords were cached already: no model call, and nothing saved.
    assert fake.prompts == []
    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


async def test_a_keyword_the_student_does_not_pick_is_never_added(student, database, use_model):
    # The bank holds Kubernetes, hidden on the resume: not picked, it stays off.
    await student.skill("Kubernetes")
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await student.tailor(posting)).json()

    assert "skill" not in _kinds(body)
    assert _words(body["after_missing"]) == ["Go", "Kubernetes"]


async def test_an_entry_the_resume_hides_is_left_out_of_the_run(student, database, use_model):
    # Added after the base resume was generated, so the resume hides it.
    await student.entry(
        section="projects", title="Cluster Tool", bullets=["Wrote a Go tool to restart services"])
    posting = await _seed_posting(database)
    # Only the resume's two bullets have handles: b3 names nothing.
    fake = use_model(reply(rewords=[("b3", "Wrote a Go tool to restart services fast")]))

    body = (await student.tailor(posting)).json()

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert "Software Intern" in sent and "Cluster Tool" not in sent and "Go tool" not in sent
    assert "reword" not in _kinds(body)
    # The hidden project's Go does not count.
    assert _words(body["missing"]) == ["Go", "Kubernetes"]


async def test_a_bullet_the_resume_hides_is_left_out_of_the_run(student, database, use_model):
    bank = (await student.client.get(f"{student.me}/bank")).json()
    b2 = bank["entries"][0]["bullets"][1]["id"]
    res = await student.client.patch(
        f"{student.me}/built-resumes/{student.base}/choices", json={"bullets": [{"bullet_id": b2, "shown": False}]})
    assert res.status_code == 200, res.text
    posting = await _seed_posting(database)
    fake = use_model(reply(rewords=[("b2", "Built Python billing services")]))

    body = (await student.tailor(posting)).json()

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert "React dashboard" in sent and "billing services" not in sent
    assert "reword" not in _kinds(body)
    assert "order" not in _kinds(body)


async def test_the_model_sees_only_the_skills_the_resume_shows(student, database, use_model):
    # Added after the base resume was generated, so the resume hides it.
    await student.skill("Rust")
    posting = await _seed_posting(database)
    fake = use_model(reply())

    await student.tailor(posting)

    sent = fake.prompts[0][-1]["content"]
    skills = sent.split("The resume's skills:\n")[1].split("\n\n")[0]
    assert skills == "Other: [1] Docker"


async def test_a_rewording_may_name_only_a_skill_the_resume_shows(student, database, use_model):
    # Added after the base resume was generated, so the resume hides it.
    await student.skill("Rust")
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Wrote billing services in Python and Rust")]))

    body = (await student.tailor(posting)).json()

    assert "reword" not in _kinds(body)
    assert body["dropped"] == 1


async def test_a_keyword_the_resume_shows_anywhere_passes_and_an_unpicked_missing_one_does_not(
    signed_in, database, use_model
):
    # Kubernetes shows only in coursework: matched, so a bullet may name it.
    # Go is nowhere on the resume and not picked: a bullet may not.
    await signed_in.entry(
        section="education", title="Stony Brook University", degree="B.S.", field_of_study="Computer Science",
        coursework=["Cloud Computing with Kubernetes"])
    await signed_in.entry(
        section="experience", title="Software Intern", organization="Acme",
        bullets=["Wrote billing services in python", "Deployed billing services to staging servers"])
    base = await signed_in.generate()
    posting = await _seed_posting(database)
    fake = use_model(reply(rewords=[
        ("b1", "Wrote billing services in python and Go"),
        ("b2", "Deployed billing services to staging servers on Kubernetes"),
    ]))

    body = (await signed_in.tailor(posting, built(base))).json()

    assert "Kubernetes" in _words(body["matched"]) and "Go" in _words(body["missing"])
    assert "b1: Wrote billing services in python" in fake.prompts[0][-1]["content"]
    assert [c["text"] for c in _edits(body, "reword")] == [
        "Deployed billing services to staging servers on Kubernetes"]
    assert body["dropped"] == 1


async def test_a_picked_skill_is_placed_on_the_tailored_resume_only(student, database, use_model):
    posting = await _seed_posting(database)
    fake = use_model(reply(
        rewords=[("b2", "Wrote billing services in Python and Go")],
        placements=[{"skill": "Go", "group": "Languages", "after": 0}]))

    # Go is missing; Python is matched and Rust is no keyword, so both are ignored.
    body = (await student.tailor(posting, skills=["go", "Python", "Rust"])).json()

    assert "Place these skills: Go" in fake.prompts[0][-1]["content"]
    assert "Rust" not in fake.prompts[0][-1]["content"]
    # The picked skill counts for the truth rule.
    assert [c["text"] for c in _edits(body, "reword")] == ["Wrote billing services in Python and Go"]
    [skill] = _edits(body, "skill")
    assert (skill["label"], skill["group"]) == ("Go", "Languages")
    assert "Go" in _words(body["after_matched"])
    # On the tailored resume, in its group, and not in the experience bank.
    assert "Languages: Go" in await student.words(body["resume"]["id"])
    bank = (await student.client.get(f"{student.me}/bank")).json()
    assert "Go" not in {s["name"] for s in bank["skills"]}


async def test_handles_follow_the_resume_s_own_order(student, database, use_model):
    bank = (await student.client.get(f"{student.me}/bank")).json()
    react, billing = [b["id"] for b in bank["entries"][0]["bullets"]]
    # The resume shows billing first, unlike the bank.
    res = await student.client.patch(
        f"{student.me}/built-resumes/{student.base}/choices",
        json={"bullets": [{"bullet_id": billing, "position": 0}, {"bullet_id": react, "position": 1}]})
    assert res.status_code == 200, res.text
    posting = await _seed_posting(database)
    fake = use_model(reply(rewords=[("b1", "Built billing services in Python")]))

    body = (await student.tailor(posting)).json()

    assert "b1: Wrote billing services in python" in fake.prompts[0][-1]["content"]
    assert [(c["bullet_id"], c["text"]) for c in _edits(body, "reword")] == [
        (billing, "Built billing services in Python")]


async def test_text_search_puts_the_posting_s_bullets_first(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await student.tailor(posting)).json()

    [order] = _edits(body, "order")
    bullets = await student.client.get(f"{student.me}/bank")
    b1, b2 = [b["id"] for b in bullets.json()["entries"][0]["bullets"]]
    # "python" matches the posting; the React bullet does not.
    assert (order["bullet_ids"], order["before_ids"]) == ([b2, b1], [b1, b2])


async def test_a_posting_with_no_description_uses_its_title_with_a_weak_match_notice(
    student, database, use_model
):
    posting = await _seed_posting(database, None)
    fake = use_model(reply())

    body = (await student.tailor(posting)).json()

    assert body["weak_match"] is True
    assert "Backend Intern" in fake.prompts[0][-1]["content"]


async def test_the_prompt_has_the_posting_and_bank_without_links_or_identity_data(signed_in, database, use_model):
    await signed_in.entry(
        section="projects", title="Portfolio Site", link="https://github.com/samseeker/site",
        bullets=["Built it in Python; see https://samseeker.dev or mail sam@example.com"],
    )
    await signed_in.skill("Docker")
    base = await signed_in.generate()
    posting = await _seed_posting(database)
    fake = use_model(reply())

    assert (await signed_in.tailor(posting, built(base))).status_code == 200

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert "Portfolio Site" in sent and "Docker" in sent and "Kubernetes" in sent and DESCRIPTION in sent
    for secret in ("github.com/samseeker", "samseeker.dev", "sam@example.com", "Sam Seeker", "linkedin"):
        assert secret not in sent


# --- Starting points ------------------------------------------------------


UPLOAD_TEXT = """\
Experience
Initech  Jun 2026 - Aug 2026
Backend Intern  Austin, TX
•Built payment services in Go
Projects
Maze Robot  Jan 2025 - Mar 2025
•Programmed a robot to solve mazes
Skills
•Tools: Kubernetes
"""


async def _seed_upload(database, applicant_id: uuid.UUID, raw_text: str | None) -> str:
    """An uploaded resume row with its extracted text, as upload stores it."""
    async with database() as session:
        resume_id = await session.scalar(
            text(
                "INSERT INTO resumes (applicant_id, original_filename, storage_path, status, raw_text)"
                " VALUES (:a, 'resume.pdf', :path, 'parsed', :raw) RETURNING id"
            ),
            {"a": applicant_id, "path": f"{applicant_id}/{uuid.uuid4()}.pdf", "raw": raw_text},
        )
        await session.commit()
    return str(resume_id)


async def _entries(student) -> list[tuple[str, str | None]]:
    bank = (await student.client.get(f"{student.me}/bank")).json()
    return [(e["title"], e["organization"]) for e in bank["entries"]]


async def test_an_upload_is_read_into_the_bank_and_tailored_as_its_own_entries(student, database, use_model):
    upload = {"uploaded_resume_id": await _seed_upload(database, student.id, UPLOAD_TEXT)}
    posting = await _seed_posting(database)
    # The bank's order: Initech (newest), Acme, Maze Robot. Acme is not on
    # the upload, so it waits hidden and the run leaves it out.
    fake = use_model(reply())

    run = (await student.tailor(posting, upload)).json()

    assert await _entries(student) == [
        ("Backend Intern", "Initech"), ("Software Intern", "Acme"), ("Maze Robot", None)]
    # The upload's facts only: Acme's Python and the bank's Docker are hidden.
    assert _words(run["matched"]) == ["Go", "Kubernetes"]
    assert "Acme" not in fake.prompts[0][-1]["content"]
    assert "skill" not in _kinds(run)
    shown = await student.words(run["resume"]["id"])
    assert "Initech" in shown and "Maze Robot" in shown and "Acme" not in shown
    # The run saved the tailored resume only; no base resume was saved.
    assert len(await _entries(student)) == 3
    assert sorted(r["job_posting_id"] or "" for r in await student.resumes()) == ["", posting]


async def test_an_upload_read_as_nothing_is_409_and_another_students_is_404(student, database, use_model):
    posting = await _seed_posting(database)
    fake = use_model(reply())
    blank = await _seed_upload(database, student.id, None)
    async with database() as session:
        other = await _seed_applicant(session)
    theirs = await _seed_upload(database, other, UPLOAD_TEXT)

    res = await student.tailor(posting, {"uploaded_resume_id": blank})
    assert res.status_code == 409
    assert "read" in res.json()["detail"].lower()
    assert (await student.tailor(posting, {"uploaded_resume_id": theirs})).status_code == 404
    assert (await student.match(posting, {"uploaded_resume_id": theirs})).status_code == 404
    assert (await student.tailor(posting, built(str(uuid.uuid4())))).status_code == 404
    assert fake.prompts == []
    assert len(await _entries(student)) == 1


@pytest.mark.parametrize("source", [{}, "both"])
async def test_a_run_names_exactly_one_source(student, database, use_model, source):
    posting = await _seed_posting(database)
    use_model(reply())
    upload = await _seed_upload(database, student.id, UPLOAD_TEXT)
    body = {"job_posting_id": posting}
    if source == "both":
        body |= {"built_resume_id": student.base, "uploaded_resume_id": upload}

    assert (await student.post("/tailor", body)).status_code == 422


async def test_an_empty_bank_is_sent_to_intake(signed_in, database, use_model):
    entry = await signed_in.entry(section="experience", title="Tutor", bullets=["Taught Python"])
    base = await signed_in.generate()
    assert (await signed_in.client.delete(f"{signed_in.me}/bank/entries/{entry['id']}")).status_code == 204
    posting = await _seed_posting(database)
    fake = use_model(reply())

    res = await signed_in.tailor(posting, built(base))

    assert res.status_code == 409
    assert "bank" in res.json()["detail"].lower()
    assert fake.prompts == []


async def test_an_unknown_posting_is_404(student, use_model):
    use_model(reply())
    assert (await student.tailor(str(uuid.uuid4()))).status_code == 404


@pytest.mark.parametrize("status", ["draft", "paused", "closed"])
async def test_a_posting_the_jobs_page_does_not_list_is_404(student, database, use_model, status):
    posting = await _seed_posting(database)
    async with database() as session:
        await session.execute(
            text("UPDATE job_postings SET status = CAST(:s AS job_post_status) WHERE id = :id"),
            {"s": status, "id": posting})
        await session.commit()
    fake = use_model(reply())

    assert (await student.tailor(posting)).status_code == 404
    assert (await student.match(posting)).status_code == 404
    assert fake.prompts == []


# --- The Tailor cap -------------------------------------------------------


@pytest.mark.skip(reason="KAN-319: the Tailor limit is lifted for now")
async def test_each_run_counts_against_the_tailor_cap(student, database, use_model):
    use_model(reply())
    cap = get_settings().ai_tailor_cap

    assert (await student.tailor(await _seed_posting(database))).json()["uses_left"] == cap - 1
    assert (await student.tailor(await _seed_posting(database))).json()["uses_left"] == cap - 2
    fake = use_model(reply())
    assert (await student.tailor(await _seed_posting(database))).status_code == 429
    assert fake.prompts == []


@pytest.mark.skip(reason="KAN-319: the Tailor limit is lifted for now")
async def test_a_run_that_extracts_keywords_counts_once(student, database):
    posting = await _seed_posting(database, cached=False)
    fake = QueuedLLM(json.dumps({"keywords": KEYWORDS}), reply()[0])
    fake_models.use(fake)
    try:
        body = (await student.tailor(posting)).json()
    finally:
        fake_models.clear()

    assert len(fake.prompts) == 2
    assert _words(body["missing"]) == ["Go", "Kubernetes"]
    assert body["uses_left"] == get_settings().ai_tailor_cap - 1


@pytest.mark.skip(reason="KAN-319: the Tailor limit is lifted for now")
async def test_an_invalid_reply_answers_503_and_counts_no_run(student, database, use_model):
    posting = await _seed_posting(database)
    use_model([json.dumps({"rewords": "all of them"})])
    assert (await student.tailor(posting)).status_code == 503

    use_model(rate_limited())
    assert (await student.tailor(posting)).status_code == 503

    use_model(reply())
    assert (await student.tailor(posting)).json()["uses_left"] == get_settings().ai_tailor_cap - 1


async def test_a_run_saves_the_tailored_resume_and_leaves_the_source(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(
        rewords=[("b2", "Built Python billing services packaged with Docker")],
        placements=[{"skill": "Kubernetes", "group": "Tools", "after": 0}]))

    res = await student.tailor(posting, skills=["Kubernetes"])

    assert res.status_code == 200, res.text
    body = res.json()
    tailored = body["resume"]
    assert tailored["job_posting_id"] == posting
    assert tailored["name"] == "Sam Seeker Acme Backend Intern Resume"
    assert _words(body["after_matched"]) == ["Python", "Docker", "Kubernetes"]
    shown = await student.words(tailored["id"])
    assert "Built Python billing services packaged with Docker" in shown
    assert "Wrote billing services in python" not in shown
    assert "Kubernetes" in shown
    # The base resume is unchanged, and the bank keeps the original wording.
    base = await student.words(student.base)
    assert "Wrote billing services in python" in base and "Kubernetes" not in base
    bank = (await student.client.get(f"{student.me}/bank")).json()
    assert bank["entries"][0]["bullets"][1]["text"] == "Wrote billing services in python"


async def test_a_reword_edit_names_the_wording_it_replaced_for_revert(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Built Python billing services")]))

    body = (await student.tailor(posting)).json()
    [edit] = _edits(body, "reword")

    assert edit["before"] == "Wrote billing services in python" and edit["before_variant_id"] is None
    # Revert: the bank's own wording shows again on the tailored resume.
    res = await student.client.patch(
        f"{student.me}/built-resumes/{body['resume']['id']}/choices",
        json={"bullets": [{"bullet_id": edit["bullet_id"], "variant_id": edit["before_variant_id"]}]})
    assert res.status_code == 200, res.text
    assert "Wrote billing services in python" in await student.words(body["resume"]["id"])


async def test_a_second_run_replaces_the_tailored_resume_in_place(student, database, use_model):
    """Back to Choose Keywords and run again: the same resume (its id, the
    student's name for it), made again, with the last run's own skill gone."""
    posting = await _seed_posting(database)
    use_model(reply(
        rewords=[("b2", "Built Python billing services packaged with Docker")],
        placements=[{"skill": "Kubernetes", "group": "Tools", "after": 0}]))
    first = (await student.tailor(posting, skills=["Kubernetes"])).json()["resume"]
    renamed = await student.client.patch(f"{student.me}/built-resumes/{first['id']}", json={"name": "Mine"})
    assert renamed.status_code == 200, renamed.text
    assert (await student.match(posting)).json()["tailored_resume_id"] == first["id"]
    fake = use_model(reply(rewords=[("b1", "Fixed bugs in a React dashboard written in Python")]))

    res = await student.tailor(posting)

    assert res.status_code == 200, res.text
    second = res.json()["resume"]
    assert second["id"] == first["id"] and second["name"] == "Mine"
    assert fake.prompts
    shown = await student.words(first["id"])
    assert "Fixed bugs in a React dashboard written in Python" in shown
    assert "Wrote billing services in python" in shown and "Kubernetes" not in shown
    assert [r["id"] for r in await student.resumes() if r["job_posting_id"] == posting] == [first["id"]]


async def test_a_run_from_the_posting_s_own_tailored_resume_is_refused_before_the_model(
    student, database, use_model
):
    posting = await _seed_posting(database)
    use_model(reply())
    first = (await student.tailor(posting)).json()["resume"]
    fake = use_model(reply())

    res = await student.tailor(posting, source=built(first["id"]))

    assert res.status_code == 422
    assert fake.prompts == []


async def test_the_same_wording_reuses_one_variant(student, database, use_model):
    bullet = None
    for p in (await _seed_posting(database), await _seed_posting(database)):
        use_model(reply(rewords=[("b2", "Built Python billing services")]))
        [edit] = _edits((await student.tailor(p)).json(), "reword")
        bullet = edit["bullet_id"]

    async with database() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM bank_bullet_variants WHERE bullet_id = :b"), {"b": bullet})
    assert count == 1


async def test_a_failed_model_saves_nothing(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(rate_limited())

    assert (await student.tailor(posting, skills=["Go"])).status_code == 503
    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


# --- A streamed run ---------------------------------------------------------


async def test_a_streamed_run_names_each_phase_then_answers_what_the_run_does(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Built Python billing services")]))

    status, lines = await student.stream(posting)

    assert status == 200
    assert [line["type"] for line in lines] == ["phase", "phase", "done"]
    assert [line["phase"] for line in lines[:2]] == ["asking", "generating"]
    result = lines[2]["result"]
    assert "reword" in _kinds(result)
    assert "Built Python billing services" in await student.words(result["resume"]["id"])


async def test_a_streamed_run_whose_model_fails_ends_with_an_error_line_and_saves_nothing(
    student, database, use_model
):
    posting = await _seed_posting(database)
    use_model(rate_limited())

    status, lines = await student.stream(posting)

    assert status == 200
    assert [line["type"] for line in lines] == ["phase", "error"]
    assert lines[1]["status"] == 503 and lines[1]["message"]
    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


async def test_a_streamed_run_refused_before_the_model_is_an_http_status(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())
    first = (await student.tailor(posting)).json()["resume"]
    fake = use_model(reply())

    status, [body] = await student.stream(posting, source=built(first["id"]))

    assert status == 422
    assert "detail" in body
    assert fake.prompts == []


# --- When a posting row goes ----------------------------------------------


async def _tailored(student, use_model, posting: str) -> dict:
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    res = await student.tailor(posting)
    assert res.status_code == 200, res.text
    return res.json()["resume"]


async def test_a_posting_with_a_tailored_resume_cannot_be_deleted(student, database, use_model):
    """Postings close, never go: a hard delete must not take a student's
    tailored resume with it."""
    from sqlalchemy.exc import IntegrityError

    posting = await _seed_posting(database)
    tailored = await _tailored(student, use_model, posting)

    async with database() as session:
        with pytest.raises(IntegrityError):
            await session.execute(text("DELETE FROM job_postings WHERE id = :id"), {"id": posting})
            await session.commit()

    assert tailored["id"] in {r["id"] for r in await student.resumes()}


async def test_another_resume_keeps_a_shared_wording_when_its_first_posting_goes(student, database, use_model):
    first = await _seed_posting(database)
    second = await _seed_posting(database)
    made_first = await _tailored(student, use_model, first)
    kept = await _tailored(student, use_model, second)
    assert (await student.client.delete(f"{student.me}/built-resumes/{made_first['id']}")).status_code == 204

    async with database() as session:
        await session.execute(text("DELETE FROM job_postings WHERE id = :id"), {"id": first})
        await session.commit()

    assert "Built Python billing services" in await student.words(kept["id"])


async def test_a_run_reads_keywords_with_the_small_model_and_rewrites_with_the_large(student, database):
    posting = await _seed_posting(database, cached=False)
    small = ScriptedLLM([json.dumps({"keywords": KEYWORDS})])
    large = ScriptedLLM(reply())
    app.dependency_overrides[get_small_llm] = lambda: small
    app.dependency_overrides[get_large_llm] = lambda: large
    try:
        res = await student.tailor(posting)
    finally:
        fake_models.clear()

    assert res.status_code == 200, res.text
    assert (len(small.prompts), len(large.prompts)) == (1, 1)


# --- Skill placement (docs/tailor_resume.md) ---------------------------------


def _view(*skills: tuple[str, str | None]) -> ResumeView:
    return ResumeView((), tuple(ViewSkill(uuid.uuid4(), name, group) for name, group in skills))


# Printed as: Languages: [1] Python, [2] Java / Tools: [3] Git, [4] Docker
SKILLS = _view(("Python", "Languages"), ("Java", "Languages"), ("Git", "Tools"), ("Docker", "Tools"))


def _placed(view: ResumeView, picked: list[str], *placements: dict) -> list[tuple[str, str | None]]:
    return [(p.name, p.group) for p in tailor.place_skills(view, picked, [Placement(**p) for p in placements])]


@pytest.mark.parametrize(("title", "company", "name"), [
    ("Software Engineer (Seattle WA)", "Adobe", "Sam Seeker Adobe Software Engineer Resume"),
    ("Software Engineer, Product (Co-op)", "Bree", "Sam Seeker Bree Software Engineer, Product Resume"),
    ("Intern [Remote] {2027} - Backend", None, "Sam Seeker Intern - Backend Resume"),
    ("(Seattle)", "Acme", "Sam Seeker Acme (Seattle) Resume"),
])
def test_a_tailored_resume_is_named_for_the_student_company_and_title_without_brackets(title, company, name):
    assert tailor_router._name("Sam Seeker", Job_Post(title=title, company_name=company)) == name


def test_a_long_tailored_name_cuts_the_title_and_keeps_resume():
    name = tailor_router._name("Sam Seeker", Job_Post(title="Engineer " * 20, company_name="Acme"))
    assert len(name) <= 80 and name.startswith("Sam Seeker Acme Engineer") and name.endswith(" Resume")


def test_a_skill_goes_after_the_numbered_skill_in_its_group():
    assert _placed(SKILLS, ["Go"], {"skill": "Go", "group": "Languages", "after": 1}) == [
        ("Python", "Languages"), ("Go", "Languages"), ("Java", "Languages"), ("Git", "Tools"), ("Docker", "Tools")]


def test_after_zero_puts_a_skill_first_in_its_group():
    assert _placed(SKILLS, ["Bash"], {"skill": "Bash", "group": "tools", "after": 0})[2] == ("Bash", "Tools")


def test_two_skills_after_one_skill_keep_the_reply_s_order():
    placed = _placed(SKILLS, ["Kubernetes", "Terraform"],
                     {"skill": "Terraform", "group": "Tools", "after": 4},
                     {"skill": "Kubernetes", "group": "Tools", "after": 4})
    assert [name for name, _ in placed][-2:] == ["Terraform", "Kubernetes"]


@pytest.mark.parametrize("after", [9, 3, None])
def test_an_after_out_of_range_or_in_another_group_puts_the_skill_last_in_its_group(after):
    # 3 is Git, in Tools: the group wins over the number.
    placed = _placed(SKILLS, ["Go"], {"skill": "Go", "group": "Languages", "after": after})
    assert placed[:3] == [("Python", "Languages"), ("Java", "Languages"), ("Go", "Languages")]


def test_a_new_group_goes_last_and_at_most_two_are_made():
    placed = _placed(SKILLS, ["Terraform", "Figma", "Excel"],
                     {"skill": "Terraform", "group": "Infrastructure", "after": 0},
                     {"skill": "Figma", "group": "Design", "after": 0},
                     {"skill": "Excel", "group": "Office", "after": 0})
    assert placed[4:] == [("Terraform", "Infrastructure"), ("Figma", "Design"), ("Excel", None)]


def test_a_group_too_long_or_holding_a_placeholder_is_no_group():
    placed = _placed(SKILLS, ["Go", "Rust"],
                     {"skill": "Go", "group": "x" * 41},
                     {"skill": "Rust", "group": "[name]'s tools"})
    assert placed[4:] == [("Go", None), ("Rust", None)]


def test_a_skill_not_picked_placed_twice_or_left_out_is_handled_alone():
    placed = _placed(SKILLS, ["Go", "Rust"],
                     {"skill": "Kotlin", "group": "Languages", "after": 1},
                     {"skill": "go", "group": "Languages", "after": 2},
                     {"skill": "Go", "group": "Tools", "after": 3})
    names = [name for name, _ in placed]
    assert "Kotlin" not in names and names.count("Go") == 1
    assert placed[2] == ("Go", "Languages") and placed[-1] == ("Rust", None)


def test_other_names_the_resume_s_ungrouped_skills():
    view = _view(("Python", None), ("Git", "Tools"))
    assert _placed(view, ["Go"], {"skill": "Go", "group": "Other", "after": 1})[:2] == [
        ("Python", None), ("Go", None)]


# --- Resume-local skills (docs/tailor_resume.md, step 2) ----------------------


async def _local_skill(database, student, name: str, group: str | None = None) -> str:
    """A skill on the base resume only, shown last, as Tailor will add one."""
    async with database() as session:
        skill = await add_local_skill(session, student.id, uuid.UUID(student.base), name, group)
        session.add(Built_Resume_Skill(
            built_resume_id=uuid.UUID(student.base), skill_id=skill.id, shown=True, position=99))
        await session.commit()
        return str(skill.id)


async def test_a_local_skill_shows_on_its_resume_and_stays_out_of_the_bank(student, database):
    skill = await _local_skill(database, student, "Golang", "Languages")

    assert "Golang" in await student.words(student.base)
    bank = (await student.client.get(f"{student.me}/bank")).json()
    assert skill not in {s["id"] for s in bank["skills"]}
    # Its editor names it.
    own = (await student.client.get(f"{student.me}/bank", params={"built_resume_id": student.base})).json()
    assert skill in {s["id"] for s in own["skills"]}
    # A new resume from the bank never gets it.
    assert "Golang" not in await student.words(await student.generate())


async def test_a_local_skill_may_share_a_bank_skill_s_name(student, database):
    # The bank has Docker: the name index counts the resume as its own owner.
    await _local_skill(database, student, "docker")


async def test_deleting_the_resume_deletes_its_local_skills(student, database):
    skill = await _local_skill(database, student, "Golang")

    res = await student.client.delete(f"{student.me}/built-resumes/{student.base}")

    assert res.status_code == 204, res.text
    async with database() as session:
        left = await session.scalar(text("SELECT count(*) FROM bank_skills WHERE id = :id"), {"id": skill})
    assert left == 0
