"""Claude writes as the applicant the profile names: every prompt Apply builds
for an Application says the profile's first name and school, never another
applicant's."""

import json

import pytest
from conftest import FIXTURES, POLICIES
from fakes import FakeClaude

from apply import answering, essays, gates, home, story_map, writing
from apply.model import Posting, Question
from apply.profile import ApplicantProfile

PROFILE = FIXTURES / "planner-profile.yaml"  # Test Person, of Example State University
CLUB = "## Example Robotics Club (Sep 2025-present; C++)"
BUILT = "- Built a line-following robot that placed second of 12 teams at the state contest."
BANK = f"""# Story bank

## How Test writes
Plain sentences, mostly short.

## Test's own answers, word for word
> I like building small tools that help my club run its events, and I like seeing other members use them every week.
> When a robot of ours failed on the day of a contest, I rewrote the turn code that night and we placed second.

## Education
- Example State University, B.S. Computer Science, May 2028.

{CLUB}
{BUILT}

## Skills
- Python, C++
"""
POSTING = Posting("p", "Figma", "Software Engineer Intern", "https://jobs.example.com/1")
WHY = Question("why", "Why do you want to work at Figma?", "textarea", True)
LETTER = Question("cl", "Cover Letter", "file", False)


@pytest.fixture
def test_persons_bank(monkeypatch, tmp_path):
    bank = tmp_path / "story-bank.md"
    bank.write_text(BANK)
    monkeypatch.setattr(home, "STORY_BANK", bank)
    monkeypatch.setattr(writing, "VOICE", tmp_path / "voice.md")  # no style card
    return bank


def written(profile: ApplicantProfile) -> list[dict]:
    """Every call Claude gets while Apply writes a why-company essay and a cover letter."""
    claude = FakeClaude()
    sent = []

    def ask(**call):
        sent.append(call)
        wanted = call["schema"]["properties"]
        if "plan" in wanted:  # a plan that leads every essay with the club's story
            types = answering.load()
            return {"plan": {key: {"type": (kind := entry["properties"]["type"]["default"]), "parts": ["What it asks"],
                                   "story": CLUB.removeprefix("## "), "company_fact": "", "angle": "His own robot.",
                                   "link_kind": "",
                                   "slots": [{"slot": s.name, "quotes": [BUILT.removeprefix("- ")], "ask": ""}
                                             for s in types[kind].slots if s.required is True]}
                             for key, entry in wanted["plan"]["properties"].items()}}
        return FakeClaude.ask(claude, **call)

    claude.ask = ask
    essays.write(claude, POSTING, [WHY, LETTER], profile)
    return sent


def said(call: dict) -> str:
    return "\n".join([call["system"], call["prompt"], json.dumps(call["schema"])])


def test_claude_writes_as_test_person_never_as_another_applicant(test_persons_bank):
    calls = written(ApplicantProfile.load(PROFILE, POLICIES))

    assert len(calls) >= 4  # plan, draft, claim check, editor
    for call in calls:
        assert "Lisul" not in said(call) and "Stony Brook" not in said(call)
    draft = next(c for c in calls if "essays" in c["schema"]["properties"])
    assert "as Test, in the first person" in draft["system"]
    assert "Example State University" in json.dumps(draft["schema"])


def test_every_call_says_the_applicants_own_pronouns(test_persons_bank):
    profile = ApplicantProfile.load(PROFILE, POLICIES)
    profile.set("identity.pronouns", "they/them/theirs")

    calls = written(profile)

    for call in calls:
        assert "Test's pronouns are they/them/theirs." in call["system"]


def test_with_lisuls_profile_the_prompts_say_lisul_and_stony_brook_as_before(test_persons_bank, tmp_path):
    profile = ApplicantProfile.load(PROFILE, POLICIES)
    profile.set("identity.preferred_first_name", "Lisul")
    profile.set("education.school", "Stony Brook University")

    calls = written(profile)

    draft = next(c for c in calls if "essays" in c["schema"]["properties"])
    assert "as Lisul, in the first person" in draft["system"]
    assert "never needs Lisul: answer it from what they did" in draft["system"]
    assert "reads as Lisul typed it themselves" in draft["system"]
    assert "a computer science student at Stony Brook University, and when they graduate" in json.dumps(draft["schema"])
    editor = next(c for c in calls if "edited" in c["schema"]["properties"])
    assert editor["system"].startswith("You edit Lisul's written answers")
    for call in calls:
        assert "@NAME@" not in said(call) and "@SCHOOL@" not in said(call)


def test_test_persons_own_answers_are_the_samples_of_his_voice(test_persons_bank):
    assert "I rewrote the turn code that night" in writing.samples()


def test_a_company_named_only_in_test_persons_past_answers_is_still_a_leftover(monkeypatch, tmp_path):
    briefs = tmp_path / "company-briefs"
    briefs.mkdir()
    (briefs / "notion.md").write_text("# Notion\n")
    monkeypatch.setattr(gates, "BRIEFS", briefs)
    bank = "## Test's own answers, word for word\nNotion, \"Why Notion?\": I use it daily.\n\n## Education\n- A school.\n"
    assert gates.other_companies("I would bring this to Notion.", "Figma", bank) == ["names another company: Notion"]


def test_test_persons_story_areas_come_from_his_bank_headings():
    assert story_map.episodes(BANK) == [("- Example State University, B.S. Computer Science, May 2028.", "education"),
                                        (BUILT, "example-robotics-club")]
