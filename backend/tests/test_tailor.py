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
from openai import RateLimitError
from sqlalchemy import text
from workit_scout.testing import ScriptedLLM

from app.config import get_settings
from app.deps import get_current_account
from app.main import app
from app.routers.scout import get_llm
from app.schemas.auth import AccountType, AuthenticatedAccount
from app.services.keywords import description_hash

pytestmark = pytest.mark.anyio

DESCRIPTION = "Build services in Python and Go. Docker a plus. Kubernetes preferred."
KEYWORDS = [
    {"keyword": "Python", "kind": "required"},
    {"keyword": "Go", "kind": "required"},
    {"keyword": "Docker", "kind": "preferred"},
    {"keyword": "Kubernetes", "kind": "preferred"},
]
LINKEDIN = "https://linkedin.com/in/sam-seeker"


def reply(rewords=(), add_entries=()) -> list[str]:
    """A ScriptedLLM script: the model's Tailor reply. Bullets and entries
    are named by their handles in the prompt (b1, e1: bank order)."""
    return [json.dumps({
        "rewords": [{"bullet": b, "text": t} for b, t in rewords],
        "add_entries": list(add_entries),
    })]


def rate_limited() -> RateLimitError:
    request = httpx.Request("POST", "http://endpoint.test/v1/chat/completions")
    return RateLimitError("quota", response=httpx.Response(429, request=request), body=None)


class QueuedLLM(ScriptedLLM):
    """One reply per call, in order: keyword extraction, then Tailor."""

    def __init__(self, *replies: str):
        super().__init__(["unused"])
        self._replies = list(replies)

    async def _complete_json(self, client, endpoint, messages, schema) -> str:
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

    async def tailor(self, posting: str) -> httpx.Response:
        return await self.post("/tailor", {"job_posting_id": posting})

    async def done(self, posting: str, source: str, changes: list[dict]) -> httpx.Response:
        return await self.post(
            "/tailor/done", {"job_posting_id": posting, "source_resume_id": source, "changes": changes})

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
                {"k": json.dumps(KEYWORDS), "h": description_hash(description), "id": posting},
            )
        await session.commit()
    return str(posting)


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
    assert body["source_resume_id"] == student.base


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


async def test_a_left_out_entry_the_model_names_is_proposed(student, database, use_model):
    project = await student.entry(
        section="projects", title="Cluster Tool", bullets=["Wrote a Go tool to restart services"])
    posting = await _seed_posting(database)
    # e1 is the Experience entry (on the resume); e2 the project (left out).
    use_model(reply(add_entries=["e2", "e1", "e9"]))

    body = (await student.tailor(posting)).json()

    shows = [c for c in body["changes"] if c["kind"] == "show_entry"]
    assert [(c["entry_id"], c["keywords"]) for c in shows] == [(project["id"], ["Go"])]
    assert _words(body["questions"]) == ["Kubernetes"]


async def test_a_left_out_copy_of_a_shown_entry_is_not_proposed(student, database, use_model):
    # An import saved "as new" left a second Software Intern at Acme off the
    # resume; bringing it back showed the same job twice and ran to 2 pages.
    copy = {"section": "experience", "title": "software intern", "organization": "ACME",
            "start_month": "2025-06", "end_month": "2025-08", "bullets": ["Fixed bugs in a React dashboard"]}
    assert (await student.post("/bank/entries?allow_duplicate=true", copy)).status_code == 201
    posting = await _seed_posting(database)
    use_model(reply(add_entries=["e1", "e2"]))

    body = (await student.tailor(posting)).json()

    assert "show_entry" not in _kinds(body)


async def test_an_entry_brought_back_is_named_with_its_organization(student, database, use_model):
    await student.entry(
        section="experience", title="Research Assistant", organization="AI Lab",
        start_month="2024-01", end_month="2024-05", bullets=["Wrote a Go tool to restart services"])
    posting = await _seed_posting(database)
    use_model(reply(add_entries=["e2"]))

    body = (await student.tailor(posting)).json()

    shows = [c for c in body["changes"] if c["kind"] == "show_entry"]
    assert [c["label"] for c in shows] == ["Research Assistant, AI Lab"]


async def test_an_entry_brought_back_takes_its_date_order_place(student, database, use_model):
    # Newer than the job on the resume, so it goes above it, not last.
    newer = await student.entry(
        section="experience", title="Platform Intern", organization="Globex",
        start_month="2026-01", end_month="2026-05", bullets=["Wrote a Go tool to restart services"])
    posting = await _seed_posting(database)
    use_model(reply(add_entries=["e1"]))
    run = (await student.tailor(posting)).json()
    show = next(c for c in run["changes"] if c["kind"] == "show_entry")
    assert show["entry_id"] == newer["id"]

    res = await student.done(posting, run["source_resume_id"], [show])

    assert res.status_code == 200, res.text
    shown = await student.words(res.json()["resume"]["id"])
    assert shown.index("Platform Intern") < shown.index("Software Intern")


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
    await signed_in.generate()
    posting = await _seed_posting(database)
    fake = use_model(reply())

    assert (await signed_in.tailor(posting)).status_code == 200

    sent = "\n".join(m["content"] for m in fake.prompts[0])
    assert "Portfolio Site" in sent and "Docker" in sent and "Kubernetes" in sent and DESCRIPTION in sent
    for secret in ("github.com/samseeker", "samseeker.dev", "sam@example.com", "Sam Seeker", "linkedin"):
        assert secret not in sent


# --- Starting points ------------------------------------------------------


async def test_with_no_built_resume_a_run_generates_a_base_resume_first(signed_in, database, use_model):
    await signed_in.entry(section="experience", title="Tutor", bullets=["Taught Python"])
    posting = await _seed_posting(database)
    use_model(reply())

    body = (await signed_in.tailor(posting)).json()

    assert [(r["id"], r["job_posting_id"]) for r in await signed_in.resumes()] == [
        (body["source_resume_id"], None)]


async def test_an_empty_bank_is_sent_to_intake(signed_in, database, use_model):
    posting = await _seed_posting(database)
    fake = use_model(reply())

    res = await signed_in.tailor(posting)

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
    assert (await student.done(posting, student.base, [])).status_code == 404
    assert fake.prompts == []


# --- The Tailor cap -------------------------------------------------------


async def test_each_run_counts_against_the_tailor_cap(student, database, use_model):
    posting = await _seed_posting(database)
    use_model(reply())
    cap = get_settings().ai_tailor_cap

    assert (await student.tailor(posting)).json()["uses_left"] == cap - 1
    assert (await student.tailor(posting)).json()["uses_left"] == cap - 2
    fake = use_model(reply())
    assert (await student.tailor(posting)).status_code == 429
    assert fake.prompts == []


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

    res = await student.done(posting, run["source_resume_id"], [reword, show])

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
    first = (await student.done(posting, run["source_resume_id"], [reword])).json()["resume"]

    # A second run starts from the tailored resume and reuses its variant.
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    again = (await student.tailor(posting)).json()
    assert again["source_resume_id"] == first["id"]
    assert [c for c in again["changes"] if c["kind"] == "reword"] == []
    order = next(c for c in again["changes"] if c["kind"] == "order")
    second = (await student.done(posting, again["source_resume_id"], [order])).json()["resume"]

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
        assert (await student.done(p, run["source_resume_id"], [change])).status_code == 200

    async with database() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM bank_bullet_variants WHERE bullet_id = :b"), {"b": change["bullet_id"]})
    assert count == 1


async def test_done_refuses_a_variant_that_breaks_the_truth_rule(student, database, use_model):
    posting = await _seed_posting(database)
    bank = (await student.client.get(f"{student.me}/bank")).json()
    bullet = bank["entries"][0]["bullets"][1]["id"]

    res = await student.done(posting, student.base, [
        {"kind": "reword", "bullet_id": bullet, "text": "Wrote Go billing services for 9 clients"}])

    assert res.status_code == 422
    assert "Go" in res.json()["detail"]
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

    res = await mine.done(posting, source, [{"kind": "reword", "bullet_id": bullet, "text": "Wrote billing"}])

    assert res.status_code == 404


# --- When a posting row goes ----------------------------------------------


async def _tailor_and_done(student, use_model, posting: str) -> dict:
    use_model(reply(rewords=[("b2", "Built Python billing services")]))
    run = (await student.tailor(posting)).json()
    change = next(c for c in run["changes"] if c["kind"] == "reword")
    res = await student.done(posting, run["source_resume_id"], [change])
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
