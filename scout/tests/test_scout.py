"""
Scout without a model: ScriptedLLM stands in for the provider, so these run
with no network, no Ollama and no API key. Run from backend/, whose venv
installs this package: `uv run pytest ../scout/tests`.
"""

import asyncio
import json

import httpx
import pytest
from openai import (
    APIConnectionError,
    AsyncOpenAI,
    BadRequestError,
    InternalServerError,
    RateLimitError,
)
from pydantic import BaseModel
from workit_scout import llm as llm_module
from workit_scout.agent import MAX_REPLY_CHARS, run
from workit_scout.facts import bank_facts, job_facts
from workit_scout.identity import Identity
from workit_scout.llm import LLM
from workit_scout.schemas import (
    ChatMessage,
    ErrorEvent,
    ResumeFacts,
    TextEvent,
)
from workit_scout.settings import Endpoint, ScoutSettings
from workit_scout.testing import ScriptedLLM

_REQUEST = httpx.Request("POST", "http://primary.test/v1/chat/completions")


def rate_limited() -> RateLimitError:
    return RateLimitError(
        "quota", response=httpx.Response(429, request=_REQUEST), body=None
    )


def server_error() -> InternalServerError:
    return InternalServerError(
        "down", response=httpx.Response(503, request=_REQUEST), body=None
    )


def bad_request() -> BadRequestError:
    return BadRequestError(
        "bad model", response=httpx.Response(400, request=_REQUEST), body=None
    )


def collect(llm: LLM, *texts: str, identity=Identity(), **facts) -> list:
    async def go():
        messages = [ChatMessage(role="user", content=t) for t in texts]
        return [event async for event in run(messages, llm, identity=identity, **facts)]

    return asyncio.run(go())


def reply(events) -> str:
    return "".join(e.delta for e in events if isinstance(e, TextEvent))


# --- the model seam -------------------------------------------------------------


def test_primary_answers():
    assert reply(collect(ScriptedLLM(["Hi", " there"]), "hello")) == "Hi there"


def test_rate_limit_falls_back_once():
    events = collect(ScriptedLLM(rate_limited(), ["from fallback"]), "hello")
    assert reply(events) == "from fallback"


def test_the_chain_moves_down_past_a_429_a_5xx_and_a_dead_endpoint():
    down = APIConnectionError(request=_REQUEST)
    fake = ScriptedLLM(rate_limited(), server_error(), down, ["fourth"])
    assert reply(collect(fake, "hello")) == "fourth"
    assert len(fake.prompts) == 4


def test_unreachable_primary_falls_back():
    down = APIConnectionError(request=_REQUEST)
    assert reply(collect(ScriptedLLM(down, ["ok"]), "hello")) == "ok"


def test_no_fallback_reports_quota():
    events = collect(ScriptedLLM(rate_limited()), "hello")
    assert events == [ErrorEvent(message=llm_module.OUT_OF_QUOTA)]


def test_misconfiguration_does_not_fall_back():
    fake = ScriptedLLM(bad_request(), ["should not run"])
    assert collect(fake, "hello") == [ErrorEvent(message=llm_module.OFFLINE)]
    assert len(fake.prompts) == 1


def test_failure_mid_reply_is_not_retried():
    # A retry would send the user the start of the reply twice.
    events = collect(ScriptedLLM(["Half a", rate_limited()], ["whole"]), "hello")
    assert reply(events) == "Half a"
    assert events[-1] == ErrorEvent(message=llm_module.CUT_OFF)


def test_the_prompt_sent_holds_no_identity_data():
    fake = ScriptedLLM(["ok"])
    me = Identity(
        name="Sam Seeker",
        email="sam@example.com",
        phone="631-555-0100",
        links=["https://github.com/samseeker"],
    )
    collect(
        fake,
        "I'm Sam Seeker, sam@example.com, (631) 555-0100, github.com/samseeker",
        identity=me,
        resume=ResumeFacts(projects=["Robot arm, by Sam Seeker"]),
    )
    sent = str(fake.prompts)
    for value in ("Sam", "Seeker", "sam@example.com", "555", "samseeker"):
        assert value not in sent
    assert "[name]" in sent and "[email]" in sent and "[phone]" in sent


def test_long_reply_is_cut_at_the_cap():
    events = collect(ScriptedLLM(["x" * 100] * 100), "hello")
    assert len(reply(events)) == MAX_REPLY_CHARS


# --- the structured call -----------------------------------------------------------


class Entry(BaseModel):
    title: str
    bullets: list[str]


def ask_json(llm: LLM, identity=Identity()) -> Entry:
    messages = [{"role": "user", "content": "draft it"}]
    return asyncio.run(llm.complete_json(messages, Entry, identity=identity))


def test_a_structured_call_returns_the_checked_object():
    fake = ScriptedLLM(['{"title": "Intern", ', '"bullets": ["Built a robot"]}'])
    assert ask_json(fake) == Entry(title="Intern", bullets=["Built a robot"])


def test_a_structured_call_falls_down_the_chain():
    fake = ScriptedLLM(
        rate_limited(), server_error(), ['{"title": "T", "bullets": []}']
    )
    assert ask_json(fake).title == "T"


@pytest.mark.parametrize("bad", ['{"title": "T"}', "Sure! Here it is: {", ""])
def test_a_reply_that_fails_the_check_is_rejected(bad):
    with pytest.raises(llm_module.InvalidReply):
        ask_json(ScriptedLLM([bad], ['{"title": "T", "bullets": []}']))


def test_a_structured_call_sends_no_identity_data():
    fake = ScriptedLLM(['{"title": "T", "bullets": []}'])
    asyncio.run(
        fake.complete_json(
            [{"role": "user", "content": "Sam Seeker at sam@example.com"}],
            Entry,
            identity=Identity(name="Sam Seeker"),
        )
    )
    assert fake.prompts == [[{"role": "user", "content": "[name] at [email]"}]]


def test_requests_carry_a_json_schema_and_never_tool_choice():
    sent = []

    def answer(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body)
        content = '{"title": "T", "bullets": []}'
        if body.get("stream"):
            chunk = {"choices": [{"index": 0, "delta": {"content": "hi"}}]}
            text = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n"
            return httpx.Response(
                200, text=text, headers={"content-type": "text/event-stream"}
            )
        message = {"role": "assistant", "content": content}
        return httpx.Response(
            200,
            json={
                "id": "1",
                "object": "chat.completion",
                "created": 0,
                "model": "m",
                "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
            },
        )

    model = LLM([Endpoint("http://only.test/v1", "m")])
    model._endpoints = [
        (
            endpoint,
            AsyncOpenAI(
                base_url=endpoint.base_url,
                api_key="k",
                http_client=httpx.AsyncClient(transport=httpx.MockTransport(answer)),
            ),
        )
        for endpoint, _ in model._endpoints
    ]
    assert ask_json(model).title == "T"
    assert reply(collect(model, "hello")) == "hi"

    structured, streamed = sent
    assert structured["response_format"]["type"] == "json_schema"
    assert structured["response_format"]["json_schema"]["schema"] == (
        Entry.model_json_schema()
    )
    assert "tool_choice" not in structured and "tool_choice" not in streamed


# --- configuration ----------------------------------------------------------------


def test_one_endpoint_unless_a_chain_is_configured():
    assert len(LLM.from_settings(ScoutSettings(_env_file=None))._endpoints) == 1


def test_the_chain_comes_from_env_in_order(monkeypatch):
    monkeypatch.setenv(
        "SCOUT_ENDPOINTS",
        '[{"base_url": "http://groq/v1", "model": "gpt-oss-120b", "api_key": "k"},'
        ' {"base_url": "http://cf/v1", "model": "gpt-oss-20b",'
        ' "reasoning_effort": "low"}]',
    )
    endpoints = [
        e for e, _ in LLM.from_settings(ScoutSettings(_env_file=None))._endpoints
    ]
    assert [(e.model, e.api_key, e.reasoning_effort) for e in endpoints] == [
        ("gpt-oss-120b", "k", None),
        ("gpt-oss-20b", None, "low"),
    ]


def test_settings_read_the_scout_prefix(monkeypatch):
    monkeypatch.setenv("SCOUT_MODEL", "qwen3.5:9b")
    s = ScoutSettings(_env_file=None)
    assert s.model == "qwen3.5:9b"


# --- what Scout is allowed to know -------------------------------------------------


def _entry(section, title, **fields):
    return {"section": section, "title": title, "bullets": [], **fields}


def test_bank_facts_carry_every_section_and_the_original_bullets():
    bank = {
        "skills": [{"name": "Python", "group": "Languages", "entry_ids": []}],
        "entries": [
            _entry(
                "education", "Stony Brook University", degree="BS", field_of_study="CS",
                gpa=3.7, start_month="2023-09", end_month="2027-05", end_kind="expected",
                coursework=["Algorithms"], location="Stony Brook, NY",
            ),
            _entry(
                "experience", "Robotics Intern", organization="Acme", start_month="2025-06",
                end_kind="present", location="Austin, TX",
                bullets=[{"id": "b1", "position": 0, "text": "Wrote   ROS nodes\nfor arms."},
                         {"id": "b2", "position": 1, "text": "Cut latency 40%."}],
            ),
            _entry("projects", "WorkIt", link="https://github.com/x/y",
                   bullets=[{"id": "b3", "position": 0, "text": "Job board."}]),
            _entry("leadership", "President", organization="Robotics Club",
                   start_month="2024-09", end_month="2025-05", end_kind="month"),
            _entry("awards", "Dean's List", organization="Stony Brook", award_date="2024-12"),
            _entry("certifications", "AWS Cloud Practitioner", issuer="Amazon", end_month="2025-03"),
        ],
    }
    facts = bank_facts(bank, has_upload=True)
    assert facts.skills == ["Python"]
    assert facts.education == ["BS in CS at Stony Brook University (2023–expected 2027), GPA 3.7"]
    assert facts.experience == [
        "Robotics Intern at Acme (2025–present): Wrote ROS nodes for arms. Cut latency 40%."
    ]
    # A project's link is identity data: it never crosses.
    assert facts.projects == ["WorkIt: Job board."]
    assert facts.leadership == ["President at Robotics Club (2024–2025)"]
    assert facts.awards == ["Dean's List at Stony Brook (2024)"]
    assert facts.certifications == ["AWS Cloud Practitioner from Amazon (2025)"]
    assert "github.com" not in facts.model_dump_json()


def test_a_long_entry_is_one_short_line():
    bullets = [{"id": str(i), "position": i, "text": "Shipped a feature " * 10} for i in range(5)]
    facts = bank_facts({"entries": [_entry("projects", "Big", bullets=bullets)], "skills": []}, has_upload=False)
    (line,) = facts.projects
    assert len(line) <= 302 and line.endswith("…")


def test_job_facts_use_readable_labels():
    row = {
        "title": "Robot Software Intern",
        "company": "Rhoda AI",
        "apply_url": "https://jobs.example/1",
        "experience_level": "new_grad",
        "work_style": "onsite",
        "location": None,
        "description": "D",
    }
    facts = job_facts(row)
    assert (facts.experience_level, facts.work_style, facts.description) == (
        "New grad",
        "On site",
        "D",
    )


def test_a_student_job_reads_as_an_internship():
    # KAN-233: every internship is a student job; the job's facts carry no job
    # type, so the level says it.
    row = {"title": "SWE Intern", "company": "Acme", "experience_level": "student"}
    assert job_facts(row).experience_level == "Student (internship)"
