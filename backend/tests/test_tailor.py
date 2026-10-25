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
from app.models.jobs import Job_Post
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services import tailor
from app.services.ai_messages import TOO_LARGE
from app.services.keywords import posting_hash

pytestmark = pytest.mark.anyio

DESCRIPTION = "Build services in Python and Go. Docker a plus. Kubernetes preferred."
KEYWORDS = [
    {"keyword": "Python", "kind": "required"},
    {"keyword": "Go", "kind": "required"},
    {"keyword": "Docker", "kind": "preferred"},
    {"keyword": "Kubernetes", "kind": "preferred"},
]
LINKEDIN = "https://linkedin.com/in/sam-seeker"


def reply(rewords=()) -> list[str]:
    """A ScriptedLLM script: the model's Tailor reply. Bullets are named by
    their handles in the prompt (b1: the resume's bullets, in bank order)."""
    return [json.dumps({"rewords": [{"bullet": b, "text": t} for b, t in rewords]})]


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

    async def tailor(self, posting: str, source: dict | None = None) -> httpx.Response:
        """A run from `source`, by default the base resume."""
        return await self.post("/tailor", {"job_posting_id": posting, **(source or built(self.base))})

    async def done(self, posting: str, source: dict, changes: list[dict]) -> httpx.Response:
        return await self.post("/tailor/done", {"job_posting_id": posting, **source, "changes": changes})

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
        app.dependency_overrides[get_llm] = lambda: fake
        return fake

    yield install
    app.dependency_overrides.pop(get_llm, None)


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


def source_of(run: dict) -> dict:
    """The source a run names, as Done takes it back."""
    return {k: run[k] for k in ("built_resume_id", "uploaded_resume_id") if run[k]}


def _kinds(body: dict) -> list[str]:
    return [c["kind"] for c in body["changes"]]


def _words(keywords: list[dict]) -> list[str]:
    return [k["keyword"] for k in keywords]


# --- A run: the proposals -------------------------------------------------


async def test_a_run_proposes_a_truthful_rewording_and_drops_an_invented_one(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[
        ("b2", "Built Python billing services packaged with Docker"),
        ("b1", "Fixed bugs in a React dashboard running on Kubernetes for 30 teams"),
    ]))

    res = await student.tailor(posting)

    assert res.status_code == 200, res.text
    body = res.json()
    rewords = [c for c in body["changes"] if c["kind"] == "reword"]
    assert [(c["original"], c["text"]) for c in rewords] == [
        ("Wrote billing services in python", "Built Python billing services packaged with Docker"),
    ]
    assert body["dropped"] == 1
    assert source_of(body) == built(student.base)


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


async def test_the_keyword_match_before_and_a_missing_keyword_is_asked_not_written(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await student.tailor(posting)).json()

    assert _words(body["matched"]) == ["Python", "Docker"]
    assert _words(body["missing"]) == ["Go", "Kubernetes"]
    # Neither is anywhere in the bank: WorkIt asks, it does not write them in.
    assert _words(body["questions"]) == ["Go", "Kubernetes"]
    assert body["weak_match"] is False


async def test_a_bank_skill_left_off_the_resume_is_proposed_not_asked(student, database, use_model):
    kubernetes = await student.skill("Kubernetes")
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await student.tailor(posting)).json()

    shows = [c for c in body["changes"] if c["kind"] == "show_skill"]
    assert [(c["skill_id"], c["keywords"]) for c in shows] == [(kubernetes["id"], ["Kubernetes"])]
    assert _words(body["questions"]) == ["Go"]


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
    # The hidden project's Go does not count: it is asked about.
    assert _words(body["questions"]) == ["Go", "Kubernetes"]


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


async def test_text_search_puts_the_posting_s_bullets_first(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await student.tailor(posting)).json()

    orders = [c for c in body["changes"] if c["kind"] == "order"]
    assert len(orders) == 1
    bullets = await student.client.get(f"{student.me}/bank")
    b1, b2 = [b["id"] for b in bullets.json()["entries"][0]["bullets"]]
    # "python" matches the posting; the React bullet does not.
    assert orders[0]["bullet_ids"] == [b2, b1]


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

    assert source_of(run) == upload
    assert await _entries(student) == [
        ("Backend Intern", "Initech"), ("Software Intern", "Acme"), ("Maze Robot", None)]
    # The upload's facts only: Acme's Python and the bank's Docker are hidden.
    assert _words(run["matched"]) == ["Go", "Kubernetes"]
    assert "Acme" not in fake.prompts[0][-1]["content"]
    # The bank's Docker is a skill, so it is proposed; Acme's Python is asked.
    shows = [c for c in run["changes"] if c["kind"] == "show_skill"]
    assert [c["label"] for c in shows] == ["Docker"]
    assert _words(run["questions"]) == ["Python"]

    res = await student.done(posting, source_of(run), [])

    assert res.status_code == 200, res.text
    shown = await student.words(res.json()["resume"]["id"])
    assert "Initech" in shown and "Maze Robot" in shown and "Acme" not in shown
    # Done did not read the upload again (it owns entries now); no base resume was saved.
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
    assert (await student.done(posting, {"uploaded_resume_id": theirs}, [])).status_code == 404
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
    assert (await student.done(posting, built(student.base), [])).status_code == 404
    assert fake.prompts == []


# --- The Tailor cap -------------------------------------------------------


@pytest.mark.skip(reason="KAN-319: the Tailor limit is lifted for now")
async def test_each_run_counts_against_the_tailor_cap(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())
    cap = get_settings().ai_tailor_cap

    assert (await student.tailor(posting)).json()["uses_left"] == cap - 1
    assert (await student.tailor(posting)).json()["uses_left"] == cap - 2
    fake = use_model(reply())
    assert (await student.tailor(posting)).status_code == 429
    assert fake.prompts == []


@pytest.mark.skip(reason="KAN-319: the Tailor limit is lifted for now")
async def test_a_run_that_extracts_keywords_counts_once(student, database):
    posting = await _seed_posting(database, cached=False)
    fake = QueuedLLM(json.dumps({"keywords": KEYWORDS}), reply()[0])
    app.dependency_overrides[get_llm] = lambda: fake
    try:
        body = (await student.tailor(posting)).json()
    finally:
        app.dependency_overrides.pop(get_llm, None)

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


async def test_the_run_saves_nothing(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    await student.tailor(posting)

    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


# --- Done -----------------------------------------------------------------


async def test_done_saves_approved_changes_on_one_tailored_resume_and_leaves_the_base(
    student, database, use_model
):
    kubernetes = await student.skill("Kubernetes")
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Built Python billing services packaged with Docker")]))
    run = (await student.tailor(posting)).json()
    reword = next(c for c in run["changes"] if c["kind"] == "reword")
    show = next(c for c in run["changes"] if c["kind"] == "show_skill")

    res = await student.done(posting, source_of(run), [reword, show])

    assert res.status_code == 200, res.text
    body = res.json()
    tailored = body["resume"]
    assert tailored["job_posting_id"] == posting
    assert tailored["name"] == "Acme – Backend Intern"
    assert _words(body["matched"]) == ["Python", "Docker", "Kubernetes"]
    shown = await student.words(tailored["id"])
    assert "Built Python billing services packaged with Docker" in shown
    assert "Wrote billing services in python" not in shown
    assert "Kubernetes" in shown
    # The base resume is unchanged, and the bank keeps the original wording.
    base = await student.words(student.base)
    assert "Wrote billing services in python" in base and "Kubernetes" not in base
    bank = (await student.client.get(f"{student.me}/bank")).json()
    assert bank["entries"][0]["bullets"][1]["text"] == "Wrote billing services in python"
    assert kubernetes["id"] in {s["id"] for s in bank["skills"]}


async def test_a_second_done_updates_the_same_tailored_resume(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    run = (await student.tailor(posting)).json()
    reword = next(c for c in run["changes"] if c["kind"] == "reword")
    first = (await student.done(posting, source_of(run), [reword])).json()["resume"]

    # A second run from the tailored resume reuses its variant.
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    again = (await student.tailor(posting, built(first["id"]))).json()
    assert source_of(again) == built(first["id"])
    assert [c for c in again["changes"] if c["kind"] == "reword"] == []
    order = next(c for c in again["changes"] if c["kind"] == "order")
    second = (await student.done(posting, source_of(again), [order])).json()["resume"]

    assert second["id"] == first["id"]
    assert [r["job_posting_id"] for r in await student.resumes()].count(posting) == 1
    assert "Built Python billing services" in await student.words(first["id"])


async def test_the_same_wording_reuses_one_variant(student, database, use_model):
    posting = await _seed_posting(database)
    other = await _seed_posting(database)
    change = None
    for p in (posting, other):
        use_model(reply(rewords=[("b2", "Built Python billing services")]))
        run = (await student.tailor(p)).json()
        change = next(c for c in run["changes"] if c["kind"] == "reword")
        assert (await student.done(p, source_of(run), [change])).status_code == 200

    async with database() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM bank_bullet_variants WHERE bullet_id = :b"), {"b": change["bullet_id"]})
    assert count == 1


async def test_done_refuses_a_variant_that_breaks_the_truth_rule(student, database, use_model):
    posting = await _seed_posting(database)
    bank = (await student.client.get(f"{student.me}/bank")).json()
    bullet = bank["entries"][0]["bullets"][1]["id"]

    res = await student.done(posting, built(student.base), [
        {"kind": "reword", "bullet_id": bullet, "text": "Wrote Go billing services for 9 clients"}])

    assert res.status_code == 422
    assert "Go" in res.json()["detail"]
    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


async def test_done_refuses_bringing_back_an_entry(student, database, use_model):
    project = await student.entry(section="projects", title="Cluster Tool", bullets=["Wrote a Go tool"])
    posting = await _seed_posting(database)

    res = await student.done(posting, built(student.base), [{"kind": "show_entry", "entry_id": project["id"]}])

    assert res.status_code == 422
    assert [r["job_posting_id"] for r in await student.resumes()] == [None]


async def test_done_refuses_another_students_bullet(student, database, use_model):
    posting = await _seed_posting(database)
    bank = (await student.client.get(f"{student.me}/bank")).json()
    bullet = bank["entries"][0]["bullets"][1]["id"]
    async with database() as session:
        other = await _seed_applicant(session)
    _sign_in(other)
    mine = Student(student.client, other)
    await mine.entry(section="experience", title="Tutor", bullets=["Taught Python"])
    source = await mine.generate()

    res = await mine.done(posting, built(source), [{"kind": "reword", "bullet_id": bullet, "text": "Wrote billing"}])

    assert res.status_code == 404


# --- When a posting row goes ----------------------------------------------


async def _tailor_and_done(student, use_model, posting: str) -> dict:
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    run = (await student.tailor(posting)).json()
    change = next(c for c in run["changes"] if c["kind"] == "reword")
    res = await student.done(posting, source_of(run), [change])
    assert res.status_code == 200, res.text
    return res.json()["resume"]


async def test_a_posting_with_a_tailored_resume_cannot_be_deleted(student, database, use_model):
    """Postings close, never go: a hard delete must not take a student's
    tailored resume with it."""
    from sqlalchemy.exc import IntegrityError

    posting = await _seed_posting(database)
    tailored = await _tailor_and_done(student, use_model, posting)

    async with database() as session:
        with pytest.raises(IntegrityError):
            await session.execute(text("DELETE FROM job_postings WHERE id = :id"), {"id": posting})
            await session.commit()

    assert tailored["id"] in {r["id"] for r in await student.resumes()}


async def test_another_resume_keeps_a_shared_wording_when_its_first_posting_goes(student, database, use_model):
    first = await _seed_posting(database)
    second = await _seed_posting(database)
    made_first = await _tailor_and_done(student, use_model, first)
    kept = await _tailor_and_done(student, use_model, second)
    assert (await student.client.delete(f"{student.me}/built-resumes/{made_first['id']}")).status_code == 204

    async with database() as session:
        await session.execute(text("DELETE FROM job_postings WHERE id = :id"), {"id": first})
        await session.commit()

    assert "Built Python billing services" in await student.words(kept["id"])
