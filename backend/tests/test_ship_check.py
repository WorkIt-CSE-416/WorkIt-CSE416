"""
The ship check (KAN-386, app/scripts/ship_check.py): the connector's own
tools over a chat's applications with no database, and a blind read that
hides who wrote each answer and records the picks by writer.
"""

import json
import random

import pytest
from mcp import Client

from app.scripts import ship_check

QUESTION = {"name": "why", "question": "Why us?", "required": True, "max_length": 200}


def _app(app: str) -> dict:
    return {"id": app, "company": app.title(), "title": "Intern", "posting": f"{app} builds things.",
            "questions": [QUESTION]}


@pytest.fixture
def folder(tmp_path):
    data = {"experience": "Built a bus tracker.", "skills": ["Python"],
            "applications": [_app(a) for a in ("acme", "bolt", "core")],
            "chats": [["acme", "bolt", "core"], ["core", "bolt", "acme"]],
            "samples": ["I like building robots that find their own way through a maze."]}
    (tmp_path / "applications.json").write_text(json.dumps(data))
    return tmp_path


@pytest.mark.anyio
async def test_a_chat_is_handed_its_applications_in_order_and_saves_their_place(folder):
    with ship_check.stub(folder, 1) as server:
        async with Client(server) as client:
            # No brief to research, so both writers work from the posting alone.
            assert (await client.call_tool("get_research_task", {})).structured_content["company"] is None
            first =(await client.call_tool("get_next_application", {})).structured_content
            assert (first["company"], first["experience"]) == ("Core", "Built a bus tracker.")
            assert first["questions"][0]["max_length"] == 200
            too_long = await client.call_tool(
                "save_answers", {"job_id": first["job_id"], "answers": [{"name": "why", "answer": "x" * 201}]})
            assert too_long.is_error
            await client.call_tool(
                "save_answers", {"job_id": first["job_id"], "answers": [{"name": "why", "answer": "Buses."}]})
            second = (await client.call_tool("get_next_application", {"chat": first["chat"]})).structured_content

    assert second["company"] == "Bolt"
    assert first["style_card_needed"] is True
    saved = json.loads((folder / "connector" / "chat-2.json").read_text())
    assert saved == [{"application": "core", "question": "why", "answer": "Buses.", "chat": 2, "position": 1}]


def _answers(folder, ours: list[tuple[str, int, int]]) -> None:
    (folder / "connector.json").write_text(json.dumps({"writer": "connector", "answers": [
        {"application": a, "question": "why", "answer": f"ours {a} {chat}", "chat": chat, "position": pos}
        for a, chat, pos in ours]}))
    (folder / "other.json").write_text(json.dumps({"writer": "Other", "answers": [
        {"application": a, "question": "why", "answer": f"theirs {a}"} for a in ("acme", "bolt", "core")]}))


def test_pairs_each_answer_with_the_others_and_first_with_last(folder):
    _answers(folder, [("acme", 1, 1), ("bolt", 1, 2), ("core", 1, 3), ("core", 2, 1), ("acme", 2, 3)])

    found = ship_check.pairs(folder)

    assert sum(p["kind"] == "vs" for p in found.values()) == 5
    order = {k: p for k, p in found.items() if p["kind"] == "order"}
    assert sorted(order) == ["order/acme/why/chat-1-2", "order/core/why/chat-2-1"]
    assert order["order/acme/why/chat-1-2"]["answers"] == {"first": "ours acme 1", "last": "ours acme 2"}


def test_the_read_hides_the_writer_and_records_the_pick_by_writer(folder):
    _answers(folder, [("acme", 1, 1), ("acme", 2, 3)])
    shown: list[str] = []
    replies = iter(["1", "", "=", "dull", "2", "", "q"])

    ship_check.read(folder, random.Random(4), ask=lambda prompt: next(replies), show=shown.append)

    screen = "\n".join(shown[: shown.index(next(s for s in shown if s.startswith("# Ship check")))])
    for writer in ("connector", "Other", "first", "last"):
        assert f"({writer}" not in screen and f"{writer})" not in screen
    picks = json.loads((folder / "picks.json").read_text())
    assert len(picks["picks"]) == 3
    first = picks["order"][0]
    assert picks["picks"][first]["winner"] == picks["sides"][first][0]
    assert sorted(p["winner"] for p in picks["picks"].values()).count("tie") == 1
    assert "Signed off" in (folder / "summary.md").read_text()


@pytest.mark.anyio
async def test_a_style_card_built_in_one_chat_is_kept_for_the_next(folder):
    with ship_check.stub(folder, 0) as server:
        async with Client(server) as client:
            samples = (await client.call_tool("get_writing_samples", {})).structured_content
            assert samples["samples"] == ["I like building robots that find their own way through a maze."]
            await client.call_tool("save_style_card", {"card": "Short plain sentences."})

    with ship_check.stub(folder, 1) as server:
        async with Client(server) as client:
            first = (await client.call_tool("get_next_application", {})).structured_content
            # The copying check reads the samples, as WorkIt's save does.
            copied = await client.call_tool("save_answers", {"job_id": first["job_id"], "answers": [
                {"name": "why", "answer": "I like building robots that find their own way through a maze."}]})

    assert (first["style_card"], first["style_card_needed"]) == ("Short plain sentences.", False)
    assert copied.is_error
