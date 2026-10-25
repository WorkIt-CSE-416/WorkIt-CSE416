"""
Company briefs (KAN-382), spec seam 2: the student's Claude, through the
connector, is handed a company to research, saves a brief, and reads it
with the next application. A fake page fetcher stands in for the web: a
fact is kept only if its quote is on the page it names.
"""

import datetime
import uuid

import pytest
from sqlalchemy import text as sql

from app.auto_apply import briefs
from app.deps import get_current_account
from app.main import app
from app.services.page_fetch import Unreadable
from tests.test_built_resumes import _seed_applicant
from tests.test_connector import (
    SIZE,
    WHY,
    _another_students_application,
    _describe,
    _student_queues,
    _tab_asks,
    claude,
)

pytestmark = [pytest.mark.anyio, pytest.mark.research_gate]

TODAY = datetime.datetime.now(datetime.UTC).date()
RECENT = (TODAY - datetime.timedelta(days=40)).strftime("%Y-%m")

PAGES = {
    "https://acme.com/rocket": f"Acme Rocket\nPublished {RECENT}\nAcme Rocket carries small satellites to low orbit for 40 customers.",
    "https://blog.acme.com/engines": f"{RECENT[:4]}\nOur engineers rebuilt the engine controller in Rust to cut restart time.",
    "https://acme.com/news/lander": f"{RECENT}\nToday we launched Acme Lander, which sets probes down on the Moon.",
    "https://acme.com/teams/flight": f"{RECENT}\nAcme's flight software team writes the guidance code for every Acme vehicle.",
    "https://www.reuters.com/acme": f"{RECENT}\nAcme opened a second launch site on the coast this year, with 12 pads.",
    "https://acme.com/teams/flight/autopilot": f"{RECENT}\nThe Flight Software team shipped Autopilot, which lands boosters without a pilot.",
    "https://evil.example/acme": "Acme Rocket carries small satellites to low orbit for 40 customers.",
}

ROCKET = {"category": "products", "fact": "Acme Rocket carries small satellites to low orbit.",
          "url": "https://acme.com/rocket", "quote": "Acme Rocket carries small satellites to low orbit",
          "published": RECENT}
ENGINES = {"category": "engineering", "fact": "Acme rebuilt its engine controller in Rust.",
           "url": "https://blog.acme.com/engines",
           "quote": "Our engineers rebuilt the engine controller in Rust to cut restart time.", "published": RECENT}
LANDER = {"category": "launches", "fact": "Acme launched Acme Lander, which sets probes down on the Moon.",
          "url": "https://acme.com/news/lander", "quote": "we launched Acme Lander, which sets probes down on the Moon",
          "published": RECENT}
TEAM = {"category": "team", "fact": "The flight software team writes guidance code for every Acme vehicle.",
        "url": "https://acme.com/teams/flight",
        "quote": "flight software team writes the guidance code for every Acme vehicle", "published": RECENT,
        "team": "Flight Software"}
PRESS = {"category": "launches", "fact": "Acme opened a second launch site on the coast.",
         "url": "https://www.reuters.com/acme", "quote": "Acme opened a second launch site on the coast",
         "published": RECENT}
AUTOPILOT = {"category": "launches", "fact": "The Flight Software team shipped Autopilot, which lands boosters.",
             "url": "https://acme.com/teams/flight/autopilot",
             "quote": "The Flight Software team shipped Autopilot, which lands boosters without a pilot",
             "published": RECENT}


@pytest.fixture
async def running():
    """The API with its lifespan running (tests/test_connector.py)."""
    async with app.router.lifespan_context(app):
        yield
    app.dependency_overrides.pop(get_current_account, None)


@pytest.fixture
async def applicant(database) -> uuid.UUID:
    async with database() as session:
        return await _seed_applicant(session)


@pytest.fixture
def web(monkeypatch) -> list[str]:
    """The fake web: PAGES, and the URLs read."""
    read: list[str] = []

    async def fetch(url: str, allowed) -> str:
        read.append(url)
        if url not in PAGES:
            raise Unreadable("404")
        return PAGES[url]

    monkeypatch.setattr(briefs, "fetch_page", fetch)
    return read


async def _queued(database, applicant) -> tuple[str, str]:
    me, (job,) = await _student_queues(database, applicant, 1)
    await _describe(database, job, "Acme builds rockets.")
    await _tab_asks(me, job, WHY)
    return me, job


async def _age(database, days: int) -> None:
    async with database() as session:
        await session.execute(sql("UPDATE company_briefs SET saved_at = now() - make_interval(days => :d)"), {"d": days})
        await session.commit()


async def test_a_company_with_no_brief_is_a_research_task(running, applicant, database, web):
    _, job = await _queued(database, applicant)

    async with claude(applicant) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
        task = (await client.call_tool("get_research_task", {})).structured_content

    assert tools["get_research_task"].annotations.read_only_hint is True
    assert tools["save_company_brief"].annotations.read_only_hint is False
    assert task["company"] == "Acme"
    assert task["job_id"] == job
    assert task["reason"] == "missing"
    assert set(task["categories"]) == {"products", "launches", "engineering", "team"}
    assert "reuters.com" in task["news_sites"]


async def test_a_fact_off_its_page_or_off_the_allowed_sites_is_dropped(running, applicant, database, web):
    await _queued(database, applicant)
    made_up = {**LANDER, "quote": "we launched Acme Orbiter to Mars and Venus", "url": "https://acme.com/news/lander"}
    elsewhere = {**ROCKET, "url": "https://evil.example/acme"}
    gone = {**ENGINES, "url": "https://acme.com/missing-page"}
    padded = {**ROCKET, "fact": "Acme Rocket has flown 900 missions."}  # a number its quote doesn't hold

    async with claude(applicant) as client:
        saved = (await client.call_tool("save_company_brief", {
            "company": "Acme", "facts": [ROCKET, ENGINES, TEAM, made_up, elsewhere, gone, padded]})).structured_content
        after = await client.call_tool("get_next_application", {})

    assert saved["saved"] is True
    assert saved["kept"] == 3
    reasons = {d["url"]: d["reason"] for d in saved["dropped"]}
    assert set(reasons) == {"https://acme.com/news/lander", "https://evil.example/acme",
                            "https://acme.com/missing-page", "https://acme.com/rocket"}
    # A site that isn't the company's or a listed news site is never read.
    assert "https://evil.example/acme" not in web
    brief = after.structured_content["company_brief"]
    assert [f["url"] for f in brief] == [ROCKET["url"], ENGINES["url"], TEAM["url"]]
    assert brief[2]["team"] == "Flight Software"


async def test_a_news_fact_stands_in_only_without_enough_own_facts(web):
    with_numbers = {**PRESS, "fact": "Acme opened a second launch site with 12 pads.",
                    "quote": "a second launch site on the coast this year, with 12 pads"}

    enough, enough_dropped = await briefs.check("Acme", [ROCKET, ENGINES, LANDER, PRESS], TODAY)
    short, short_dropped = await briefs.check("Acme", [ROCKET, ENGINES, PRESS, with_numbers], TODAY)

    # Three own-site facts passed: the news fact is left out.
    assert [f["url"] for f in enough] == [ROCKET["url"], ENGINES["url"], LANDER["url"]]
    assert [d.url for d in enough_dropped] == [PRESS["url"]]
    # Two did: the news fact stands in, but never one that states a number.
    assert [f["url"] for f in short] == [ROCKET["url"], ENGINES["url"], PRESS["url"]]
    assert [d.reason for d in short_dropped] == ["a news site's fact that states a number"]


async def _names_team(database, job: str, title: str, text: str) -> None:
    async with database() as session:
        await session.execute(sql("UPDATE job_postings SET title = :t, description = :d WHERE id = :id"),
                              {"t": title, "d": text, "id": job})
        await session.commit()


async def test_the_team_a_posting_names_is_researched_and_shared(running, applicant, database, web):
    _, job = await _queued(database, applicant)
    await _names_team(database, job, "Software Engineer Intern", "Join the Flight Software team at Acme.")
    other, theirs = await _another_students_application(database)
    await _describe(database, theirs, "Acme builds rockets.")
    await _names_team(database, theirs, "Intern, Flight Software", "Acme builds rockets.")
    await _tab_asks(other, theirs, WHY)
    them = uuid.UUID(other.rsplit("/", 1)[1])

    async with claude(applicant) as client:
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})
        task = (await client.call_tool("get_research_task", {})).structured_content
        off_posting = await client.call_tool("save_company_brief", {
            "company": "Acme", "scope": "team", "job_id": job, "team": "Avionics", "facts": [TEAM, AUTOPILOT]})
        saved = (await client.call_tool("save_company_brief", {
            "company": "Acme", "scope": "team", "job_id": job, "team": "Flight Software",
            "facts": [TEAM, AUTOPILOT]})).structured_content
        mine = (await client.call_tool("get_next_application", {})).structured_content["company_brief"]
        done = (await client.call_tool("get_research_task", {})).structured_content
    async with claude(them) as client:
        their_task = (await client.call_tool("get_research_task", {})).structured_content
        named = (await client.call_tool("save_company_brief", {
            "company": "Acme", "scope": "team", "job_id": theirs, "team": "Flight Software team",
            "facts": []})).structured_content
        theirs_brief = (await client.call_tool("get_next_application", {})).structured_content["company_brief"]

    assert (task["scope"], task["reason"], task["job_id"]) == ("team", "unnamed", job)
    assert "Flight Software team" in task["posting"]
    assert off_posting.is_error  # a team is named as the posting writes it
    assert saved["saved"] is True and saved["team"] == "Flight Software"
    assert [f["url"] for f in mine] == [ROCKET["url"], ENGINES["url"], LANDER["url"], TEAM["url"],
                                       TEAM["url"], AUTOPILOT["url"]]
    assert {f["team"] for f in mine[4:]} == {"Flight Software"}
    assert done["company"] is None
    # Another posting naming the same team reuses its brief.
    assert their_task["known_teams"] == ["Flight Software"]
    assert named["team"] == "Flight Software"
    assert [f["url"] for f in theirs_brief[4:]] == [TEAM["url"], AUTOPILOT["url"]]


async def test_a_posting_that_names_no_team_is_asked_once(running, applicant, database, web):
    _, job = await _queued(database, applicant)

    async with claude(applicant) as client:
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})
        task = (await client.call_tool("get_research_task", {})).structured_content
        none = (await client.call_tool("save_company_brief", {
            "company": "Acme", "scope": "team", "job_id": job, "team": None, "facts": []})).structured_content
        after = (await client.call_tool("get_research_task", {})).structured_content

    assert (task["scope"], task["reason"]) == ("team", "unnamed")
    assert none["saved"] is False and none["team"] is None
    assert after["company"] is None


async def test_a_brief_below_the_minimum_is_not_saved(running, applicant, database, web):
    await _queued(database, applicant)
    wrong = {**ENGINES, "quote": "Our engineers rewrote everything in Haskell last week."}

    async with claude(applicant) as client:
        saved = (await client.call_tool("save_company_brief", {
            "company": "Acme", "facts": [ROCKET, wrong]})).structured_content
        after = await client.call_tool("get_next_application", {})
        task = (await client.call_tool("get_research_task", {})).structured_content

    assert saved["saved"] is False
    # Held back, so the application is given without a brief.
    assert after.structured_content["job_id"] is not None
    assert after.structured_content["company_brief"] == []
    # Still missing, but held back a while: Claude saves again from the
    # reasons it was given, and the next student's Claude isn't sent at once.
    assert task["scope"] != "company"


async def test_an_applications_essays_wait_for_its_companys_brief(running, applicant, database, web):
    _, job = await _queued(database, applicant)

    async with claude(applicant) as client:
        first = (await client.call_tool("get_next_application", {})).structured_content
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})
        then = (await client.call_tool("get_next_application", {"chat": first["chat"]})).structured_content

    assert (first["job_id"], first["research_first"], first["questions"]) == (None, "Acme", [])
    assert then["job_id"] == job
    assert len(then["company_brief"]) == 4


async def test_choice_questions_go_out_before_the_brief(running, applicant, database, web):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _describe(database, job, "Acme builds rockets.")
    await _tab_asks(me, job, SIZE)

    async with claude(applicant) as client:
        got = (await client.call_tool("get_next_application", {})).structured_content

    assert (got["job_id"], got["research_first"]) == (job, None)


async def test_a_lower_scoring_rebuild_never_replaces_a_higher_one(running, applicant, database, web):
    await _queued(database, applicant)

    async with claude(applicant) as client:
        first = (await client.call_tool("save_company_brief", {
            "company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})).structured_content
        await _age(database, 45)
        worse = (await client.call_tool("save_company_brief", {
            "company": "Acme", "facts": [ROCKET, ENGINES, LANDER]})).structured_content
        kept = (await client.call_tool("get_next_application", {})).structured_content["company_brief"]

    assert first["saved"] is True
    assert worse["saved"] is False
    assert worse["score"] < worse["current_score"]
    assert len(kept) == 4


async def test_a_higher_scoring_rebuild_replaces_the_brief(running, applicant, database, web):
    await _queued(database, applicant)

    async with claude(applicant) as client:
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER]})
        better = (await client.call_tool("save_company_brief", {
            "company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})).structured_content
        kept = (await client.call_tool("get_next_application", {})).structured_content["company_brief"]

    assert better["saved"] is True
    assert better["score"] > better["current_score"]
    assert len(kept) == 4


async def test_only_stale_or_weak_briefs_are_offered(running, applicant, database, web):
    await _queued(database, applicant)

    async with claude(applicant) as client:
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})
        fresh = (await client.call_tool("get_research_task", {})).structured_content
        await _age(database, briefs.FRESH_DAYS + 1)
        stale = (await client.call_tool("get_research_task", {})).structured_content

    assert fresh["scope"] != "company"
    assert (stale["company"], stale["scope"], stale["reason"]) == ("Acme", "company", "stale")


async def test_a_weak_brief_is_offered(running, applicant, database, web):
    await _queued(database, applicant)
    undated = [{**f, "published": None} for f in (ROCKET, ENGINES, LANDER)]

    async with claude(applicant) as client:
        saved = (await client.call_tool("save_company_brief", {"company": "Acme", "facts": undated})).structured_content
        task = (await client.call_tool("get_research_task", {})).structured_content

    assert saved["saved"] is True
    assert saved["score"] < briefs.STRONG
    assert (task["company"], task["reason"]) == ("Acme", "weak")


async def test_a_brief_only_for_a_company_the_student_applies_to(running, applicant, database, web):
    await _queued(database, applicant)

    async with claude(applicant) as client:
        other = await client.call_tool("save_company_brief", {"company": "Globex", "facts": [ROCKET, ENGINES, LANDER]})

    assert other.is_error
    assert web == []


async def test_a_brief_is_shared_by_every_student_applying(running, applicant, database, web):
    await _queued(database, applicant)
    other, theirs_job = await _another_students_application(database)
    await _tab_asks(other, theirs_job, WHY)
    them = uuid.UUID(other.rsplit("/", 1)[1])

    async with claude(applicant) as client:
        await client.call_tool("save_company_brief", {"company": "Acme", "facts": [ROCKET, ENGINES, LANDER, TEAM]})
    async with claude(them) as client:
        theirs = (await client.call_tool("get_next_application", {})).structured_content["company_brief"]
        task = (await client.call_tool("get_research_task", {})).structured_content

    assert len(theirs) == 4
    assert task["scope"] != "company"


def test_scoring_counts_categories_facts_and_recency():
    today = datetime.date(2026, 10, 25)
    one = [{"category": "products", "published": None}] * 3
    spread = [{"category": c, "published": "2026-09"} for c in ("products", "launches", "engineering", "team")]
    old = [{"category": c, "published": "2024-01"} for c in ("products", "launches", "engineering", "team")]

    assert briefs.score(one, today) < briefs.score(old, today) < briefs.score(spread, today)
    assert briefs.score([], today) == 0


@pytest.mark.parametrize(("host", "own"), [
    ("acme.com", True), ("blog.acme.com", True), ("acme.co.uk", True), ("www.reuters.com", False),
    ("acme.com.evil.io", False), ("notacme.com", False), ("acme.github.io", False),
])
def test_the_companys_own_domain_is_named_for_it(host, own):
    assert briefs.own_domain(host, "Acme, Inc.") is own


@pytest.mark.parametrize(("host", "own"), [
    ("shield.ai", True), ("www.shield.ai", True), ("shield.com", False), ("shieldai.com", True), ("shield.io", False),
])
def test_a_domain_whose_ending_completes_the_name_is_the_companys(host, own):
    assert briefs.own_domain(host, "Shield AI") is own
