"""
The named fact (KAN-369): the company brief fact an answer of the
student's Claude uses, saved with it through the connector's save_answers,
so the Written Answers page shows it with the answer and the student can
read up on it before an interview. Spec seam 2, against this run's
throwaway test database.
"""

import json

import pytest
from sqlalchemy import text

from app.auto_apply import briefs
from tests.test_connector import (  # noqa: F401  (fixtures)
    WRITTEN,
    WHY,
    _api,
    _describe,
    _student_queues,
    _tab_asks,
    applicant,
    claude,
    running,
)

pytestmark = pytest.mark.anyio

LANDER = {"category": "launches", "fact": "Acme launched Acme Lander, which sets probes down on the Moon.",
          "url": "https://acme.com/news/lander", "quote": "we launched Acme Lander", "published": None, "team": None}
ANSWER = "I want to build flight software at Acme, and Acme Lander is the kind of work I want to do."


async def _brief(database, *facts: dict) -> None:
    async with database() as session:
        await session.execute(
            text("INSERT INTO company_briefs (company_key, company, facts, saved_at) VALUES (:k, 'Acme', CAST(:f AS jsonb), now())"),
            {"k": briefs.company_key("Acme"), "f": json.dumps(list(facts))},
        )
        await session.commit()


async def _answered(me: str) -> list[dict]:
    """What the Written Answers page lists as answered."""
    async with _api() as webapp:
        res = await webapp.get(f"{me}/written-answers")
    assert res.status_code == 200, res.text
    return res.json()


async def test_an_answer_keeps_the_brief_fact_it_names_for_the_page(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _describe(database, job, "Acme builds rockets.")
    await _brief(database, LANDER)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        off_brief = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": ANSWER, "named_fact": "Acme builds the fastest rockets.", **WRITTEN}]})
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": ANSWER, "named_fact": " acme launched Acme Lander, which sets probes down on the moon", **WRITTEN}]})

    assert off_brief.is_error and "company_brief" in off_brief.content[0].text
    assert saved.is_error is False, saved.content
    (posting,) = await _answered(me)
    assert posting["job_id"] == job and posting["company"] == "Acme"
    (question,) = posting["questions"]
    assert question["answer"] == ANSWER
    assert question["named_fact"] == {"fact": LANDER["fact"], "url": LANDER["url"]}


async def test_a_team_brief_fact_can_be_named_and_its_number_used(running, applicant, database):  # noqa: F811
    me, (job,) = await _student_queues(database, applicant, 1)
    await _describe(database, job, "Acme builds rockets. Join the Guidance team.")
    await _brief(database, LANDER)
    guidance = {"category": "team", "fact": "Acme's Guidance team flew 14 test landings this year.",
                "url": "https://acme.com/teams/guidance", "quote": "14 test landings", "published": None, "team": "Guidance"}
    async with database() as session:
        await session.execute(
            text("INSERT INTO company_briefs (company_key, team, company, facts, saved_at) "
                 "VALUES (:k, :t, 'Acme', CAST(:f AS jsonb), now())"),
            {"k": briefs.company_key("Acme"), "t": briefs.team_key("Guidance"), "f": json.dumps([guidance])},
        )
        await session.execute(text("INSERT INTO posting_teams (job_id, team) VALUES (:j, 'Guidance')"), {"j": job})
        await session.commit()
    await _tab_asks(me, job, WHY)
    answer = "I want to build flight software at Acme, where the Guidance team has flown 14 test landings."

    async with claude(applicant) as client:
        saved = await client.call_tool("save_answers", {"job_id": job, "answers": [
            {"name": "question_7", "answer": answer, "named_fact": guidance["fact"], **WRITTEN}]})

    assert saved.is_error is False, saved.content
    (posting,) = await _answered(me)
    (question,) = posting["questions"]
    assert question["named_fact"] == {"fact": guidance["fact"], "url": guidance["url"]}
