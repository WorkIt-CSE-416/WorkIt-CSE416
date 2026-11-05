"""Seam 1: whole `apply run`s that turn on the answer planner: option wording,
Not eligible and the Missing fact round trip."""

import json
from datetime import date, datetime
from pathlib import Path

import pytest
import yaml
from conftest import (
    AMPLIFY_URL,
    ARC_FORM,
    FIXTURES,
    FORMS,
    PERRY_FORM,
    PERRY_URL,
    PURE_STORAGE_FORM,
    RHOMBUS_FORM,
    XCIMER_FORM,
)
from fake_lever import FakeLeverServer
from fake_workable import FakeWorkableServer
from fakes import FakeClaude, FakeClock, FakeJobServer, FakeMailbox, ScriptedUsage

from apply import worker
from apply.adapters import Adapters
from apply.answer_bank import AnswerBank
from apply.cli import main
from apply.feed import SimplifyFeed
from apply.model import Posting, Question
from apply.profile import ApplicantProfile
from apply.tracker import InMemoryTracker
from apply.workable import WorkableFiller

DATACOR_FORM = FORMS / "greenhouse-datacor"


def profile_with(folder: Path, policies: dict | None = None, **facts) -> Path:
    """The test Applicant profile plus `facts` (dotted keys), saved in `folder`
    with the test policies beside it, plus `policies`."""
    profile = yaml.safe_load((FIXTURES / "profile.yaml").read_text())
    profile["files"]["resume_pdf"] = str(FIXTURES / "one-pager.pdf")
    for key, value in facts.items():
        *sections, last = key.split(".")
        node = profile
        for part in sections:
            node = node.setdefault(part, {})
        node[last] = value
    path = folder / "profile.yaml"
    path.write_text(yaml.safe_dump(profile, sort_keys=False))
    (folder / "policies.yaml").write_text((FIXTURES / "policies.yaml").read_text()
                                          + (yaml.safe_dump(policies) if policies else ""))
    return path


def run(job_server, profile: Path, feed: str = "feed.json", tracker: InMemoryTracker | None = None) -> InMemoryTracker:
    tracker = tracker or InMemoryTracker()
    adapters = Adapters(
        feed=SimplifyFeed((FIXTURES / feed).read_bytes),
        tracker=tracker,
        site=job_server,
        claude=FakeClaude(),
        mailbox=FakeMailbox(),
        usage=ScriptedUsage(),
        clock=FakeClock(datetime(2026, 10, 15, 9, 30)),
    )
    main(["run", "--profile", str(profile)], adapters=adapters)
    return tracker


@pytest.fixture
def arc_server():
    with FakeJobServer(ARC_FORM) as server:
        yield server


@pytest.fixture
def datacor_server():
    with FakeJobServer(DATACOR_FORM) as server:
        yield server


def test_one_stored_fact_is_sent_in_each_questions_own_wording(arc_server, tmp_path):
    profile = profile_with(tmp_path, **{"voluntary_self_id.veteran": False})

    tracker = run(arc_server, profile)

    [row] = tracker.rows()
    assert row.status == "submitted"
    [sent] = arc_server.submissions
    # Arc asks twice: "I am not a protected veteran" in the EEOC block, and
    # "No, I am not a veteran or active member" in its demographic block.
    assert sent.application["veteran_status"] == "1"
    demographic = {a["question_id"]: a["answer_options"][0]["answer_option_id"] for a in sent.application["demographic_answers"]}
    assert demographic[4007783008] == "4046689008"


def test_self_id_answers_on_greenhouse_multi_selects_are_submitted(arc_server, tmp_path):
    profile = profile_with(tmp_path, **{"voluntary_self_id.gender": "decline", "voluntary_self_id.race": "East Asian"})

    tracker = run(arc_server, profile)

    [row] = tracker.rows()
    assert row.status == "submitted"
    [sent] = arc_server.submissions
    ticked = {a["question_id"]: [o["answer_option_id"] for o in a["answer_options"]] for a in sent.application["demographic_answers"]}
    assert ticked[4007778008] == ["4046660008"]  # gender identity: I don't wish to answer
    assert ticked[4007779008] == ["4046662008"]  # racial/ethnic background: East Asian


# Pure Storage's form asks for these on top of the test profile.
PURE_STORAGE_FACTS = {
    "screeners.previously_employed_by": [],
    "education.returning_to_school_after_internship": True,
    "education.degree_level_now": "Undergraduate",
    "logistics.onsite_5_days_ok": True,
    "answered_questions": {"Does the deemed export rule affect your employment by Everpure?": "No"},
    "education.school": "Ohio State University - Columbus",
    "education.degree": "Bachelor's Degree",
    "education.majors": ["Computer Science"],
    "education.start_date": "08/2024",
    "education.expected_graduation": "2028-05",
}


@pytest.fixture
def pure_storage_server():
    with FakeJobServer(PURE_STORAGE_FORM) as server:
        yield server


def test_location_and_education_are_picked_from_greenhouses_own_lists(pure_storage_server, tmp_path):
    # The test profile stores Columbus / OH / USA; Greenhouse spells places out.
    profile = profile_with(tmp_path, **PURE_STORAGE_FACTS)

    tracker = run(pure_storage_server, profile, feed="feed-purestorage.json")

    [row] = tracker.rows()
    assert (row.status, row.reason) == ("submitted", ""), row.reason
    [sent] = pure_storage_server.submissions
    assert sent.application["location"] == "Columbus, Ohio, United States"
    # Columbus, OH in the saved geocoder response.
    assert (float(sent.application["latitude"]), float(sent.application["longitude"])) == (39.980761, -82.985331)
    # Ids from Greenhouse's saved school search and degree and discipline lists.
    assert sent.application["educations"] == [{
        "school_name_id": "528259",  # Ohio State University - Columbus
        "degree_id": "529549",  # Bachelor's Degree
        "discipline_id": "530585",  # Computer Science
        "start_date": {"month": 8, "year": "2024"},
        "end_date": {"month": 5, "year": "2028"},
    }]


def test_a_lever_card_with_a_school_picker_and_checkboxes_is_submitted(tmp_path):
    card = "cards[172bc91a-073a-4fe0-b995-520a2ed2e1a0]"
    profile = profile_with(tmp_path, **{
        "education.school": "Ohio State University",
        "education.majors": ["Computer Science"],
        "education.class_year": "3rd Year Undergrad (Junior)",
        "education.expected_graduation": "2028-05",
        "education.gpa_cumulative": 3.8,
        "experience_facts.role_interests": ["Backend Development"],
        "logistics.onsite_5_days_ok": True,
        "files.unofficial_transcript_pdf": str(FIXTURES / "one-pager.pdf"),
    })

    with FakeLeverServer(RHOMBUS_FORM, parse_delay=0) as rhombus:
        tracker = run(rhombus, profile, feed="feed-rhombus.json")

    [row] = tracker.rows()
    assert (row.status, row.reason) == ("submitted", ""), row.reason
    [sent] = rhombus.submissions
    assert sent.application[f"{card}[field0]"] == "Ohio State University"  # university picker
    assert sent.application[f"{card}[field2]"] == "Backend Development"  # area of interest (select all that apply)
    assert sent.application[f"{card}[field7]"] == "Yes"  # full-time onsite, a one-box multi-select


def test_self_id_answers_go_into_a_lever_demographic_survey(tmp_path):
    survey = "surveysResponses[eaea8ee4-16c6-4561-a65e-f30bf42a0f8b][responses]"
    profile = profile_with(tmp_path, **{
        "voluntary_self_id.gender": "Male",
        "voluntary_self_id.race": "Asian",
        # What Xcimer's form requires besides:
        "identity.current_company": "Example State University",
        "education.degree": "Bachelor's Degree",
        "education.gpa_cumulative": 3.8,
        "answered_questions": {
            "Please share your previous internship, co-curricular, research and/or hands-on engineering experience:": "Robotics team.",
        },
    })

    with FakeLeverServer(XCIMER_FORM, parse_delay=0) as xcimer:
        tracker = run(xcimer, profile, feed="feed-xcimer.json")

    [row] = tracker.rows()
    assert (row.status, row.reason) == ("submitted", ""), row.reason
    [sent] = xcimer.submissions
    assert sent.application[f"{survey}[field1]"] == "Asian"  # I identify my ethnicity as (select all that apply)
    assert sent.application[f"{survey}[field2]"] == "Male"  # What gender do you identify as?


def test_a_masters_only_screener_ends_the_application_as_not_eligible(datacor_server, tmp_path):
    profile = profile_with(tmp_path, **{"education.degree": "Bachelor's Degree"})

    tracker = run(datacor_server, profile, feed="feed-datacor.json")

    [row] = tracker.rows()
    assert row.status == "not eligible"
    assert "Master's or PhD" in row.reason
    assert row.date_applied is None
    assert datacor_server.submissions == []


def test_a_missing_fact_pauses_the_application_until_lisul_answers_it(arc_server, tmp_path):
    profile = profile_with(tmp_path, **{"identity.email": None})
    profile.write_text("# Lisul's notes stay put\n" + profile.read_text())

    tracker = run(arc_server, profile)

    [row] = tracker.rows()
    assert (row.status, row.missing_fact) == ("missing fact", "Email")
    assert arc_server.submissions == []

    tracker.edit_as_lisul(row.application_id, answer="lisul.answered@example.com")
    run(arc_server, profile, tracker=tracker)

    [row] = tracker.rows()
    assert row.status == "submitted"
    [sent] = arc_server.submissions
    assert sent.application["email"] == "lisul.answered@example.com"
    saved = profile.read_text()
    assert yaml.safe_load(saved)["identity"]["email"] == "lisul.answered@example.com"
    assert saved.startswith("# Lisul's notes stay put")

    run(arc_server, profile, tracker=tracker)  # a later run doesn't apply again
    assert len(arc_server.submissions) == 1


class PayingWorkable:
    """The fake Workable, but its Posting names its pay as Scout's does."""

    def __init__(self, server, job_api: str, text: str):
        self._server, self._job_api, self._text = server, job_api, text

    def fetch(self, url: str, body: bytes | None = None) -> bytes:
        if url == self._job_api:
            return json.dumps({"title": "Options Analyst Intern", "description": f"<p>{self._text}</p>"}).encode()
        return self._server.fetch(url, body)

    def open(self, url: str, worker: int = 0):
        return self._server.open(url, worker)


def test_a_number_box_for_pay_gets_the_middle_of_the_postings_own_range(tmp_path):
    perry_job = "https://apply.workable.com/api/v2/accounts/perryhomes/jobs/D309E69A5B"
    posting = Posting("perry", "Perry Homes", "Options Analyst Intern", PERRY_URL)
    profile = ApplicantProfile.load(profile_with(tmp_path))

    with FakeWorkableServer(PERRY_FORM) as perry:
        site = PayingWorkable(perry, perry_job, "Compensation Hourly pay: $25-30/hour, depending on experience.")
        result = worker.apply_to(posting, WorkableFiller(), site, profile, FakeClaude(), rehearse=True)

    salary = "CA_37268"  # "What is your desired salary?", a number box
    assert result.filled.answers[salary] == "27.5"
    assert result.filled.readback[salary] == "27.5"


def test_a_workable_education_entry_is_saved_without_the_graduation_its_picker_refuses(tmp_path):
    """Workable's picker takes no month after this one; Lisul graduates in 2099 here."""
    posting = Posting("perry", "Perry Homes", "Options Analyst Intern", PERRY_URL)
    schooling = {"education.school": "Stony Brook University", "education.start_date": "2024-08",
                 "education.expected_graduation": "2099-05"}
    profile = ApplicantProfile.load(profile_with(tmp_path, **schooling))

    with FakeWorkableServer(PERRY_FORM) as perry:
        result = worker.apply_to(posting, WorkableFiller(), perry, profile, FakeClaude(), rehearse=True)

    answers, readback = result.filled.answers, result.filled.readback
    assert "Not filled" not in result.reason, result.reason
    assert answers["education.1.school"] == "Stony Brook University" and answers["education.1.start_date"] == "08/2024"
    assert "education.1.end_date" not in answers
    assert {name: readback[name] for name in answers if name.startswith("education")} == \
        {name: a for name, a in answers.items() if name.startswith("education")}


@pytest.mark.parametrize("required, expected", [(False, None), (True, "N/A")])
def test_a_follow_up_to_a_question_claude_answered_no_is_not_a_missing_fact(tmp_path, required, expected):
    # Amplify (seen live, 2026-10-21): Claude answered the question it follows
    # No, and the follow-up was held as a Missing fact.
    posting = Posting("amplify", "Amplify", "Software Engineering Intern", AMPLIFY_URL)
    working = Question("w", "Are you currently working with Amplify Education, Inc.?", "select", True, ("Yes", "No"))
    agency = Question("a", "If a contingent worker, which agency are you employed with?", "text", required)
    claude = FakeClaude(drafts={"Are you currently working": "No"}, needs_lisul=("If a contingent worker",))
    planned = worker._Planned(posting, None, ApplicantProfile.load(profile_with(tmp_path)), claude, {}, None, False,
                              AnswerBank(), date(2026, 10, 21))

    assert planned.add([working, agency]) is None  # no Missing fact
    assert planned.answers == {"w": "No", **({"a": expected} if expected else {})}


SARONIC_URL = "https://jobs.ashbyhq.com/saronic/60afb634-5515-4347-824a-3816735541c2/application"
# Saronic's Ashby (live, 2026-11-04): the follow-up was written as an essay and asked as a Required Essay fact.
# The question it follows is one no rule answers, so Claude drafts it.
KNOWS = Question("knows", "Do you have a friend who works at Saronic?", "select", True, ("Yes", "No"))
IF_YES = Question("if_yes", "If yes, please provide the employee\u2019s name and your relationship", "textarea", False)


@pytest.mark.parametrize("rehearse", [False, True])
def test_an_if_yes_follow_up_to_a_no_claude_drafted_is_left_blank_never_asked_nor_written(tmp_path, rehearse):
    posting = Posting("saronic", "Saronic Technologies", "Software Engineer Intern (Summer 2027)", SARONIC_URL)
    claude = FakeClaude(drafts={"Do you have a friend": "No"})
    planned = worker._Planned(posting, None, ApplicantProfile.load(profile_with(tmp_path)), claude, {}, None, rehearse,
                              AnswerBank(), date(2026, 11, 4))

    assert planned.add([KNOWS, IF_YES]) is None  # no Missing fact
    assert planned.answers == {"knows": "No"} and planned.missing == ()
    assert planned.written == [] and "if_yes" in planned.left  # never an essay: blank on purpose
    assert "your relationship" not in json.dumps(claude.calls)  # nor sent to Claude to draft


def test_an_if_yes_follow_up_to_a_yes_is_asked_with_the_forms_own_label_and_required_flag(tmp_path):
    posting = Posting("saronic", "Saronic Technologies", "Software Engineer Intern (Summer 2027)", SARONIC_URL)
    claude = FakeClaude(drafts={"Do you have a friend": "Yes"})
    planned = worker._Planned(posting, None, ApplicantProfile.load(profile_with(tmp_path)), claude, {}, None, False,
                              AnswerBank(), date(2026, 11, 4))

    result = planned.add([KNOWS, IF_YES])
    label = IF_YES.label.strip()
    assert (result.missing_fact, result.required) == (label, {label: False})  # a Missing fact, never an Essay fact
    assert planned.written == []


@pytest.mark.parametrize("required", [False, True])
def test_what_an_essay_asks_is_required_only_when_its_form_requires_the_essay(required):
    # Saronic (live, 2026-11-04): an optional field's Essay fact showed Required in Needs you.
    from apply import essays
    ask = "Essay fact: What did the robot do?"
    essay = essays.Essay(Question("e", "Tell us about a made-up robot", "textarea", required), "",
                         plan=essays.Plan("general", asks=(ask,)))
    planned = worker._Planned.__new__(worker._Planned)
    planned.questions, planned.written, planned.lisuls, planned.found = [essay.question], [essay], {}, {}
    planned._rehearse, planned.missing, planned._on_missing = True, (), lambda *heard: None
    planned.profile = type("Profile", (), {"get": lambda self, key: None})()  # made up: it holds nothing
    planned._bank = AnswerBank()
    planned._missing([], [ask])

    assert planned.required == {ask: required}


CATCH_ALL = Question("extra", "Additional information", "textarea", False)
WHY = Question("why", "Why do you want to work at Amplify?", "textarea", True)


@pytest.mark.parametrize("given", ["", "I can start on May 18 and intern for twelve weeks."])
def test_an_optional_catch_all_box_is_always_left_blank_and_never_drafted_nor_asked(tmp_path, given):
    # Voleon (seen live, 2026-11-04): "Additional information" got two new, relevant sentences, and Lisul
    # said "it still putting stuff here": he wants nothing there.
    posting = Posting("amplify", "Amplify", "Software Engineering Intern", AMPLIFY_URL)
    claude = FakeClaude(essays={"Additional information": given})
    planned = worker._Planned(posting, None, ApplicantProfile.load(profile_with(tmp_path)), claude, {}, None, False,
                              AnswerBank(), date(2026, 11, 4))

    assert planned.add([WHY, CATCH_ALL]) is None  # never a Missing fact
    assert planned.kept_blank == {"extra": worker.CATCH_ALL_BLANK} and "extra" not in planned.answers
    assert not any("Additional information" in prompt for prompt in claude.prompts)  # Claude never sees it
    assert not [h for h in planned.holds if "Additional information" in h]  # no "Claude wrote nothing" hold
    verification = planned.verify({"why": planned.answers["why"], "extra": ""}, [], ())
    [note] = [f for f in verification.flags if f.field == "Additional information"]
    assert not note.holds and note.why == f"left blank on purpose: {worker.CATCH_ALL_BLANK}"


def test_a_required_catch_all_box_is_still_answered(tmp_path):
    posting = Posting("amplify", "Amplify", "Software Engineering Intern", AMPLIFY_URL)
    required = Question("extra", "Additional information", "textarea", True)
    claude = FakeClaude(essays={"Additional information": "I can start on May 18 and intern for twelve weeks."})
    planned = worker._Planned(posting, None, ApplicantProfile.load(profile_with(tmp_path)), claude, {}, None, False,
                              AnswerBank(), date(2026, 11, 4))

    assert planned.add([WHY, required]) is None
    assert planned.kept_blank == {} and planned.answers["extra"] == "I can start on May 18 and intern for twelve weeks."
