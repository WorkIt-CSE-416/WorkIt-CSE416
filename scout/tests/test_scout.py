"""
Scout without a model: ScriptedLLM stands in for the provider, so these run
with no network, no Ollama and no API key. Run from backend/, whose venv
installs this package: `uv run pytest ../scout/tests`.
"""

import asyncio

import httpx
import pytest
from openai import APIConnectionError, BadRequestError, RateLimitError
from workit_scout import llm as llm_module
from workit_scout.agent import MAX_REPLY_CHARS, run
from workit_scout.facts import job_facts, resume_facts
from workit_scout.llm import LLM
from workit_scout.prompt import NO_RESUME, SYSTEM_PROMPT
from workit_scout.quota import DailyQuota
from workit_scout.schemas import (
    ChatMessage,
    ErrorEvent,
    JobFacts,
    ResumeFacts,
    TextEvent,
)
from workit_scout.settings import ScoutSettings
from workit_scout.testing import ScriptedLLM

_REQUEST = httpx.Request("POST", "http://primary.test/v1/chat/completions")


def rate_limited() -> RateLimitError:
    return RateLimitError(
        "quota", response=httpx.Response(429, request=_REQUEST), body=None
    )


def bad_request() -> BadRequestError:
    return BadRequestError(
        "bad model", response=httpx.Response(400, request=_REQUEST), body=None
    )


def collect(llm: LLM, *texts: str, **facts) -> list:
    async def go():
        messages = [ChatMessage(role="user", content=t) for t in texts]
        return [event async for event in run(messages, llm, **facts)]

    return asyncio.run(go())


def reply(events) -> str:
    return "".join(e.delta for e in events if isinstance(e, TextEvent))


# --- the model seam -------------------------------------------------------------


def test_primary_answers():
    assert reply(collect(ScriptedLLM(["Hi", " there"]), "hello")) == "Hi there"


def test_rate_limit_falls_back_once():
    events = collect(ScriptedLLM(rate_limited(), fallback=["from fallback"]), "hello")
    assert reply(events) == "from fallback"


def test_unreachable_primary_falls_back():
    down = APIConnectionError(request=_REQUEST)
    assert reply(collect(ScriptedLLM(down, fallback=["ok"]), "hello")) == "ok"


def test_no_fallback_reports_quota():
    events = collect(ScriptedLLM(rate_limited()), "hello")
    assert events == [ErrorEvent(message=llm_module.OUT_OF_QUOTA)]


def test_misconfiguration_does_not_fall_back():
    fake = ScriptedLLM(bad_request(), fallback=["should not run"])
    assert collect(fake, "hello") == [ErrorEvent(message=llm_module.OFFLINE)]
    assert len(fake.prompts) == 1


def test_failure_mid_reply_is_not_retried():
    # A retry would send the user the start of the reply twice.
    events = collect(
        ScriptedLLM(["Half a", rate_limited()], fallback=["whole"]), "hello"
    )
    assert reply(events) == "Half a"
    assert events[-1] == ErrorEvent(message=llm_module.CUT_OFF)


def test_long_reply_is_cut_at_the_cap():
    events = collect(ScriptedLLM(["x" * 100] * 100), "hello")
    assert len(reply(events)) == MAX_REPLY_CHARS


# --- configuration ----------------------------------------------------------------


def test_fallback_is_off_unless_configured():
    assert len(LLM.from_settings(ScoutSettings(_env_file=None))._endpoints) == 1


def test_fallback_is_used_when_configured():
    s = ScoutSettings(
        _env_file=None, fallback_base_url="http://fallback/v1", fallback_model="nano"
    )
    assert [e.model for e, _ in LLM.from_settings(s)._endpoints] == [s.model, "nano"]


def test_half_a_fallback_is_an_error_not_silence():
    with pytest.raises(ValueError, match="SCOUT_FALLBACK_MODEL"):
        LLM.from_settings(
            ScoutSettings(_env_file=None, fallback_base_url="http://fallback/v1")
        )


def test_settings_read_the_scout_prefix(monkeypatch):
    monkeypatch.setenv("SCOUT_MODEL", "qwen3.5:9b")
    monkeypatch.setenv("SCOUT_DAILY_TURNS", "7")
    s = ScoutSettings(_env_file=None)
    assert (s.model, s.daily_turns) == ("qwen3.5:9b", 7)


# --- the daily cap ------------------------------------------------------------------


def test_quota_stops_at_the_limit_per_key():
    quota = DailyQuota()
    assert all(quota.take("a", 3) for _ in range(3))
    assert not quota.take("a", 3)
    assert quota.take("b", 3)


# --- facts: what Scout is told it knows ---------------------------------------------

RESUME = ResumeFacts(
    skills=["Python", "ROS"], experience=["Robotics Intern at Acme (2025–present)"]
)
JOB = JobFacts(
    title="Robot Software Intern",
    company="Rhoda AI",
    description="You will write ROS nodes.",
)


def test_system_prompt_leads_and_the_user_follows():
    fake = ScriptedLLM(["ok"])
    collect(fake, "hello")
    system, user = fake.prompts[0]
    assert system["role"] == "system"
    assert user == {"role": "user", "content": "hello"}


def test_resume_and_job_reach_the_model_after_the_frozen_prompt():
    fake = ScriptedLLM(["ok"])
    collect(fake, "Am I a fit?", resume=RESUME, job=JOB)
    assert fake.system_prompt.startswith(
        SYSTEM_PROMPT
    )  # the cacheable prefix is untouched
    for fact in (
        "Python",
        "Robotics Intern at Acme",
        "Rhoda AI",
        "You will write ROS nodes.",
    ):
        assert fact in fake.system_prompt


def test_no_resume_is_said_plainly_instead_of_left_blank():
    fake = ScriptedLLM(["ok"])
    collect(fake, "Am I a fit?")
    assert NO_RESUME in fake.system_prompt
    assert "The job they are asking about" not in fake.system_prompt


def test_a_job_without_a_description_says_so():
    fake = ScriptedLLM(["ok"])
    collect(fake, "Am I a fit?", job=JobFacts(title="Intern", company="Acme"))
    assert "description is not available" in fake.system_prompt


def test_grounding_rules_cover_both_resume_and_posting():
    assert "your resume doesn't mention" in SYSTEM_PROMPT
    assert "the posting doesn't say" in SYSTEM_PROMPT


# --- what Scout is allowed to know -------------------------------------------------


def test_resume_facts_carry_sections_only():
    parsed_json = {
        "skills": [{"skill_name": "Python", "category": "Languages"}],
        "experience": [
            {
                "company_name": "Acme",
                "title": "Robotics Intern",
                "start_date": "2025-06-01",
                "description": "Wrote   ROS nodes\nfor arms.",
            }
        ],
        "education": [
            {
                "institution": "Stony Brook",
                "degree": "BS",
                "field_of_study": "CS",
                "gpa": 3.7,
            }
        ],
        "projects": [
            {
                "project_name": "WorkIt",
                "url": "https://github.com/x/y",
                "description": "Job board.",
            }
        ],
    }
    facts = resume_facts(parsed_json)
    assert facts.skills == ["Python"]
    assert facts.experience == [
        "Robotics Intern at Acme (2025–present): Wrote ROS nodes for arms."
    ]
    assert facts.education == ["BS in CS at Stony Brook, GPA 3.7"]
    # A project's link is contact-adjacent and useless to Scout: it never crosses.
    assert facts.projects == ["WorkIt: Job board."]
    assert "github.com" not in facts.model_dump_json()


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
