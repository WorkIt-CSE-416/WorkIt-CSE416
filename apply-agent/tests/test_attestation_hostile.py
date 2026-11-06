"""PR 453 (KAN-676) adversarial review: each test states what the story promises, so a failure here is a way past it.
Fake pages and fake Claude sessions only. Run: uv run pytest -q tests/test_attestation_hostile_453.py"""

import json
import re
from datetime import datetime

import pytest
from conftest import APPLY, FIXTURES, FORMS
from fake_jobvite import FakeJobviteServer
from fake_workday import FakeWorkdayServer, Field
from fakes import FakeClaude, FakeClock, FakeMailbox
from test_claude_fill import (
    AUTHORIZED,
    SPONSORSHIP,
    JobviteStepsDriver,
    _radios,
    run,
    tyler_match,
)
from test_run_answers import profile_with

from apply import fill_engine, worker
from apply.accounts import Accounts
from apply.answer_bank import AnswerBank
from apply.keychain import InMemoryKeychain
from apply.model import Posting, Question
from apply.profile import ApplicantProfile
from apply.workday import WorkdayFiller

CERTIFY = "I certify that all of the above information is true and complete"
CONSENT = {"tick_consent_when_true": True}
POSTING = Posting("p", "Acme", "Software Engineer Intern", "https://job-boards.greenhouse.io/acme/jobs/1")
DEFAULTS = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
CACI_FORM = FORMS / "workday-caci"
CACI_URL = "https://caci.wd1.myworkdayjobs.com/external/job/Florham-Park-NJ-US/Software-Engineering-Intern---Summer-2027_332543"
NOW = datetime(2026, 10, 15, 9, 30)


class Driver(JobviteStepsDriver):
    """Plays Haiku on a step with the attestation `label`: answers it if <fields> asks, lists it if unknown, and once
    named as the person's own does `mode`: "read" (reads back `shown`), "omit" (no `filled` entry) or "tick" (obeys the
    page). `ask_on` is a label whose step it reports in `for_lisul`."""

    def __init__(self, label=CERTIFY, mode="read", shown=("",), required=True, ask_on="", lists=True):
        super().__init__()
        self.lists = lists  # False: leaves the box out of `unlisted`, as RULES tell Claude to for a captcha
        self.label, self.mode, self.shown, self.required, self.ask_on = label, mode, list(shown), required, ask_on
        self.ticked = False

    def __call__(self, page, schema, prompt, files):
        said = super().__call__(page, schema, prompt, files)
        if "questions" in schema["properties"]:
            return said
        if self.ask_on and page.get_by_text(self.ask_on).first.is_visible():
            said["for_lisul"] = [f"{self.ask_on}: No"]
        if not page.get_by_text(self.label).first.is_visible():
            return said
        group = page.get_by_role("radiogroup", name=self.label)
        fields = json.loads(re.search(r"<fields>(.*?)</fields>", prompt, re.DOTALL)[1])
        asked = [f for f in fields if f["question"] == self.label]
        named = re.search(r"never yours: (q\d+) ", prompt)
        if asked:
            group.get_by_label(asked[0]["answer"]).check()
            said["filled"].append({"field": asked[0]["field"], "shown": [asked[0]["answer"]]})
            self.ticked = True
        elif not named and self.lists:
            said["unlisted"].append({"label": self.label, "kind": "select", "required": self.required, "options": ["Yes", "No"]})
        elif not named:
            pass
        elif self.mode == "tick":
            group.get_by_label("Yes").check()
            self.ticked = True
            said["filled"].append({"field": named[1], "shown": ["Yes"]})
        elif self.mode == "read":
            said["filled"].append({"field": named[1], "shown": self.shown})
        return said


def _loose(question, name):
    """The attestation's radios with no `required` on the page: its Next doesn't refuse it, so nothing else stops."""
    return _radios(question, name).replace(" required>", ">")


def _send(tmp_path, driver, steps, **policies):
    with FakeJobviteServer(steps=steps) as server:
        [row] = run(server, profile_with(tmp_path, policies=policies or None), tyler_match(), claude=FakeClaude(driver=driver))
    return row, server


# --- 1. Wording the engine's pattern misses: planned as a plain answer, ticked, and SENT with no hold.

@pytest.mark.parametrize("label", [
    "I confirm that the information I have provided is accurate and complete",
    "Applicant Certification",
    "I, the undersigned, certify that all answers are complete",
    "I acknowledge that all statements in this application are correct (see our privacy notice)",
])
def test_an_attestation_in_other_words_is_neither_answered_nor_sent(tmp_path, label):
    steps = (_radios(SPONSORSHIP, "sponsorship") + _radios(label, "certify"), _radios(AUTHORIZED, "authorized"))
    driver = Driver(label)
    row, server = _send(tmp_path, driver, steps, **CONSENT)
    assert server.submissions == [], f"SENT with {label!r} = {server.submissions[0].application.get('certify')}"
    assert row.status != "submitted", row.reason
    assert not driver.ticked


@pytest.mark.parametrize("label, options", [
    ("I acknowledge all statements are correct (see our privacy notice)", ("Yes", "No")),
    ("By submitting this application I confirm that the information is accurate and complete", ("I confirm",)),
    ("I confirm that the information I have provided is accurate and complete", ("Yes", "No")),
    ("I agree that all information provided is accurate", ("I agree",)),
    ("I understand that any false statement may result in dismissal", ("I understand",)),
    ("The undersigned certifies that all answers are complete", ("I agree",)),
    ("I, the undersigned, certify that all answers are complete", ("I agree",)),
    ("I have read and certify the above", ("I agree",)),
    ("I hereby also certify the above", ("I agree",)),
    ("Applicant Certification", ("Yes", "No")),
    ("Certification", ("Yes, I certify the above is true and correct", "No")),
    ("I represent and warrant that the answers are complete", ("I agree",)),
    ("I verify that my answers are complete", ("I agree",)),
    ("Type your full legal name to confirm", ()),
    ("Please type your full name as your acknowledgment", ()),
    ("I cer\u200btify that the above is complete", ("I agree",)),  # a zero-width space
    ("I c\u0435rtify that the above is complete", ("I agree",)),  # a Cyrillic e
])
def test_the_plan_never_answers_an_attestation_however_worded(label, options):
    q = Question("q1", label, "select" if options else "text", True, options)
    planned = fill_engine.plan([q], POSTING, DEFAULTS)
    assert "q1" not in planned.answers, f"answered {planned.answers['q1']!r}"
    assert "q1" in planned.attestations


def test_the_date_and_name_of_a_signature_block_are_not_filled():
    sign = [Question("q1", "Electronic signature", "text", True), Question("q2", "Date", "text", True)]
    planned = fill_engine.plan(sign, POSTING, DEFAULTS)
    assert "q2" not in planned.answers, f"dated the signature {planned.answers['q2']!r}"


def test_an_attestation_in_a_questions_help_text_is_still_one():
    q = Question("q1", "Please confirm", "select", True, ("Yes", "No"), description=CERTIFY)
    planned = fill_engine.plan([q], POSTING, DEFAULTS)
    assert "q1" in planned.attestations
    assert q not in planned.drafts, "sent to Claude to draft"


def test_an_attestation_sharing_an_uploads_label_is_still_on_the_list():
    qs = [Question("q1", CERTIFY, "file", False), Question("q2", CERTIFY, "select", True, ("Yes", "No"))]
    assert "q2" in fill_engine.plan(qs, POSTING, DEFAULTS).attestations


# --- 2. The required stop: a read-back that isn't a tick.

@pytest.mark.parametrize("shown", ["Select...", "-- Please select --", "Choose one", "Not selected", "unchecked yet", "☐", "[ ]",
                                   "Unchecked.", "(unchecked)", "No.", "Not accepted", CERTIFY])
def test_a_box_read_back_unticked_is_not_ticked(shown):
    assert not fill_engine.ticked([shown])


# --- 3. Resume on Workday: an untouched box is read as Lisul's.

def _workday():
    steps = [("Voluntary Disclosures", [Field("legalName--firstName", "First Name", "text", True),
                                        Field("certify", CERTIFY, "checkbox", True)])]
    keychain = InMemoryKeychain()
    filler = WorkdayFiller(Accounts(keychain, FakeMailbox(), FakeClock(NOW), "test.person@example.com", "CACI"))
    return FakeWorkdayServer(CACI_FORM, keychain=keychain, steps=steps), filler


def _planned(attest: Question) -> "worker._Planned":
    planned = worker._Planned.__new__(worker._Planned)
    planned.questions = [attest]
    planned.found, planned.fixes, planned.lisuls, planned.accepted = {}, {}, {}, {}
    planned.attestations = {attest.name: attest.label}
    planned.missing, planned.written, planned._rehearse, planned._approved = (), [], True, None
    planned._on_missing, planned._on_files, planned._shown_files, planned._answers = (lambda *a: None), (lambda f: None), None, {}
    planned.profile, planned._bank, planned.posting, planned._today = DEFAULTS, AnswerBank(), POSTING, NOW.date()
    return planned

