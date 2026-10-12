"""
The resume builder's writing (workit_scout/builder.py) against RepliesLLM: what
it parses out of an answer, what its grounding check throws away, and that it
asks once more when an answer won't parse. No network or model.
"""

import asyncio
from datetime import date

import httpx
from openai import APIConnectionError
from workit_scout.builder import (
    EntryFacts,
    grounded,
    parse_bullets,
    parse_entries,
    parse_numbered,
    structure_entries,
    tailor_bullets,
    write_bullets,
)
from workit_scout.llm import ScoutUnavailable
from workit_scout.schemas import JobFacts
from workit_scout.testing import RepliesLLM

ENTRY = EntryFacts(
    section="experience",
    title="Software Engineering Intern",
    organization="Acme",
    notes="made the checkout page in React load in 1.5s instead of 4s",
)
JOB = JobFacts(title="Frontend Intern", company="Shopify", description="React, web performance.")


def run(coro):
    return asyncio.run(coro)


def test_grounded_rejects_invented_numbers_and_names():
    source = "made the checkout page in React load in 1.5s instead of 4s"
    assert grounded("Cut checkout load time from 4s to 1.5s with React", source)
    assert not grounded("Cut load time by 60%", source)
    assert not grounded("Rebuilt the checkout page in React and TypeScript", source)
    # The first word is capitalised by grammar, not because it is a name
    assert grounded("Made the checkout page faster", source)


def test_parse_bullets_keeps_only_dash_lines_and_cleans_them():
    answer = 'Here you go:\n- reduced load time from 4s to 1.5s.\n* "Built tests"\n- Grew revenue 40%'
    assert parse_bullets(answer, "4s 1.5s tests") == ["Reduced load time from 4s to 1.5s", "Built tests"]


def test_write_bullets_retries_once_when_nothing_parses():
    llm = RepliesLLM(["Sure! I can help.", "- Cut checkout load time from 4s to 1.5s in React"])
    assert run(write_bullets(llm, ENTRY)) == ["Cut checkout load time from 4s to 1.5s in React"]
    assert len(llm.prompts) == 2


def test_write_bullets_gives_up_after_the_retry():
    llm = RepliesLLM(["no", "still no"])
    assert run(write_bullets(llm, ENTRY)) == []


def test_write_bullets_sends_only_the_entry():
    llm = RepliesLLM(["- Built the checkout page"])
    run(write_bullets(llm, ENTRY))
    sent = llm.prompts[0][1]["content"]
    assert "Acme" in sent and "checkout page" in sent
    assert "@" not in sent and "http" not in sent
    assert "Tense: past" in sent


def test_write_bullets_asks_for_present_tense_for_a_current_role():
    llm = RepliesLLM(["- Builds the checkout page"])
    run(write_bullets(llm, ENTRY.model_copy(update={"current": True})))
    assert "Tense: present" in llm.prompts[0][1]["content"]


def test_unavailable_model_raises_for_the_route_to_answer():
    request = httpx.Request("POST", "http://primary.test/v1/chat/completions")
    llm = RepliesLLM([APIConnectionError(request=request)])
    try:
        run(write_bullets(llm, ENTRY))
    except ScoutUnavailable:
        return
    raise AssertionError("expected ScoutUnavailable")


def test_parse_entries_keeps_what_the_user_said():
    source = "Treasurer of the Stony Brook chess club since September 2023, ran a $3000 budget. Won HackSBU 2024."
    answer = """## activity
title: Treasurer
organization: Stony Brook Chess Club
location: Stony Brook, NY
start: 2023-09
end: present
- Managed a $3000 budget
- Grew membership by 50%
## award
title: HackSBU Winner
organization: HackSBU
start: 2024-01
## hobby
title: Chess
"""
    activity, award = parse_entries(answer, source)
    assert activity.section == "activity" and activity.organization == "Stony Brook Chess Club"
    # "NY" was never said, nor was a 50% growth; the city was
    assert activity.location == "Stony Brook"
    assert activity.bullets == ["Managed a $3000 budget"]
    assert activity.start_date == date(2023, 9, 1) and activity.end_date is None
    # A bare year, which the model padded to January
    assert award.start_date is None


def test_structure_entries_retries_once():
    llm = RepliesLLM(["I found two things.", "## experience\ntitle: Barista\norganization: Starbucks"])
    entries = run(structure_entries(llm, "I worked as a barista at Starbucks"))
    assert [(e.title, e.organization) for e in entries] == [("Barista", "Starbucks")]


def test_parse_numbered_keeps_facts_and_drops_unchanged():
    originals = ["Built a checkout page in React that loads in 1.5s", "Wrote unit tests with Jest", "Ran a club"]
    answer = (
        "1. Improved web performance with a React checkout page loading in 1.5s\n"
        "2. Wrote automated tests\n"  # dropped Jest
        "3. Ran a club\n"  # unchanged
    )
    assert parse_numbered(answer, originals) == [
        "Improved web performance with a React checkout page loading in 1.5s",
        None,
        None,
    ]


def test_tailor_sends_the_posting_and_bullets():
    llm = RepliesLLM(["1. Improved web performance of the React checkout page"])
    out = run(tailor_bullets(llm, ["Sped up the React checkout page"], JOB))
    assert out == ["Improved web performance of the React checkout page"]
    sent = llm.prompts[0][1]["content"]
    assert "Shopify" in sent and "1. Sped up the React checkout page" in sent


def test_parse_entries_merges_a_repeated_entry():
    source = "Treasurer of the Stony Brook Chess Club; managed the $3,000 budget. Intern at Acme, then intern at Globex."
    answer = """## activity
title: Treasurer
organization: Stony Brook Chess Club
- Managed the $3,000 budget
## activity
title: Treasurer
- Managed the $3,000 budget for the club
## experience
title: Intern
organization: Acme
## experience
title: Intern
organization: Globex
"""
    entries = parse_entries(answer, source)
    assert [(e.title, e.organization) for e in entries] == [
        ("Treasurer", "Stony Brook Chess Club"),
        ("Intern", "Acme"),
        ("Intern", "Globex"),
    ]
    assert entries[0].bullets == ["Managed the $3,000 budget", "Managed the $3,000 budget for the club"]


def test_parse_entries_reads_details_and_gives_an_award_one_date():
    source = "BS in Computer Science at Stony Brook, GPA 3.6. StudyBuddy, built with Python and Flask. Won 1st place at HackNY in March 2025."
    answer = """## education
title: BS
organization: Stony Brook
field: Computer Science
gpa: 3.6
- GPA: 3.6
## project
title: StudyBuddy
technologies: Python, Flask
## award
title: 1st Place
organization: HackNY
start: 2025-03
end: 2025-03
"""
    edu, project, award = parse_entries(answer, source)
    assert (edu.field_of_study, edu.gpa) == ("Computer Science", 3.6) and edu.bullets == []
    assert project.technologies == "Python, Flask" and project.organization is None
    assert (award.start_date, award.end_date) == (None, date(2025, 3, 1))
