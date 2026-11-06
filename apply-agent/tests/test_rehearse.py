"""Seam 1 for rehearsals: whole `rehearse` runs over pasted links, with fakes
for every outside system. Each link goes the real Application path to the
form's last page and stops there; no Filler's submit is ever called and no
job system records a Submission."""

import _thread
import json
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import pytest
import yaml
from conftest import (
    ANDURIL_URL,
    ARC_FORM,
    ARC_URL,
    HERMEUS_FORM,
    HERMEUS_URL,
    IMMUTA_FORM,
    IMMUTA_URL,
    PURE_STORAGE_FORM,
    PURE_STORAGE_URL,
    SKYDIO_FORM,
    SKYDIO_URL,
)
from fake_bamboohr import FakeBambooServer
from fake_jobvite import URL as JOBVITE_URL
from fake_jobvite import FakeJobviteServer
from fake_lever import FakeLeverServer
from fake_paylocity import URL as PAYLOCITY_URL
from fake_paylocity import FakePaylocityServer
from fake_workday import EXPERIENCE_STEPS, STEPS, FakeWorkdayServer
from fake_workday import Field as WorkdayField
from fakes import (
    FakeClaude,
    FakeClock,
    FakeJobServer,
    FakeMailbox,
    RecordingBoard,
    ScriptedUsage,
)
from playwright.sync_api import sync_playwright
from test_claude_fill import (
    ANSWERED,
    ESSAY,
    LUNAR_FORM,
    LUNAR_URL,
    WHY_LUNAR,
    BambooDriver,
    CaptchaDriver,
    JobviteDriver,
    PaylocityDriver,
    SendingDriver,
    captcha_profile,
)
from test_employer_accounts import CACI, CACI_FORM, CACI_URL, XCEL_FORM, XCEL_URL, World
from test_greenhouse_filler import board_listing_schools
from test_run_answers import profile_with

from apply import rehearsal, worker
from apply.adapters import Adapters, Drive
from apply.answer_bank import AnswerBank
from apply.ashby import AshbyFiller
from apply.claude_fill import ClaudeFill
from apply.feed import SimplifyFeed
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.keychain import InMemoryKeychain
from apply.lever import LeverFiller
from apply.model import Posting
from apply.notify import RecordingNotifier
from apply.profile import ApplicantProfile
from apply.records import FolderRecords
from apply.repair import RepairRequests
from apply.tracker import InMemoryTracker
from apply.workday import WorkdayFiller

NOW = datetime(2026, 10, 15, 9, 30)


class NeverSubmits:
    """A real Filler whose submit fails the test."""

    def __init__(self, filler):
        self._filler = filler
        self.submitted = False

    def question_set(self, url, site):
        return self._filler.question_set(url, site)

    def fill(self, page, questions, answers):
        return self._filler.fill(page, questions, answers)

    def submit(self, page):
        self.submitted = True
        pytest.fail("a rehearsal called the Filler's submit")


def adapters(site, claude=None, **more) -> Adapters:
    more = {"tracker": InMemoryTracker(), "mailbox": FakeMailbox(), **more}
    return Adapters(
        feed=SimplifyFeed(lambda: b"[]"), site=site, claude=claude or FakeClaude(), usage=ScriptedUsage(),
        clock=FakeClock(NOW), **more,
    )


def rehearse(urls, site, profile, claude=None, workers=1, **more) -> list[rehearsal.Rehearsed]:
    lines = []
    done = rehearsal.rehearse(urls, adapters(site, claude, **more), ApplicantProfile.load(profile), workers,
                              keep_open=False, out=lines.append)
    assert len(lines) == len(urls)  # one summary line per link
    return done


SCRIPTED = {
    "greenhouse": (lambda: FakeJobServer(ARC_FORM), ARC_URL, GreenhouseFiller),
    "ashby": (lambda: FakeJobServer(SKYDIO_FORM), SKYDIO_URL, AshbyFiller),
    "lever": (lambda: FakeLeverServer(IMMUTA_FORM, parse_delay=0.2), IMMUTA_URL, LeverFiller),
}
# The company and role each job system names for its Posting.
NAMED = {
    "greenhouse": ("Arc Boat Company", "Software Engineering Intern"),
    "ashby": ("Skydio", "Software Engineer Intern - Summer 2027"),
    "lever": ("Immuta", "Full-Stack Engineering Internship - Summer 2027"),
}


@pytest.mark.parametrize("system", SCRIPTED)
def test_a_rehearsal_fills_the_form_to_its_last_page_and_never_submits(monkeypatch, tmp_path, system):
    server, url, filler_class = SCRIPTED[system]
    filler = NeverSubmits(filler_class())
    monkeypatch.setitem(FILLERS, system, filler)

    with server() as fake:
        [done] = rehearse([url], fake, profile_with(tmp_path))

    assert (done.posting.url, done.posting.job_system) == (url, system)
    assert (done.posting.company, done.posting.title) == NAMED[system]
    assert done.line().startswith(" | ".join([*NAMED[system], system]))
    assert done.outcome == "ready to submit", done.why
    assert done.filled > 0
    assert not filler.submitted
    assert fake.submissions == []
    line = done.line()
    assert system in line and "ready to submit" in line and f"{done.filled}/{done.asked} fields filled" in line


def test_missing_facts_leave_their_fields_blank_and_are_listed(monkeypatch, tmp_path):
    filler = NeverSubmits(GreenhouseFiller())
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    profile = profile_with(tmp_path, **{"identity.email": None, "identity.legal_last_name": None})

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile)

    assert done.outcome == "ready to submit", done.why
    assert done.missing == ("Last Name", "Email")
    assert done.filled >= 6  # first name, phone, résumé, work authorization...: every answer it had
    assert "Missing facts: Last Name; Email" in done.line()
    assert not filler.submitted and fake.submissions == []


def test_holds_do_not_stop_a_rehearsal_and_claude_fill_never_clicks_submit(monkeypatch, tmp_path):
    monkeypatch.setattr(ClaudeFill, "submit", lambda self, page: pytest.fail("a rehearsal clicked Claude fill's submit"))
    # No start date in the profile, so "Date Available" is a Missing fact.
    profile = profile_with(tmp_path, **{f"answered_questions.{q}": a for q, a in ANSWERED.items() if q != "Date Available"},
                           **{"logistics.earliest_start_date": None})
    (tmp_path / "policies.yaml").write_text("calibration_run: 10\n")  # a run would hold its first 10
    claude = FakeClaude(driver=BambooDriver(), essays={"Tell us why": WHY_LUNAR},
                        drive_tokens=[18_000, 31_500], ask_tokens=1_000)

    with FakeBambooServer(LUNAR_FORM) as server:
        [done] = rehearse([LUNAR_URL], server, profile, claude)

    assert (done.posting.job_system, done.outcome) == ("other", "ready to submit")
    # Its High-stakes essay was written and filled anyway; a run would hold it for that, and for the Calibration run.
    assert any("essays" in call["schema"]["properties"] for call in claude.calls)
    assert f"High-stakes essay: '{ESSAY}'" in done.why
    assert "Calibration run: Application 1 of 10" in done.why
    assert done.missing == ("Date Available",)
    # Two drives, then 1,000 for each other call: the essay's probe, plan, draft, checks and editor's passes, and the review.
    assert done.tokens == 18_000 + 31_500 + 1_000 * (len(claude.calls) - 2)
    assert "Claude fill:" not in done.why  # its cost is in the tokens, not among the holds
    assert server.submissions == []


@pytest.mark.parametrize(("names", "outcome"), [("Submit Application", "ready to submit"), ("", "handoff")])
def test_claude_clicking_the_forms_submit_in_a_rehearsal_sends_nothing(monkeypatch, tmp_path, names, outcome):
    # Roblox (live): a click on the submit Claude then names leaves the form filled, not sent; any other is a Handoff.
    monkeypatch.setattr(ClaudeFill, "submit", lambda self, page: pytest.fail("a rehearsal clicked Claude fill's submit"))
    profile = profile_with(tmp_path, **{f"answered_questions.{q}": a for q, a in ANSWERED.items()},
                           **{f"answered_questions.{ESSAY}": "Lunar rovers are what I build in my spare time."})

    with FakeBambooServer(LUNAR_FORM) as server:
        [done] = rehearse([LUNAR_URL], server, profile, FakeClaude(driver=SendingDriver(names=names)))

    assert done.outcome == outcome
    if names == "":
        assert 'Apply blocked the "Submit Application" click while Claude filled the form' in done.why
    assert server.submissions == []


def test_each_filled_rehearsal_keeps_its_record_in_a_local_folder(tmp_path):
    profile = profile_with(tmp_path, **{f"answered_questions.{q}": a for q, a in ANSWERED.items()})
    claude = FakeClaude(driver=BambooDriver(), essays={"Tell us why": "I build lunar rover software."},
                        reviews=[["Phone: the number is in the Email field"]])
    records = FolderRecords(tmp_path / "rehearsals")

    with FakeBambooServer(LUNAR_FORM) as server:
        [done] = rehearse([LUNAR_URL], server, profile, claude, records=records)

    folder = tmp_path / "rehearsals" / "2026-10-15" / f"lunar-outpost-{done.posting.id}"  # named by its page
    assert done.record == str(folder)
    readme = (folder / "README.md").read_text()
    assert "Rehearsal, not submitted. Pre-submit check: failed." in readme
    assert "Pre-submit review: Phone: the number is in the Email field" in readme
    essays_md = (folder / "essays.md").read_text()
    assert essays_md.startswith(f"## {ESSAY}\nPlan: why-company | ")
    assert "## Additional Comments?" not in essays_md  # an optional catch-all box stays blank (KAN-625)
    essay = essays_md.splitlines()[-1]  # the candidate the writer picked
    assert essay in (folder / "answers.json").read_text()
    assert (folder / "form.png").read_bytes().startswith(b"\x89PNG")
    assert server.submissions == []


# A pasted link on a job system with no Filler names neither company nor role:
# the form's own page does, by its title (Jobvite's and Paylocity's, live).
PAGE_NAMED = {
    "jobvite": (FakeJobviteServer, JOBVITE_URL, JobviteDriver,
                "# Tyler Technologies: Software Development Intern, Summer 2027"),
    "paylocity": (FakePaylocityServer, PAYLOCITY_URL, PaylocityDriver,
                  "# North Atlantic Industries, Inc: Intern - Full Stack Software Engineer (Summer 2027)"),
}


@pytest.mark.parametrize("system", PAGE_NAMED)
def test_a_claude_fill_record_is_headed_with_the_company_and_role_its_page_names(tmp_path, system):
    server, url, driver, heading = PAGE_NAMED[system]

    with server() as site:
        [done] = rehearse([url], site, profile_with(tmp_path), FakeClaude(driver=driver()),
                          records=FolderRecords(tmp_path / "rehearsals"))

    assert (Path(done.record) / "README.md").read_text().splitlines()[0] == heading


GOOGLE = {"workday_sign_in": "google"}  # policies.yaml: Sign in with Google where the tenant offers it


class NeverSubmittingWorkday(WorkdayFiller):
    def submit(self, page):
        pytest.fail("a rehearsal called the Workday Filler's submit")


def test_a_workday_rehearsal_whose_create_account_goes_back_to_sign_in_resets_nothing_and_says_so(monkeypatch):
    # ASML (live, 2026-11-03): Workday showed Sign In with no error, and Lisul had an account there already.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, exists_quietly=True,
                           accounts={(CACI, "test.person@example.com"): "Made-By-Hand1!"}) as server:
        [done] = rehearse([CACI_URL], server, world.profile, keychain=world.keychain, mailbox=world.mailbox)

    assert "may already have an account for your email: reset its password once, or save it with " \
           f"security add-generic-password -U -s apply-ats -a {CACI} -w" in done.why, done.why
    assert server.resets == [] and world.keychain.password(CACI) is None


def test_a_workday_rehearsal_whose_create_account_goes_to_the_bare_sign_in_view_signs_in_and_stops_unsent(monkeypatch):
    # Visa's tenant (live, 2026-11-03): Workday made the account, then loaded its bare Sign In view.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    world = World()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, to_sign_in=True) as server:
        [done] = rehearse([CACI_URL], server, world.profile, keychain=world.keychain, mailbox=world.mailbox)

    assert done.outcome == "ready to submit", done.why
    [made] = server.created
    assert world.keychain.password(CACI) == made["password"]
    assert server.sign_ins == [(CACI, "test.person@example.com", True)] and server.submissions == []


def test_a_workday_rehearsal_makes_an_employer_account_reads_its_link_from_gmail_and_stops_unsent(monkeypatch):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    world, tracker = World(), InMemoryTracker()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, verify_email=(CACI,)) as server:
        [done] = rehearse([CACI_URL], server, world.profile, keychain=world.keychain, mailbox=world.mailbox,
                          tracker=tracker)

    assert done.outcome == "ready to submit", done.why
    [made] = server.created
    assert made["keychain"] == made["password"] == world.keychain.password(CACI)  # saved before the form was sent
    assert server.account(CACI, "test.person@example.com")["verified"]
    assert [a.site for a in tracker.employer_accounts()] == [CACI]
    assert server.submissions == []


def test_a_live_rehearsals_new_employer_account_is_listed_in_the_kept_tracker(monkeypatch):
    # A live rehearsal's own Tracker is a throwaway (no rows for rehearsed links), but the account it
    # made is real: it is listed where Applications Lisul submits are kept, the Employer accounts list
    # that `apply accounts` and the WorkIt extension's Apply sign-in read (KAN-592).
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    world, throwaway, kept = World(), InMemoryTracker(), InMemoryTracker()

    with FakeWorkdayServer(CACI_FORM, keychain=world.keychain, mailbox=world.mailbox, verify_email=(CACI,)) as server:
        rehearsal.rehearse([CACI_URL], adapters(server, None, keychain=world.keychain, mailbox=world.mailbox,
                                                 tracker=throwaway),
                           ApplicantProfile.load(world.profile), 1, keep_open=False, out=lambda line: None,
                           submitted_to=kept)

    assert [a.site for a in kept.employer_accounts()] == [CACI]
    assert throwaway.employer_accounts() == []


def test_a_workday_rehearsal_whose_link_gmail_cannot_read_needs_sign_in_saying_so(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    keychain, mailbox = InMemoryKeychain(), FakeMailbox(set_up=False)

    with FakeWorkdayServer(CACI_FORM, keychain=keychain, mailbox=mailbox, verify_email=(CACI,)) as server:
        [done] = rehearse([CACI_URL], server, profile_with(tmp_path), keychain=keychain, mailbox=mailbox)

    assert done.outcome == "needs sign-in", done.why
    assert "Gmail isn't set up for Apply" in done.why and "verification email can't be read" in done.why
    assert "needs sign-in" in done.line()
    assert mailbox.looks == 0
    assert keychain.password(CACI) == server.account(CACI, "test.person@example.com")["password"]
    assert server.submissions == []


JOBS = [
    {"employer": "Acme Rail", "title": "Software Engineer Intern", "location": "Springfield, IL", "start": "2026-06", "end": "2026-08"},
    {"employer": "Cloud Co", "title": "Data Intern", "location": "Remote", "start": "2025-06", "end": "2025-08"},
]
SCHOOLING = {"school": "Stony Brook University", "degree": "Bachelor's Degree", "majors": ["Computer Science"],
             "gpa_cumulative": 3.77, "start_date": "2024-08", "expected_graduation": "2028-05"}


def experience_profile(**schooling) -> World:
    """A World whose profile answers every step, with jobs and a school (and `schooling`'s education facts)."""
    world = World()
    profile = yaml.safe_load(world.profile.read_text())
    profile["experience_facts"] = {"employment_history": JOBS}
    profile["education"] |= SCHOOLING | schooling
    world.profile.write_text(yaml.safe_dump(profile))
    return world


def test_a_workday_rehearsal_fills_my_experience_an_entry_per_job_and_school_to_review(monkeypatch, tmp_path):
    # Snap's My Experience requires Work Experience and Education entries (seen live).
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    # Snap offers B.A. and B.S. for the profile's Bachelor's Degree: its degree type says which.
    # The tenant has no Computer Science (AmFam's, live): its search picks a wording Lisul accepts.
    world = experience_profile(degree_type="Bachelor of Science",
                               major_wordings={"Computer Science": ["Computer and Information Science"]})

    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        [done] = rehearse([XCEL_URL], server, world.profile)

    assert done.outcome == "ready to submit", done.why
    assert done.missing == ()
    assert "Field of Study" not in done.why
    saved = server.saved("xcelenergy.wd1.myworkdayjobs.com")
    assert [(job["companyName"], job["jobTitle"], job["location"], job["startDate"], job["endDate"])
            for job in saved["workExperience"]] == [
        ("Acme Rail", "Software Engineer Intern", "Springfield, IL", "06/2026", "08/2026"),
        ("Cloud Co", "Data Intern", "Remote", "06/2025", "08/2025"),
    ]
    assert saved["education"] == [{"schoolName": "Stony Brook University", "degree": "B.S.",
                                   "fieldOfStudy": ["Computer and Information Science"], "gradeAverage": "3.77",
                                   "firstYearAttended": "2024", "lastYearAttended": "2028"}]
    assert saved["websites"] == [{"url": "https://test-person.example.com"}]  # the profile's portfolio
    assert server.submissions == []


# Arrowstreet Capital's Application Questions 1 of 2 (rehearsed 2026-11-04): an intro, the current school's questions, a
# bare From and the graduation, whose help text asks the first of the month. Claude answered From with the internship's
# start, and the Answer bank kept it as "from (mm/dd/yyyy)" for every form.
SCHOOL_INTRO = "When entering your education information below, please enter your current university information."
SCHOOL_QUESTIONS = ("Application Questions 1 of 2", [
    WorkdayField("school", "Current School/University", "text", True, intro=SCHOOL_INTRO),
    WorkdayField("degree", "Degree", "dropdown", True, ("Bachelors", "Masters")),
    WorkdayField("gpa", "Overall GPA", "text", True),
    WorkdayField("from", "From", "date", True, format="MM/DD/YYYY"),
    WorkdayField("graduation", "Please enter the first of the month and year that you are planning to graduate. "
                 "Anticipated Graduation", "date", True, format="MM/DD/YYYY"),
])


def _steps(step) -> list:
    return [*STEPS[:2], step, *STEPS[2:]]


def test_a_workday_rehearsal_answers_a_bare_from_for_its_school_and_banks_nothing_by_its_label(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    world = experience_profile(graduation_day=21)
    bank, claude = AnswerBank(tmp_path / "answer-bank.yaml"), FakeClaude(drafts={"From": "05/26/2027"})

    with FakeWorkdayServer(XCEL_FORM, steps=_steps(SCHOOL_QUESTIONS)) as server:
        [done] = rehearse([XCEL_URL], server, world.profile, claude, answer_bank=bank)

    assert done.outcome == "ready to submit", done.why
    saved = server.saved("xcelenergy.wd1.myworkdayjobs.com")
    # The school's start, not the internship's; the graduation on the first of its month, as its help text asks.
    assert (saved["from"], saved["graduation"]) == ("08/01/2024", "05/01/2028")
    assert not any("drafts" in call["schema"]["properties"] for call in claude.calls)  # the plan answered it
    assert all("from" not in question.casefold() for question in bank.answers())
    assert server.submissions == []


def test_a_bare_from_claude_drafts_is_told_its_section_and_banked_only_under_it(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    job = ("Application Questions 1 of 2", [WorkdayField("title", "Job Title", "text", True),
                                            WorkdayField("from", "From", "date", True, format="MM/DD/YYYY")])
    bank, claude = AnswerBank(tmp_path / "answer-bank.yaml"), FakeClaude(drafts={"Job Title": "Intern", "From": "05/24/2027"})

    world = experience_profile()  # kept: its folder holds the profile
    with FakeWorkdayServer(XCEL_FORM, steps=_steps(job)) as server:
        [done] = rehearse([XCEL_URL], server, world.profile, claude, answer_bank=bank)

    assert done.outcome == "ready to submit", done.why
    [drafts] = [json.loads(call["prompt"].split("<short_questions>\n")[1].split("\n</short_questions>")[0])
                for call in claude.calls if "drafts" in call["schema"]["properties"]]
    asked = {d["question"]: d for d in drafts.values()}
    assert asked["From (MM/DD/YYYY)"]["about"] == "work experience" and "about" not in asked["Job Title"]
    assert [entry.question for entry in bank.entries()] == ["Job Title", "work experience / From (MM/DD/YYYY)"]
    assert server.submissions == []


def test_the_pre_submit_reviews_fix_is_filled_before_the_form_shows_as_ready(monkeypatch, tmp_path):
    # A bare From nothing on the form places: Claude's draft is never banked, and when the review names the right
    # answer for a wrong one, that answer is filled and the form reviewed again, never left as a banner.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    bare = ("Application Questions 1 of 2", [WorkdayField("from", "From", "date", True, format="MM/DD/YYYY")])
    problem = "'From (MM/DD/YYYY)': 05/24/2027 is the internship start date, not his school start"
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    claude = FakeClaude(drafts={"From": "05/24/2027"},  # a number the profile holds (its earliest start), so it is used
                        # A fix for an answer from the profile is never taken (General Motors' degree, live).
                        reviews=[{"problems": [problem, "First Name: not his name"],
                                  "fixes": [{"question": "From (MM/DD/YYYY)", "answer": "08/01/2024"},
                                            {"question": "First Name", "answer": "Someone"}]}])

    world = experience_profile()
    with FakeWorkdayServer(XCEL_FORM, steps=_steps(bare)) as server:
        [done] = rehearse([XCEL_URL], server, world.profile, claude, answer_bank=bank)

    assert done.outcome == "ready to submit", done.why
    assert "Pre-submit review" not in done.why
    saved = server.saved("xcelenergy.wd1.myworkdayjobs.com")
    assert saved["from"] == "08/01/2024" and saved["legalName--firstName"] != "Someone"
    [drafts] = [call["prompt"] for call in claude.calls if "drafts" in call["schema"]["properties"]]
    assert '"about": "unknown"' in drafts
    assert sum("problems" in call["schema"]["properties"] for call in claude.calls) == 2  # reviewed again after the fix
    assert bank.entries() == []
    assert server.submissions == []


AUTHORIZED = "Are you legally authorized to work in the United States?"


def test_the_reviews_fix_for_a_legal_answer_is_filled_over_the_profiles(monkeypatch, tmp_path):
    # Saronic's U.S. Person "No" came from the plan's own (wrong) rule, and the review's fix was left as a banner
    # (live, 2026-11-04). A legal or eligibility answer the review finds wrong is filled with its fix, then reviewed
    # again, though the plan took it from the profile. Another profile answer's fix is still never taken.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    claude = FakeClaude(reviews=[{"problems": [f"{AUTHORIZED}: answered No, but the profile says he is authorized",
                                               "First Name: not his name"],
                                  "fixes": [{"question": AUTHORIZED, "answer": "Yes"},
                                            {"question": "First Name", "answer": "Someone"}]}])
    profile = profile_with(tmp_path, **{"work_authorization.authorized_to_work_us": False})
    records = FolderRecords(tmp_path / "rehearsals")

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile, claude, records=records)

    shown = {a["question"].strip(): a["on_page"] for a in json.loads((Path(done.record) / "answers.json").read_text())}
    assert shown[AUTHORIZED] == "Yes" and shown["First Name"] != "Someone"
    assert sum("problems" in call["schema"]["properties"] for call in claude.calls) == 2  # reviewed again after the fix
    assert done.legal == ()
    assert fake.submissions == []


def test_a_legal_problem_the_review_gives_no_fix_for_holds_submit_until_lisul_dismisses_it(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    problem = 'The U.S. Person status question is answered "No", but the profile says he is a U.S. citizen'
    claude = FakeClaude(reviews=[[problem, "Why Arc?: names no product"]])

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile_with(tmp_path), claude)

    assert done.legal == (("", problem),)  # the essay's problem is a banner, not a hold
    assert done.holding() == problem
    done.dismiss_holds()  # the held note's Dismiss
    assert done.holding() == ""
    assert fake.submissions == []


def test_a_workday_rehearsal_stops_where_google_wants_more_than_an_account_pick(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)

    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        [done] = rehearse([XCEL_URL], server, profile_with(tmp_path, GOOGLE), records=FolderRecords(tmp_path / "rehearsals"))

    assert done.outcome == "handoff" and "Google asked for more than an account pick" in done.why
    assert "Rehearsal, not submitted: handoff: Google asked" in (Path(done.record) / "README.md").read_text()  # its Record too
    assert server.submissions == []


def test_a_workday_rehearsal_stops_as_needs_sign_in_when_google_refuses_the_browser(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)

    with FakeWorkdayServer(XCEL_FORM, google="rejected") as server:
        [done] = rehearse([XCEL_URL], server, profile_with(tmp_path, GOOGLE), records=FolderRecords(tmp_path / "rehearsals"))

    assert done.outcome == "needs sign-in" and done.why.startswith("Google refused Sign in with Google")
    assert server.submissions == []


class Watched:
    """A job site that counts its open pages, opened and closed on several threads."""

    def __init__(self, site):
        self._site = site
        self._lock = threading.Lock()
        self.open_now = 0

    def fetch(self, url, body=None):
        return self._site.fetch(url, body)

    @contextmanager
    def open(self, url, worker=0):
        with self._site.open(url, worker) as page:
            self._count(+1)
            try:
                yield page
            finally:
                self._count(-1)

    def _count(self, change: int) -> None:
        with self._lock:
            self.open_now += change


def test_each_page_stays_open_where_it_stopped_until_ctrl_c(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = ApplicantProfile.load(profile_with(tmp_path))
    lines, seen = [], []

    def out(line: str) -> None:
        lines.append(line)
        if "Ctrl-C" in line:  # every link has ended: look, then press Ctrl-C
            def later():
                seen.append(site.open_now)
                _thread.interrupt_main()
            threading.Timer(1.0, later).start()

    with FakeJobServer(ARC_FORM, PURE_STORAGE_FORM) as fake:
        site = Watched(fake)
        done = rehearsal.rehearse([ARC_URL, PURE_STORAGE_URL], adapters(site), profile, 2, out=out)

    assert [d.outcome for d in done] == ["ready to submit"] * 2
    assert seen == [2]  # both forms open after the run, on their last page
    assert site.open_now == 0  # Ctrl-C closed them
    assert lines[-1] == "Closed the browsers."


def test_a_captcha_mid_fill_in_a_rehearsal_waits_for_lisul_then_fills_to_the_last_page(monkeypatch, tmp_path):
    # LinkedIn (2026-11-03): the slider stopped the read; Lisul does it, and the rehearsal goes on by itself.
    monkeypatch.setattr(ClaudeFill, "submit", lambda self, page: pytest.fail("a rehearsal clicked Claude fill's submit"))
    phone = RecordingNotifier()
    claude = FakeClaude(driver=CaptchaDriver(solved_ms=1500), essays={"Tell us why": WHY_LUNAR})

    with FakeBambooServer(LUNAR_FORM) as server:
        [done] = rehearse([LUNAR_URL], server, captcha_profile(tmp_path, 1), claude, phone=phone)

    assert done.outcome == "ready to submit", done.why
    assert phone.sent == [("Apply: do the captcha", "Do the captcha on Lunar Outpost. Apply goes on by itself once it's done.")]
    assert [line.split(" ", 1)[1] for line in done.history] == [
        "Paused: do the captcha", "Resumed: the captcha is done; Apply went on from the page"]
    assert server.submissions == []


def test_each_page_held_open_for_lisul_is_his_to_submit_once_its_link_has_ended(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lifted = []
    monkeypatch.setattr(rehearsal, "lift", lambda page, **heard: lifted.append(page.url))
    profile = ApplicantProfile.load(profile_with(tmp_path))

    def out(line: str) -> None:
        if "Ctrl-C" in line:
            threading.Timer(1.0, _thread.interrupt_main).start()

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearsal.rehearse([ARC_URL], adapters(fake), profile, out=out)

    assert done.outcome == "ready to submit"  # Apply itself sent nothing
    assert fake.submissions == []
    assert lifted == [ARC_URL]  # then the guard came off the page held for Lisul


class Counted(NeverSubmits):
    """NeverSubmits that counts its fills."""

    def __init__(self, filler):
        super().__init__(filler)
        self.fills = 0

    def fill(self, page, questions, answers):
        self.fills += 1
        return super().fill(page, questions, answers)


class MisreadOnce(Counted):
    """Counted whose first fill reads back a blank first name, so the form
    is filled once more."""

    def __init__(self, filler):
        super().__init__(filler)
        self.pages = []

    def fill(self, page, questions, answers):
        self.pages.append(page)
        readback = super().fill(page, questions, answers)
        return {**readback, "first_name": ""} if self.fills == 1 else readback


def test_a_second_fill_after_a_misread_fills_the_same_window_not_a_new_one(monkeypatch, tmp_path):
    filler = MisreadOnce(GreenhouseFiller())
    monkeypatch.setitem(FILLERS, "greenhouse", filler)

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile_with(tmp_path))
        browsers = len(fake.workers)  # one browser started per open()

    assert filler.fills == 2
    assert filler.pages[0] is filler.pages[1]
    assert browsers == 1
    assert done.outcome == "ready to submit", done.why


def lisul_on_the_held_page(monkeypatch, clicks):
    """Once Apply hands a page to Lisul, he clicks `clicks(n)`, the buttons
    named, on the nth page handed to him (n from 1)."""
    real, handed = rehearsal.lift, []

    def lift(page, **heard):
        real(page, **heard)
        handed.append(page)
        for name in clicks(len(handed)):
            page.get_by_role("button", name=name).click()
    monkeypatch.setattr(rehearsal, "lift", lift)


def hold_until(site, profile, done: Callable[[list[str]], bool], with_adapters: dict | None = None, url: str = ARC_URL,
               **more) -> list[str]:
    """Rehearse Arc's link (or `url`) with its page held open, then press Ctrl-C once
    `done(lines printed)`; or after two minutes, so a test never hangs.
    `with_adapters` replaces adapters of the test's."""
    lines, ctrl_c = [], threading.Timer(1.0, _thread.interrupt_main)

    def out(line: str) -> None:
        lines.append(line)
        if done(lines) and not ctrl_c.is_alive() and not ctrl_c.finished.is_set():  # once: a later one hits the next test
            ctrl_c.start()
    watchdog = threading.Timer(120, _thread.interrupt_main)
    watchdog.start()
    try:
        rehearsal.rehearse([url], adapters(site, **(with_adapters or {})), profile, out=out, **more)
    finally:
        watchdog.cancel()
        ctrl_c.cancel()
    return lines


def test_lisuls_own_submit_on_a_held_page_is_kept_in_the_tracker_as_submitted(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile, tracker = ApplicantProfile.load(profile_with(tmp_path)), InMemoryTracker()

    with FakeJobServer(ARC_FORM) as fake:
        lines = hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=tracker)
        submissions = fake.submissions

    assert len(submissions) == 1  # Lisul's, sent from the held page
    [row] = tracker.rows()
    assert (row.status, row.date_applied, row.posting_url) == ("submitted", NOW.date(), ARC_URL)
    assert row.company == "Arc Boat Company" and "You submitted it" in row.reason
    assert any(line.startswith("Arc Boat Company | ") and "you submitted it; it is in the Tracker" in line for line in lines)


def test_lisuls_own_submit_saves_the_record_again_as_submitted_with_its_confirmation(monkeypatch, tmp_path):
    # KLA, 2026-11-03: he submitted the held form himself, and its Record still said held.
    from apply.records import InMemoryRecords

    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile, records = ApplicantProfile.load(profile_with(tmp_path)), InMemoryRecords()

    with FakeJobServer(ARC_FORM) as fake:
        lines = hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=InMemoryTracker(),
                           with_adapters={"records": records})

    [link] = records.links()
    files = records.files(link)
    assert "- Status: submitted (You submitted it yourself from a rehearsal" in files["README.md"].decode()
    assert files["after-submit.png"].startswith(b"\x89PNG")
    assert any("its Record says submitted" in line for line in lines)


def test_a_held_form_lisul_sends_with_a_missing_fact_open_shows_as_sent_and_leaves_needs_you(monkeypatch, tmp_path):
    # Saronic, 2026-11-04: he sent the held form himself; the tile still asked its Missing facts, so it looked unsent.
    from apply.dashboard import Dashboard, NoFrames

    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    real = rehearsal.lift

    def lift(page, **heard):  # he types the Missing fact on the page, not in the window, and sends it
        real(page, **heard)
        page.get_by_label("Last Name").first.fill("Elvitigala")
        page.get_by_role("button", name="Submit application").click()
    monkeypatch.setattr(rehearsal, "lift", lift)
    rescued = []
    monkeypatch.setattr(rehearsal.Rescue, "field", lambda self, page, label, value, error: rescued.append(label))
    profile = ApplicantProfile.load(profile_with(tmp_path, **{"identity.legal_last_name": None}))
    asked = []

    class Board(Dashboard):
        late = [("Last Name", "Elvitigala")]  # his answer in the window, given after the form went in

        def update(self, worker, **caption):
            super().update(worker, **caption)
            if caption.get("status") == rehearsal.READY:
                asked.append(list(self.state()["tiles"][0].get("missing") or []))

        def answered(self, worker):
            if self._captions[worker].get("status") == "submitted" and self.late:
                given, self.late = self.late, []
                return given
            return super().answered(worker)

    board = Board(1, NoFrames())
    with FakeJobServer(ARC_FORM) as fake:
        hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=InMemoryTracker(),
                   with_adapters={"board": board})
        submissions = fake.submissions

    assert len(submissions) == 1 and asked and asked[0]  # held with a Missing fact open, then sent by him
    [tile], items = board.state()["tiles"], board.state()["items"]
    assert tile["tone"] == "submitted" and tile["label"].endswith(("Sent", "sent")) and tile["missing"] == []
    assert "you submitted it; it is in the Tracker" in tile["detail"]
    assert [i["tone"] for i in items] == ["submitted"]  # no card for it waits in Needs you
    assert not board.late and rescued == []  # the late answer filled nothing on the sent form


def test_a_captcha_after_lisuls_own_submit_pushes_him_to_do_it(monkeypatch, tmp_path):
    # Lisul (2026-11-03): in a rehearsal he presses Submit and does the captcha himself; Apply only tells him.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile, phone, board = ApplicantProfile.load(captcha_profile(tmp_path, 1)), RecordingNotifier(), RecordingBoard()

    with FakeJobServer(ARC_FORM, challenge=True) as fake:
        lines = hold_until(fake, profile, lambda lines: "do the captcha" in lines[-1],
                           with_adapters={"phone": phone, "board": board})
        submissions = fake.submissions

    assert phone.sent == [("Apply: do the captcha", "Do the captcha on Arc Boat Company. "
                                                    "Apply goes on by itself once it's done.")]
    assert any(line.startswith("Arc Boat Company | ") and "do the captcha yourself" in line for line in lines)
    assert (board.captions[0]["status"], board.captions[0]["captcha"]) == ("handoff", True)
    assert submissions == []  # nothing goes until the captcha is done


def test_lever_turning_down_lisuls_own_submit_is_a_bot_block_for_his_own_chrome(monkeypatch, tmp_path):
    # Simbe Robotics, 2026-11-03: Lever's hCaptcha turned the token of the Worker's Chrome down at his Submit.
    monkeypatch.setitem(FILLERS, "lever", NeverSubmits(LeverFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile, board, tracker = ApplicantProfile.load(profile_with(tmp_path)), RecordingBoard(), InMemoryTracker()

    with FakeLeverServer(IMMUTA_FORM, parse_delay=0.2, refuse=True) as fake:
        lines = hold_until(fake, profile, lambda lines: "in your Chrome" in lines[-1], url=IMMUTA_URL,
                           with_adapters={"board": board}, submitted_to=tracker)
        submissions = fake.submissions

    caption = board.captions[0]
    assert caption["status"] == "handoff" and caption["blocked"] is True
    assert "Immuta blocked Apply's Chrome as a bot (\"There was an error verifying your application\")" in caption["why"]
    assert any(line.startswith("Immuta | ") and "Finish Immuta in your Chrome: the extension fills it" in line
               for line in lines)
    assert submissions == [] and tracker.rows() == []  # nothing went in, so nothing is kept as submitted


def test_lisuls_own_submit_from_a_rehearsal_is_applied_in_his_applications_tracker(monkeypatch, tmp_path):
    # KAN-544: the submit he made goes to WorkIt as Applied, the resume the form was given as its Sent resume.
    from fake_tracker import FakeTracker
    from fake_workit import FakeWorkIt

    from apply import workit
    from apply.tracker import WorkItTracker
    from apply.worker import sent_resume

    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile = ApplicantProfile.load(profile_with(tmp_path))
    resume_name = Path(profile.get("files.resume_pdf")).name

    with FakeWorkIt() as wi, FakeJobServer(ARC_FORM) as fake:
        applications = FakeTracker(wi)
        client = workit.WorkIt(wi.site, tmp_path / "workit-login.json")
        workit.login(client, lambda url, accept: accept(wi.cookies(wi.session())))
        tracker = WorkItTracker(InMemoryTracker(), workit.WaitingWrites(client, tmp_path / "workit-queue.json"),
                                lambda application_id: sent_resume(application_id, resume_name))
        hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=tracker)

    assert applications.tracked() == [{"link": ARC_URL, "company": "Arc Boat Company", "stage": "applied",
                                       "sent_resume": resume_name}]


def test_lisuls_submit_sends_his_tailored_resume_and_keeps_that_file_as_the_sent_resume(monkeypatch, tmp_path):
    # KAN-547: the posting has a tailored resume on WorkIt, so the form gets it, by the profile's resume name.
    from fake_tracker import FakeTracker
    from fake_workit import FakeWorkIt

    from apply import tailored, workit
    from apply.tracker import WorkItTracker
    from apply.worker import sent_resume

    monkeypatch.setattr(tailored, "TAILORED", tmp_path / "tailored")
    monkeypatch.setattr(worker, "SENT", tmp_path / "sent")
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
    profile = ApplicantProfile.load(profile_with(tmp_path))
    resume_name = Path(profile.get("files.resume_pdf")).name
    tailored_pdf = b"%PDF-1.7 the resume tailored to Arc"

    with FakeWorkIt() as wi, FakeJobServer(ARC_FORM) as fake:
        applications = FakeTracker(wi)
        applications.tailored(applications.listed(ARC_URL, "Arc Boat Company", "Intern"), tailored_pdf)
        client = workit.WorkIt(wi.site, tmp_path / "workit-login.json")
        workit.login(client, lambda url, accept: accept(wi.cookies(wi.session())))
        tracker = WorkItTracker(InMemoryTracker(), workit.WaitingWrites(client, tmp_path / "workit-queue.json"),
                                lambda application_id: sent_resume(application_id, resume_name, tmp_path / "sent"))
        hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=tracker,
                   with_adapters={"tailored": tailored.from_workit(client)})
        submitted = fake.submissions

    assert resume_name in submitted[0].application.values()  # the form got it under the profile's resume name
    [given] = (tmp_path / "sent").glob(f"*/*/{resume_name}")
    assert given.read_bytes() == tailored_pdf
    assert applications.tracked() == [{"link": ARC_URL, "company": "Arc Boat Company", "stage": "applied",
                                       "sent_resume": resume_name}]
    assert [sent.content for sent in applications.sent.values()] == [tailored_pdf]
    assert profile.get("files.resume_pdf").read_bytes() != tailored_pdf  # the profile still names the base resume


def test_a_rehearsal_lisul_does_not_submit_sends_nothing_to_workit(monkeypatch, tmp_path):
    from fake_tracker import FakeTracker
    from fake_workit import FakeWorkIt

    from apply import workit
    from apply.tracker import WorkItTracker

    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: [])
    profile = ApplicantProfile.load(profile_with(tmp_path))

    with FakeWorkIt() as wi, FakeJobServer(ARC_FORM) as fake:
        applications = FakeTracker(wi)
        client = workit.WorkIt(wi.site, tmp_path / "workit-login.json")
        workit.login(client, lambda url, accept: accept(wi.cookies(wi.session())))
        wi.requests.clear()
        tracker = WorkItTracker(InMemoryTracker(), workit.WaitingWrites(client, tmp_path / "workit-queue.json"),
                                lambda application_id: "")
        hold_until(fake, profile, lambda lines: "Ctrl-C" in lines[-1], submitted_to=tracker)

    assert wi.requests == [] and applications.tracked() == []


class OnePage:
    """A job site whose every page is `html`, in a browser of its own."""

    def __init__(self, html: str):
        self._html = html

    @contextmanager
    def open(self, url: str, worker: int = 0):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page()
                page.context.route("**/*", lambda route: route.fulfill(content_type="text/html", body=self._html))
                page.goto(url)  # the guard reloads it
                yield page
            finally:
                browser.close()


SENT = "<button onclick=\"document.body.innerHTML = '<p>Thank you for applying!</p>'{}\">Submit</button>"


@pytest.mark.parametrize("pop_up, closes", [("", True), ("; window.open('about:blank')", False)])
def test_a_confirmed_page_closes_its_window_after_a_wait_unless_a_pop_up_came(monkeypatch, pop_up, closes):
    monkeypatch.setattr(rehearsal, "CLOSE_AFTER_S", 0.5)
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit"])
    site, release, kept = rehearsal._Kept(OnePage(SENT.format(pop_up)), 0), threading.Event(), []
    threading.Timer(5, release.set).start()  # else: Ctrl-C, after five seconds

    with site.open("https://jobs.example.com/apply"):
        assert not site.hold(release, submitted=kept.append)

    assert len(kept) == 1  # the Tracker heard once
    assert release.is_set() != closes  # closed on its own, or left for Lisul


def resume_pressed_later(turns: int = 4):
    """Lisul presses Resume in the window a few turns after the page was handed to him: by then his own presses on
    it have been heard. Returns the hold's `resume(page)`, and each turn it was asked on."""
    asked = []

    def resume(page) -> bool:
        asked.append(True)
        return len(asked) >= turns
    return resume, asked


def test_resume_goes_on_after_lisul_pressed_apply_now_himself_on_the_held_page(monkeypatch):
    # KAN-690: at a paused sign-in he signed in and pressed the site's own "Apply now" and "Complete" on the held
    # page; Resume, pressed after, must still go on with the page, not be dead for the rest of the hold.
    lisul_on_the_held_page(monkeypatch, lambda n: ["Apply now", "Complete"])
    page = "<form onsubmit='return false'><button>Apply now</button></form><button>Complete</button>"
    site, release = rehearsal._Kept(OnePage(page), 0), threading.Event()
    resume, asked = resume_pressed_later()
    threading.Timer(8, release.set).start()  # else: Ctrl-C, so a test never hangs

    with site.open("https://jobs.example.com/apply"):
        assert site.hold(release, resume=resume) == rehearsal.RESUME

    assert len(asked) == 4 and not release.is_set()


def test_resume_never_drives_a_page_lisul_sent_himself(monkeypatch):
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit"])
    site, release, kept = rehearsal._Kept(OnePage(SENT.format("")), 0), threading.Event(), []
    resume, _ = resume_pressed_later()
    threading.Timer(4, release.set).start()

    with site.open("https://jobs.example.com/apply"):
        assert site.hold(release, submitted=kept.append, resume=resume) == ""

    assert len(kept) == 1  # sent and kept: Resume, pressed after, went on with nothing


def test_a_held_page_lisul_does_not_submit_leaves_the_tracker_alone(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: [])
    profile, tracker = ApplicantProfile.load(profile_with(tmp_path)), InMemoryTracker()

    with FakeJobServer(ARC_FORM) as fake:
        hold_until(fake, profile, lambda lines: "Ctrl-C" in lines[-1], submitted_to=tracker)

    assert tracker.rows() == []


def test_fill_again_on_a_held_page_fills_its_form_once_more_in_the_same_browser(monkeypatch, tmp_path):
    filler = Counted(GreenhouseFiller())
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    lisul_on_the_held_page(monkeypatch, lambda n: ["Fill again"] if n == 1 else [])
    profile = ApplicantProfile.load(profile_with(tmp_path))

    with FakeJobServer(ARC_FORM) as fake:
        lines = hold_until(fake, profile, lambda lines: sum("ready to submit" in line for line in lines) == 2)
        submissions = fake.submissions

    assert filler.fills == 2
    assert sum("ready to submit" in line for line in lines) == 2  # a summary line for each fill
    assert submissions == []


def test_fill_again_from_the_window_fills_its_form_once_more_with_no_click_on_the_page(monkeypatch, tmp_path):
    from apply.dashboard import Dashboard, NoFrames, Refused

    filler = Counted(GreenhouseFiller())
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    lisul_on_the_held_page(monkeypatch, lambda n: [])  # he clicks nothing there
    profile = ApplicantProfile.load(profile_with(tmp_path))

    with FakeJobServer(ARC_FORM) as fake, Dashboard(1, NoFrames()) as board:
        def press() -> None:  # as `apply fill-again` does, from outside the Worker's page
            while True:
                try:
                    board.fill_again("tile-0")
                    return
                except Refused:
                    time.sleep(0.2)  # not held yet
        threading.Thread(target=press, daemon=True).start()
        hold_until(fake, profile, lambda lines: sum("ready to submit" in line for line in lines) == 2,
                   with_adapters={"board": board})
        submissions = fake.submissions

    assert filler.fills == 2 and submissions == []


def test_a_field_the_filler_cannot_fill_is_reported_and_the_rest_still_filled(tmp_path):
    profile = profile_with(tmp_path, **{"education.school": "Example State University"})
    # A board whose school search names two Example States: the Filler won't guess between them.
    with board_listing_schools(tmp_path, ["Example State University - SUNY", "Example State University - Southampton"]) as board:
        [done] = rehearse([ANDURIL_URL], board, profile)

    assert done.outcome == "ready to submit"
    assert "Not filled: school--0: Greenhouse's search offered several named like it" in done.why
    assert done.filled >= 5  # name, email, phone, résumé, work authorization...
    assert board.submissions == []


def test_a_summary_is_one_line_however_long_the_error():
    error = "TimeoutError: Timeout 30000.0ms exceeded.\n=== logs ===\nwaiting for navigation\n" + "x" * 1000
    done = rehearsal.Rehearsed(Posting("p", "Snap", "Intern", "https://wd1.myworkdaysite.com/x"), "failed", error)

    assert "\n" not in done.line() and len(done.line()) < 500


def test_each_links_tile_on_the_dashboard_says_what_it_is_and_how_it_ended(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    board = RecordingBoard()

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile_with(tmp_path), board=board)

    files = board.captions[0].pop("files")  # a kept copy of each file the form was sent
    assert files and all(Path(f["path"]).is_file() for f in files)
    assert board.captions[0].pop("posting_url").startswith("http")  # so the window can link the Posting
    assert board.captions[0].pop("application_id")
    assert board.captions[0].pop("verifying") is False  # verified once it was filled, before it stopped
    assert board.captions[0].pop("verification")["state"] in ("verified", "flagged")
    # The stuck watch's last word (apply.stuck): read only while a tile is filling.
    assert isinstance(board.captions[0].pop("doing"), str)
    assert isinstance(board.captions[0].pop("progress_at"), float)
    assert board.captions[0].pop("waiting") is False
    # Nothing paused, waited, regenerated or refused it as a bot.
    assert board.captions[0].pop("history") == []
    assert board.captions[0].pop("written") == []
    assert board.captions[0].pop("blocked") is False
    assert board.captions[0].pop("where") == {}
    assert board.captions == {0: {
        "company": "Arc Boat Company", "role": "Software Engineering Intern", "job_system": "greenhouse",
        "status": "ready to submit", "stage": "", "line": done.line(), "why": done.why,
        "filled": done.filled, "asked": done.asked, "missing": list(done.missing), "drafted": [],
        "choices": {}, "required": {},
    }}
    assert done.asked > 0


def test_a_failure_keeps_its_traceback_in_the_log(monkeypatch, tmp_path, capsys):
    def blow_up(*args, **kwargs):
        raise PermissionError(1, "Operation not permitted")

    monkeypatch.setattr(rehearsal, "by_filler", blow_up)
    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile_with(tmp_path))

    assert done.outcome == "failed" and "PermissionError" in done.why
    log = capsys.readouterr().err
    assert "Traceback" in log and "blow_up" in log


def test_a_workday_step_left_with_a_missing_fact_lists_it_where_the_rehearsal_stopped(monkeypatch, tmp_path):
    # Snap's degree list has B.A. and B.S., not the profile's Bachelor's Degree: no guess between them.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)

    world = experience_profile()
    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        [done] = rehearse([XCEL_URL], server, world.profile, records=FolderRecords(tmp_path / "rehearsals"))

    assert done.outcome == "handoff" and "won't leave its 'My Experience' step" in done.why and "Degree" in done.why
    assert done.missing == ("Education 1 / Degree",)
    assert "Missing facts: Education 1 / Degree" in done.line()
    # Its Record keeps what was planned and shown up to the step it stopped on (ASML's had none, live).
    assert 0 < done.filled < done.asked
    rows = json.loads((Path(done.record) / "answers.json").read_text())
    assert any(r["question"] == "Education 1 / Degree" and r["on_page"] in (None, "") for r in rows)
    assert server.submissions == []


def test_a_failure_and_each_missing_fact_leave_a_repair_request(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = profile_with(tmp_path, **{"identity.email": None})
    repairs = RepairRequests(tmp_path / "repairs")

    with FakeJobServer(ARC_FORM) as fake:
        rehearse([ARC_URL], fake, profile, repairs=repairs)
    [email] = repairs.waiting()
    assert (email.kind, email.missing, email.posting_url) == ("missing fact", ["Email"], ARC_URL)
    assert any(q["label"] == "Email" for q in email.questions)

    def blow_up(*args, **kwargs):
        raise PermissionError(1, "Operation not permitted")

    monkeypatch.setattr(rehearsal, "by_filler", blow_up)
    with FakeJobServer(ARC_FORM) as fake:
        rehearse([ARC_URL], fake, profile, repairs=repairs)
    [failure] = [r for r in repairs.waiting() if r.kind == "failure"]
    assert failure.failure.startswith("PermissionError")
    assert "blow_up" in failure.traceback


def test_once_every_link_has_ended_the_rehearsal_says_so_before_holding_the_pages(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    ended = []

    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL, ARC_URL], adapters(fake), ApplicantProfile.load(profile_with(tmp_path)), 2,
                           keep_open=False, out=ended.append, on_done=lambda: ended.append("done"))

    assert len(ended) == 3 and ended[-1] == "done"  # where `apply repair` starts, in the background


class StartsLate:
    """A real Filler that notes when each fill starts; its first Question set is slow to read."""

    def __init__(self, filler, slow: float):
        self._filler, self._slow, self.started = filler, slow, []
        self._first = threading.Lock()

    def question_set(self, url, site):
        if self._first.acquire(blocking=False):
            import time
            time.sleep(self._slow)
        return self._filler.question_set(url, site)

    def fill(self, page, questions, answers):
        import time
        self.started.append(time.monotonic())
        return self._filler.fill(page, questions, answers)

    def submit(self, page):
        pytest.fail("a rehearsal called the Filler's submit")


class PressesStartLater(RecordingBoard):
    """A window whose Start Lisul presses `after` seconds once it shows."""

    def __init__(self, after: float):
        super().__init__()
        self._after, self.pressed = after, None

    def wait_for_start(self, timeout: float) -> None:
        import time
        self.run(start="ready")
        time.sleep(self._after)
        self.pressed = time.monotonic()


def test_together_holds_every_form_until_all_are_open_and_start_is_pressed_then_fills_them_at_once(
        monkeypatch, tmp_path):
    filler = StartsLate(GreenhouseFiller(), slow=1.5)
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    board = PressesStartLater(after=1.0)

    with FakeJobServer(ARC_FORM) as fake:
        lines = []
        done = rehearsal.rehearse([ARC_URL, ARC_URL], adapters(fake, board=board),
                                  ApplicantProfile.load(profile_with(tmp_path)), 1,
                                  keep_open=False, out=lines.append, together=True)

    assert [d.outcome for d in done] == ["ready to submit"] * 2
    first, second = sorted(filler.started)
    assert second - first < 0.5  # the quick link waited for the slow one's form
    assert first >= board.pressed  # and neither filled before Start
    assert [r["start"] for r in board.runs if "start" in r] == ["waiting", "ready"]


def test_without_together_a_quick_form_fills_without_waiting(monkeypatch, tmp_path):
    filler = StartsLate(GreenhouseFiller(), slow=1.5)
    monkeypatch.setitem(FILLERS, "greenhouse", filler)

    with FakeJobServer(ARC_FORM) as fake:
        rehearse([ARC_URL, ARC_URL], fake, profile_with(tmp_path), workers=2)

    first, second = sorted(filler.started)
    assert second - first > 1.0


def test_without_together_start_is_never_asked_for(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    board = RecordingBoard()

    with FakeJobServer(ARC_FORM) as fake:
        rehearse([ARC_URL], fake, profile_with(tmp_path), board=board)

    assert not [r for r in board.runs if "start" in r]


def test_the_window_counts_a_link_queued_only_until_its_worker_starts_it(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    board = RecordingBoard()

    with FakeJobServer(ARC_FORM) as fake:
        rehearse([ARC_URL, ARC_URL], fake, profile_with(tmp_path), board=board)

    assert [r["queued"] for r in board.runs if "queued" in r] == [2, 1, 0]


class SignsInToRead(StartsLate):
    """A Filler whose Question set is read only after signing in, as Workday's is."""

    signs_in_to_read = True

    def question_set(self, url, site):
        import time
        self.read_at = time.monotonic()
        return super().question_set(url, site)


def test_together_holds_a_filler_that_signs_in_to_read_before_it_signs_in(monkeypatch, tmp_path):
    filler = SignsInToRead(GreenhouseFiller(), slow=0)
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    board = PressesStartLater(after=1.0)

    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board), ApplicantProfile.load(profile_with(tmp_path)), 1,
                           keep_open=False, out=lambda line: None, together=True)

    assert filler.read_at >= board.pressed


class PlansSlowly(FakeClaude):
    """A Claude whose every call notes the pages open at that moment."""

    def __init__(self, site):
        super().__init__()
        self._site, self.open_while_asked = site, []

    def ask(self, *args, **kwargs):
        self.open_while_asked.append(len(getattr(self._site, "opened", [])))
        return super().ask(*args, **kwargs)


def test_a_rehearsal_opens_its_form_before_claude_writes_its_answers(monkeypatch, tmp_path):
    opened = []
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))

    with FakeJobServer(ARC_FORM) as fake:
        real_open = fake.open

        def open_and_note(url, *args, **kwargs):
            opened.append(url)
            return real_open(url, *args, **kwargs)

        monkeypatch.setattr(fake, "open", open_and_note)
        fake.opened = opened
        claude = PlansSlowly(fake)
        rehearse([ARC_URL], fake, profile_with(tmp_path), claude=claude)

    assert claude.open_while_asked and all(n > 0 for n in claude.open_while_asked)


def test_a_filler_that_signs_in_to_read_shows_its_posting_while_it_waits_for_start(monkeypatch, tmp_path):
    filler = SignsInToRead(GreenhouseFiller(), slow=0)
    monkeypatch.setitem(FILLERS, "greenhouse", filler)
    opened = []

    class NotesOpenAtStart(PressesStartLater):
        def wait_for_start(self, timeout):
            opened.append(len(fake_opened))
            super().wait_for_start(timeout)

    fake_opened = []
    board = NotesOpenAtStart(after=0)
    with FakeJobServer(ARC_FORM) as fake:
        real_open = fake.open
        monkeypatch.setattr(fake, "open", lambda url, *a, **k: fake_opened.append(url) or real_open(url, *a, **k))
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board), ApplicantProfile.load(profile_with(tmp_path)), 1,
                           keep_open=False, out=lambda line: None, together=True)

    assert opened == [1]  # its page was open, and only it, when Start was asked for


def test_together_tiles_say_getting_ready_then_ready_then_filling(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    stages = []

    class NotesStages(PressesStartLater):
        def update(self, worker, **caption):
            if "stage" in caption:
                stages.append(caption["stage"])
            super().update(worker, **caption)

    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=NotesStages(after=0)),
                           ApplicantProfile.load(profile_with(tmp_path)), 1, keep_open=False, out=lambda line: None,
                           together=True)

    assert stages == ["getting ready", "ready", ""]


def test_a_filling_tile_held_for_start_says_getting_ready_then_ready():
    from apply.dashboard import verdict
    assert verdict({"status": "filling", "stage": "getting ready"})["label"] == "Getting ready"
    assert verdict({"status": "filling", "stage": "ready"})["label"] == "Ready"
    assert verdict({"status": "filling", "stage": ""})["label"] == "Filling"


def test_missing_facts_reach_the_window_before_claude_is_asked_anything(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = profile_with(tmp_path, **{"identity.email": None, "identity.legal_last_name": None})
    claude, heard = FakeClaude(), []

    class Board(RecordingBoard):
        def update(self, worker, **caption):
            if caption.get("missing") and caption.get("status") is None:  # while its form fills
                heard.append((tuple(caption["missing"]), len(claude.calls)))
            super().update(worker, **caption)

    board = Board()
    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile, claude, board=board)

    assert heard[0] == (("Last Name", "Email"), 0)  # asked of Lisul with no Claude call made yet
    assert board.captions[0]["required"] == {"Last Name": True, "Email": True}  # the form's own flags
    assert done.missing == ("Last Name", "Email") and claude.calls  # Claude still reviewed the form after


def test_an_answer_given_in_the_window_is_filled_into_the_held_form(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = profile_with(tmp_path, **{"identity.email": None, "identity.legal_last_name": None})
    rescued = []

    held, notes = [], []

    def field(self, page, label, value, error):  # Claude's one-field fill, on the page held open
        rescued.append((label, value, page.url))
        held.append(page)
        notes.append(page.inner_text("#apply-rehearsal-blocked"))
        return True

    monkeypatch.setattr(rehearsal.Rescue, "field", field)

    class Board(RecordingBoard):
        given = [("Email", "lisul@example.com"), ("Pronouns", "he/him")]  # Pronouns: not a field this form left blank

        before = None  # the form's filled count when the answers were given

        def answered(self, worker):
            given, self.given = self.given, []
            if given:
                self.before = self.captions[worker]["filled"]
            elif held:  # the answer filled: what the note says now, then Lisul closes the window
                notes.append(held[0].inner_text("#apply-rehearsal-blocked"))
                held.pop().close()
            return given

    board = Board()
    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board), ApplicantProfile.load(profile), 1,
                           keep_open=True, out=lambda line: None)

    assert [(label, value) for label, value, _ in rescued] == [("Email", "lisul@example.com")]
    assert board.captions[0]["missing"] == ["Last Name"]  # what is still left blank
    assert board.captions[0]["filled"] == board.before + 1  # the window counts the field filled
    assert "Left blank: Email" in notes[0] and "Email" not in notes[1] and "Last Name" in notes[1]  # the note on the form too
    assert fake.submissions == []


def test_a_file_attached_in_the_window_is_listed_on_its_tile_kept_by_its_name_and_recorded(monkeypatch, tmp_path):
    # Live (Appian): a writing sample attached from Needs you was on the form, but not in the tile's
    # files, the Record or its README, and the line still listed it as a Missing fact.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = profile_with(tmp_path, **{"identity.email": None})
    picked = tmp_path / "picked" / "Lisul_Elvitigala_Writing_Sample.pdf"
    picked.parent.mkdir()
    picked.write_bytes(b"%PDF-1.4 a writing sample")
    rescued, held = [], []

    def field(self, page, label, value, error):
        rescued.append(value)
        held.append(page)
        return True

    monkeypatch.setattr(rehearsal.Rescue, "field", field)

    class Board(RecordingBoard):
        given = [("Email", picked)]

        def answered(self, worker):
            given, self.given = self.given, []
            if not given and held:
                held.pop().close()
            return given

    board = Board()
    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile), 1, keep_open=True, out=lambda line: None)

    [attached] = [f for f in board.captions[0]["files"] if f["label"] == "Email"]
    kept = Path(attached["path"])
    assert attached["name"] == kept.name == "Lisul_Elvitigala_Writing_Sample.pdf"
    assert kept.read_bytes() == b"%PDF-1.4 a writing sample" and kept.parent.parent.parent == worker.SENT
    assert rescued == [kept]  # the form is given the kept copy, by its own name
    assert len(board.captions[0]["files"]) > 1  # the résumé still listed beside it
    [row] = [r for r in json.loads((rehearsal_record(tmp_path) / "answers.json").read_text()) if r["question"] == "Email"]
    assert row["planned"] == row["on_page"] == "Lisul_Elvitigala_Writing_Sample.pdf"
    readme = (rehearsal_record(tmp_path) / "README.md").read_text()
    assert "| Email | Lisul_Elvitigala_Writing_Sample.pdf | Lisul_Elvitigala_Writing_Sample.pdf |" in readme
    assert "Missing facts: none" in board.captions[0]["line"]


def test_add_context_and_regenerate_on_the_form_writes_that_answer_again_into_its_field(monkeypatch, tmp_path):
    # KAN-599: Lisul reads Claude's essay on the held form, presses the small button beside it, types more
    # context and presses Regenerate. Claude writes that one answer again into the field; nothing is sent.
    from test_regenerate import CONTEXT, EARLIER, LATER

    from apply import home
    monkeypatch.setitem(FILLERS, "lever", NeverSubmits(LeverFiller()))
    mission = "What about our mission excites you?"
    claude = FakeClaude(essays={mission: [EARLIER, LATER]})
    pages, seen = [], {}
    lift = rehearsal.lift
    monkeypatch.setattr(rehearsal, "lift", lambda page, **more: (pages.append(page), lift(page, **more))[1])

    class Board(RecordingBoard):
        pressed = False

        def answered(self, worker):  # on the held page's own thread, every half second
            if not pages:
                return []
            page, [written] = pages[0], [w for w in self.captions[worker]["written"] if w["label"] == mission]
            field = page.locator(f'[data-apply-written="{written["name"]}"]')
            mine = page.locator(f'#apply-regenerate [data-for="{written["name"]}"]')
            if not self.pressed:
                field.wait_for(timeout=5_000)
                seen["before"], seen["offered"] = field.input_value(), sorted(w["kind"] for w in self.captions[worker]["written"])
                field.scroll_into_view_if_needed()
                mine.get_by_role("button", name="Add context and regenerate").click()
                mine.locator("textarea").fill(CONTEXT)
                mine.get_by_role("button", name="Regenerate", exact=True).click()
                self.pressed = True
            elif not written["state"]:  # written again
                seen["after"], seen["read_only"] = field.input_value(), field.evaluate("el => el.readOnly")
                seen["note"] = mine.inner_text()
                page.close()  # Lisul is done with it
            return []

        def update(self, worker, **caption):
            if any(w.get("state") == "working" for w in caption.get("written") or []):
                seen["working"] = pages[0].locator('[data-apply-written]').evaluate_all(
                    "boxes => boxes.filter(el => el.readOnly).length")
            super().update(worker, **caption)

    board = Board()
    lines = []
    with FakeLeverServer(HERMEUS_FORM) as fake:
        rehearsal.rehearse([HERMEUS_URL], adapters(fake, claude, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile_with(tmp_path)), 1, keep_open=True, out=lines.append)

    assert seen["offered"] == ["draft", "draft", "essay", "essay"]  # each answer Claude wrote; no pick, no profile fact
    assert seen["before"] == EARLIER and seen["working"] == 1  # only that field shows it is being written again
    assert seen["after"] == LATER and seen["read_only"] is False  # the new answer, his to edit
    assert "New answer from your context" in seen["note"]
    [written] = [w for w in board.captions[0]["written"] if w["label"] == mission]
    assert (written["text"], written["kind"], written["state"]) == (LATER, "essay", "")
    assert any(f"regenerated '{mission}' with your context" in line for line in lines)
    assert f'- For "{mission}" at Hermeus: {CONTEXT}' in home.STORY_BANK.read_text()
    [row] = [r for r in json.loads((rehearsal_record(tmp_path) / "answers.json").read_text()) if r["question"] == mission]
    assert row["planned"] == row["on_page"] == LATER  # the Record keeps the new answer
    readme = (rehearsal_record(tmp_path) / "README.md").read_text()
    assert f"Regenerated '{mission}' with your context" in readme
    assert LATER in (rehearsal_record(tmp_path) / "essays.md").read_text()
    assert fake.submissions == []


def rehearsal_record(tmp_path) -> Path:
    [readme] = (tmp_path / "rehearsals").glob("*/*/README.md")
    return readme.parent


def test_no_fill_engine_stops_its_link_on_one_line_before_the_form_opens(monkeypatch, tmp_path, capsys):
    from apply import fill_engine

    def no_engine(*args, **kwargs):
        raise fill_engine.EngineMissing("the Fill engine isn't built at /nowhere: run `git submodule update --init`")

    monkeypatch.setattr(rehearsal, "resolve", no_engine)
    repairs = RepairRequests(tmp_path / "repairs")
    lines = []
    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearsal.rehearse([ARC_URL], adapters(fake, repairs=repairs), ApplicantProfile.load(profile_with(tmp_path)),
                                    1, keep_open=False, out=lines.append)

    assert done.outcome == "failed"
    [line] = lines
    assert "git submodule update --init" in line and "\n" not in line
    assert "Traceback" not in capsys.readouterr().err
    assert repairs.all() == []


def test_a_setup_error_stops_its_link_on_one_line_and_leaves_no_repair_request(monkeypatch, tmp_path, capsys):
    from apply.adapters import SetupError

    def logged_out(*args, **kwargs):
        raise SetupError("Claude isn't logged in: run `claude auth login` in a terminal, then try again")

    monkeypatch.setattr(rehearsal, "by_filler", logged_out)
    repairs = RepairRequests(tmp_path / "repairs")
    lines = []
    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearsal.rehearse([ARC_URL], adapters(fake, repairs=repairs), ApplicantProfile.load(profile_with(tmp_path)),
                                    1, keep_open=False, out=lines.append)

    assert done.outcome == "failed"
    [line] = lines
    assert "claude auth login" in line and "\n" not in line
    assert "Traceback" not in capsys.readouterr().err
    assert repairs.all() == []


class AppliedTo:
    """The already applied check (KAN-621), answering for every link: applied on 2026-10-28, or not; and why
    WorkIt could not be checked."""

    def __init__(self, applied: bool = True, problem: str = ""):
        from apply.already_applied import Applied

        self._found = Applied(datetime(2026, 10, 28).date(), "your Applications Tracker on WorkIt: applied") \
            if applied else None
        self._problem = problem
        self.asked: list[str] = []

    def of(self, posting, *links):
        self.asked.append(posting.url)
        return self._found

    def problem(self):
        return self._problem


def test_a_link_already_applied_to_ends_before_its_form_opens(monkeypatch, tmp_path):
    # Astranis, 2026-11-04: the rehearsal filled a form he had applied to, Submit live, and he sent it again.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    board, lines, check = RecordingBoard(), [], AppliedTo()

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearsal.rehearse([ARC_URL], adapters(fake, board=board, applied_before=check),
                                    ApplicantProfile.load(profile_with(tmp_path)), keep_open=False, out=lines.append)
        opened = list(fake.workers)

    assert opened == []  # no browser, no form
    assert check.asked == [ARC_URL]
    assert done.outcome == "already applied"
    assert lines == ["Arc Boat Company | Software Engineering Intern | greenhouse | Already applied on 2026-10-28 "
                     "(your Applications Tracker on WorkIt: applied); Apply didn't open the form. "
                     "`apply rehearse --force` rehearses it anyway, with Submit blocked"]
    caption = board.captions[0]
    assert (caption["status"], caption["why"]) == (
        "already applied", "Already applied on 2026-10-28 (your Applications Tracker on WorkIt: applied)")


def test_a_check_that_could_not_run_is_said_in_the_window_and_the_terminal(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    board, lines = RecordingBoard(), []
    check = AppliedTo(applied=False, problem="you are not signed in to WorkIt (run `uv run apply login`)")

    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearsal.rehearse([ARC_URL], adapters(fake, board=board, applied_before=check),
                                    ApplicantProfile.load(profile_with(tmp_path)), keep_open=False, out=lines.append)

    said = ("Couldn't check your Applications Tracker on WorkIt for jobs you already applied to: you are not signed "
            "in to WorkIt (run `uv run apply login`). Apply checked only its own Tracker and Records")
    assert {"unchecked": said} in board.runs
    assert lines[0] == said
    assert done.outcome == "ready to submit"  # not applied to: it fills


def test_force_rehearses_it_but_submit_stays_blocked_until_the_red_note_is_dismissed(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])  # once the guard is off
    real, seen = rehearsal.warn_applied, {}

    def warned(page, day, dismissed=None):
        real(page, day, dismissed)
        seen["note"] = page.locator("#apply-already-applied").inner_text()
        page.get_by_role("button", name="Submit application").click()  # blocked
        page.wait_for_timeout(500)
        seen["sent before"] = len(fake.submissions)
        page.get_by_role("button", name="Dismiss").click()
        seen["sent after one press"] = len(fake.submissions)
        page.get_by_role("button", name="Yes, I’m sure: unblock this page").click()
    monkeypatch.setattr(rehearsal, "warn_applied", warned)
    profile = ApplicantProfile.load(profile_with(tmp_path))

    with FakeJobServer(ARC_FORM) as fake:
        lines = hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], force=True,
                           with_adapters={"applied_before": AppliedTo()})
        submissions = len(fake.submissions)

    assert seen["note"].startswith("You already applied on 2026-10-28, don’t submit.")
    assert (seen["sent before"], seen["sent after one press"]) == (0, 0)
    assert submissions == 1  # his, once he dismissed the note on purpose
    assert any(line.startswith("Arc Boat Company | ") and "ready to submit" in line for line in lines)


@pytest.mark.parametrize("outcome", [rehearsal.FAILED, rehearsal.SIGN_IN, "handoff"])
def test_a_page_apply_stopped_on_before_the_last_never_says_submit_is_yours(outcome):
    done = rehearsal.Rehearsed(Posting("p", "JPMorgan Chase", "Intern", "https://jpmc.fa.oraclecloud.com/x"), outcome,
                               "element is not editable")
    assert done.warning().startswith("Apply stopped before the form's last page")
    assert "isn't ready to submit" in done.warning() and done.wrong()


def test_a_form_filled_to_its_last_page_keeps_its_plain_note():
    done = rehearsal.Rehearsed(Posting("p", "Acme", "Intern", "https://acme.example/x"), rehearsal.READY)
    assert (done.warning(), done.wrong()) == ("", False)


class StepsSite:
    """A job site whose form has two pages, each its own document, in a browser of its own: Ask Claude going
    back a step loads a new one. Each POST is kept in `posts`, and none is answered."""

    PAGES = {"/apply/1": '<a href="/apply/2">Back to page 2</a><p>Review your application</p>',
             "/apply/2": '<form method="post" action="/apply/2"><label>GPA <input id="gpa" name="gpa" value="3.9">'
                         '</label><button>Submit application</button></form>'}

    def __init__(self):
        self.posts = []

    @contextmanager
    def open(self, url: str, worker: int = 0):
        def serve(route):
            if route.request.method == "POST":
                self.posts.append(route.request.url)
                return route.fulfill(content_type="text/html", body="<p>Thank you for applying!</p>")
            path = route.request.url.split("example.com", 1)[1]
            route.fulfill(content_type="text/html", body=self.PAGES.get(path, "<p>Not found</p>"))
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page()
                page.context.route("**/*", serve)
                page.goto(url)
                yield page
            finally:
                browser.close()


class _Claude:
    """Ask Claude's drive, played: it goes back to page 2 (a new document), fixes the GPA and presses Enter."""

    def drive(self, page, **given):
        page.click("text=Back to page 2")
        page.wait_for_selector("#gpa")
        page.fill("#gpa", "3.7")
        page.press("#gpa", "Enter")  # Enter in a field sends its form
        page.wait_for_timeout(500)
        return Drive({"blocked": False, "why": "", "reply": "Fixed the GPA.", "changed": [], "couldnt": [],
                      "waiting": [], "ticked": [], "remember": [], "apply_bug": []}, 3, 1_000)


class _Asking:
    """The held page's Ask Claude: one message, acted on with apply.ask under the drive guard."""

    def __init__(self):
        self.items, self.done = [{"id": "ask-1", "message": "page 2's GPA is wrong, it's 3.7"}], []

    def open(self, page) -> None:
        pass

    def close(self) -> None:
        pass

    def asked(self) -> list[dict]:
        items, self.items = self.items, []
        return items

    def __call__(self, page, item: dict) -> None:
        from apply import ask
        from apply.submit_guard import DriveGuard

        reply = ask.ask(_Claude(), page, item["message"], [], ask.Form(Posting("p", "Acme", "Intern", page.url)), "",
                        guard=DriveGuard(page))
        self.done.append(reply)


def test_ask_claude_on_a_held_page_sends_nothing_from_a_page_it_loads():
    # A held page is lifted for Lisul. Ask Claude drives it again, and a page it loads (going back a step) must be
    # guarded too: Enter in a field there must not send the application (KAN-638).
    site, release, asking = StepsSite(), threading.Event(), _Asking()
    kept = rehearsal._Kept(site, 0)
    timer = threading.Timer(4, release.set)
    timer.daemon = True
    timer.start()

    with kept.open("https://jobs.example.com/apply/1"):
        kept.hold(release, ask=asking)

    assert asking.done, "the message was taken"
    assert site.posts == []


def test_a_held_form_is_on_the_open_forms_list_until_lisul_sends_it(monkeypatch, tmp_path):
    # KAN-719: a restart of the Mac lost every held form (2026-11-04 and 05). The list keeps each one as it goes.
    from apply import batch

    path = tmp_path / "open-forms.json"
    monkeypatch.setattr(batch, "PATH", path)
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    profile = ApplicantProfile.load(profile_with(tmp_path))
    with FakeJobServer(ARC_FORM) as fake:
        [done] = rehearse([ARC_URL], fake, profile_with(tmp_path))
        [kept] = batch.forms(path)
        assert (kept["link"], kept["status"], kept["job_system"], kept["worker"]) == (ARC_URL, "ready to submit",
                                                                                     "greenhouse", 0)
        assert kept["application_id"] == done.posting.id and kept["record"] == done.record

        lisul_on_the_held_page(monkeypatch, lambda n: ["Submit application"])
        hold_until(fake, profile, lambda lines: "you submitted it" in lines[-1], submitted_to=InMemoryTracker())
    assert batch.forms(path) == []  # it went in: nothing to bring back
