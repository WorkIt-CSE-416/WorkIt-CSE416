"""
The style card through the connector (KAN-384), spec seam 2: the student's
Claude reads their writing samples, saves the style card it builds from
them, and gets the card with each application after. Without samples it
gets none and writes in a plain voice. Driven by the MCP client as Claude
drives it, on this run's throwaway test database.
"""

import pytest

from tests import test_connector
from tests.test_connector import (
    REVIEWED,
    WHY,
    _api,
    _signed_in_as,
    _student_queues,
    _tab_asks,
    claude,
)

pytestmark = pytest.mark.anyio

running = test_connector.running
applicant = test_connector.applicant

ESSAY = "I rebuilt our club's sign-up sheet as a small web app, and dues collection went from weeks to a day."
COVER = "I tutored three classmates in data structures, and all three passed the final."
CARD = "Short sentences, 10 to 20 words. Opens with the result, then how. Plain verbs; no adjectives of praise."


async def _gives_samples(applicant, *texts: str) -> list[str]:
    """The student adds samples on WorkIt (the webapp's call); answers their ids."""
    _signed_in_as(applicant)
    async with _api() as webapp:
        ids = []
        for text in texts:
            res = await webapp.post(f"/applicants/{applicant}/writing-samples", json={"text": text})
            assert res.status_code == 201, res.text
            ids.append(res.json()["id"])
    return ids


async def _call(client, tool: str, args: dict | None = None):
    result = await client.call_tool(tool, args or {})
    assert not result.is_error, result.content
    return result.structured_content


async def test_without_samples_an_application_comes_with_no_style_card(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)

    async with claude(applicant) as client:
        got = await _call(client, "get_next_application")
        samples = await _call(client, "get_writing_samples")

    assert got["job_id"] == job
    assert got["style_card"] is None
    assert got["style_card_needed"] is False
    assert samples == {"samples": [], "style_card": None}


async def test_claude_reads_the_samples_saves_a_card_and_gets_it_with_each_application(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    await _gives_samples(applicant, ESSAY, COVER)

    async with claude(applicant) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
        before = await _call(client, "get_next_application")
        samples = await _call(client, "get_writing_samples")
        saved = await _call(client, "save_style_card", {"card": CARD})
        after = await _call(client, "get_next_application")

    assert tools["get_writing_samples"].annotations.read_only_hint is True
    assert tools["save_style_card"].annotations.read_only_hint is False
    # Samples given, no card yet: the application says one is needed.
    assert (before["style_card"], before["style_card_needed"]) == (None, True)
    assert samples == {"samples": [ESSAY, COVER], "style_card": None}
    assert saved == {"saved": True}
    assert (after["style_card"], after["style_card_needed"]) == (CARD, False)
    # The student sees the card on WorkIt too.
    _signed_in_as(applicant)
    async with _api() as webapp:
        assert (await webapp.get(f"/applicants/{applicant}/writing-samples")).json()["style_card"] == CARD


async def test_a_changed_sample_drops_the_card_for_a_new_one(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    (essay,) = await _gives_samples(applicant, ESSAY)

    async with claude(applicant) as client:
        await _call(client, "save_style_card", {"card": CARD})
        _signed_in_as(applicant)
        async with _api() as webapp:
            res = await webapp.put(f"/applicants/{applicant}/writing-samples/{essay}", json={"text": COVER})
            assert res.status_code == 200
        got = await _call(client, "get_next_application")

    assert (got["style_card"], got["style_card_needed"]) == (None, True)


async def test_a_card_without_samples_or_out_of_bounds_is_refused(running, applicant, database):
    async with claude(applicant) as client:
        no_samples = await client.call_tool("save_style_card", {"card": CARD})
        await _gives_samples(applicant, ESSAY)
        empty = await client.call_tool("save_style_card", {"card": "  "})
        too_long = await client.call_tool("save_style_card", {"card": "x" * 4_001})
        nothing = await _call(client, "get_writing_samples")

    assert no_samples.is_error and empty.is_error and too_long.is_error
    assert nothing["style_card"] is None


async def test_an_answer_copying_a_stored_sample_is_refused(running, applicant, database):
    me, (job,) = await _student_queues(database, applicant, 1)
    await _tab_asks(me, job, WHY)
    await _gives_samples(applicant, ESSAY)
    copying = "At Acme I rebuilt our club's sign-up sheet as a small web app."

    async with claude(applicant) as client:
        refused = await client.call_tool("save_answers", {"job_id": job, "answers": [{"name": "question_7", "answer": copying, "review": REVIEWED}]})

    assert refused.is_error
    assert "writing samples" in refused.content[0].text
    assert (await _tab_asks(me, job))[0]["answer"] is None
