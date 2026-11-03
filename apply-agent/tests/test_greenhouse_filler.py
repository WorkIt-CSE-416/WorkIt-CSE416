"""Seam 2: the Greenhouse Filler against a saved Greenhouse form."""

import json
import re
import shutil
from datetime import datetime

import fake_greenhouse
import pytest
from conftest import (
    ANDURIL_FORM,
    ANDURIL_URL,
    ARC_FORM,
    ARC_URL,
    COINBASE_FORM,
    COINBASE_URL,
    PURE_STORAGE_FORM,
    PURE_STORAGE_URL,
)
from fakes import FakeClock, FakeJobServer, FakeMailbox

from apply.accounts import Accounts
from apply.fill_engine import job_of
from apply.greenhouse import SECURITY_CODE_SEARCH, GreenhouseFiller, board_behind
from apply.model import FillError, Handoff, Posting, Status
from apply.orchestrator import by_filler
from apply.worker import Result


@pytest.fixture
def pure_storage():
    with FakeJobServer(PURE_STORAGE_FORM) as server:
        yield server


def test_fills_and_reads_back_a_saved_form_and_stops_before_submit(job_server, one_pager):
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    answers = {
        "first_name": "Test",
        "last_name": "Person",
        "email": "test.person@example.com",
        "phone": "+1 555 010 0199",
        "question_18871501008": "https://www.linkedin.com/in/test-person",  # LinkedIn
        "question_18871502008": "Yes",  # authorized to work in the US
        "question_18871503008": "No",  # needs sponsorship
        "veteran_status": "I don't wish to answer",
        "resume": one_pager,
    }

    with job_server.open(ARC_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == {**answers, "resume": "one-pager.pdf"}
    assert job_server.submissions == []


def test_picks_the_phone_numbers_country_beside_phone(job_server):
    # Seen live on Scale AI's form: the Country picker beside Phone was left blank.
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    names = [q.name for q in questions]
    assert names[names.index("phone") + 1] == "country"
    answers = {"phone": "5550100199", "country": "United States"}

    with job_server.open(ARC_URL) as page:
        readback = filler.fill(page, questions, answers)
        picker = page.locator("#country").locator("xpath=ancestor::div[contains(@class, 'select__control')]")
        shown = picker.locator(".select__single-value").inner_text(), picker.locator(".iti__flag.iti__us").count()

    assert shown == ("+1", 1)  # the US flag and its dial code
    assert readback == {"phone": "(555) 010-0199", "country": "United States"}  # the number formatted for the US


def test_ticks_every_planned_option_of_a_multi_select(job_server):
    filler = GreenhouseFiller()
    questions = filler.question_set(ARC_URL, job_server)
    answers = {
        "4007778008": ["I don't wish to answer"],  # gender identity (demographic block)
        "4007779008": ["East Asian", "South Asian"],  # racial/ethnic background
    }

    with job_server.open(ARC_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_picks_the_planned_place_from_the_location_search(pure_storage):
    filler = GreenhouseFiller()
    questions = filler.question_set(PURE_STORAGE_URL, pure_storage)
    answers = {"location": "Columbus, Ohio, United States"}

    with pure_storage.open(PURE_STORAGE_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_ticks_a_multi_select_shown_as_checkboxes(pure_storage):
    filler = GreenhouseFiller()
    questions = filler.question_set(PURE_STORAGE_URL, pure_storage)
    answers = {"question_69589930[]": ["Acknowledge/Confirm"]}  # Personal Information Policy

    with pure_storage.open(PURE_STORAGE_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_fills_the_education_block(pure_storage):
    filler = GreenhouseFiller()
    questions = filler.question_set(PURE_STORAGE_URL, pure_storage)
    answers = {
        "school--0": "Ohio State University - Columbus",  # searched as you type
        "degree--0": "Bachelor's Degree",
        "discipline--0": "Computer Science",
        "end-month--0": "May",
        "end-year--0": "2028",
    }

    with pure_storage.open(PURE_STORAGE_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers
    education = {q.name: q for q in questions if q.name.endswith("--0")}
    assert "Bachelor's Degree" in education["degree--0"].options
    assert [q.name for q in education.values() if q.required] == ["end-month--0", "end-year--0"]


def test_fills_an_entry_of_the_employment_block_per_job():
    # Coinbase's form (seen live): the Employment block, which the Job Board API
    # names only as "employment_required", was left empty.
    filler = GreenhouseFiller()
    with FakeJobServer(COINBASE_FORM) as coinbase:
        questions = filler.question_set(COINBASE_URL, coinbase)
        employment = {q.name: q for q in questions if q.label.startswith("Work Experience ")}
        answers = {
            "company-name-0": "Acme Rail", "title-0": "Software Engineer Intern",
            "start-date-month-0": "June", "start-date-year-0": "2026",
            "end-date-month-0": "August", "end-date-year-0": "2026", "current-role-0_1": "No",
            "company-name-1": "Cloud Co", "title-1": "Data Intern",  # one he holds now: no end date
            "start-date-month-1": "January", "start-date-year-1": "2026", "current-role-1_1": "Yes",
        }
        with coinbase.open(COINBASE_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert readback == answers
    assert employment["company-name-0"].label == "Work Experience 1 / Company name" and employment["company-name-0"].required
    assert employment["start-date-month-1"].options[0] == "January" and not employment["company-name-1"].required


@pytest.fixture
def anduril():
    with FakeJobServer(ANDURIL_FORM) as server:
        yield server


def test_asks_whether_hispanic_or_latino_right_before_race(anduril):
    names = [q.name for q in GreenhouseFiller().question_set(ANDURIL_URL, anduril)]

    # Not in the Job Board API, but on every self-ID block that asks race; race shows only once it is answered No.
    assert names[names.index("race") - 1] == "hispanic_ethnicity"


def test_answers_hispanic_or_latino_first_so_the_race_question_shows(anduril):
    filler = GreenhouseFiller()
    questions = filler.question_set(ANDURIL_URL, anduril)
    answers = {"race": "Asian", "gender": "Male", "hispanic_ethnicity": "No"}  # in the API's order

    with anduril.open(ANDURIL_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_a_question_the_form_never_shows_is_left_out_without_stopping_the_fill(anduril):
    filler = GreenhouseFiller()
    questions = filler.question_set(ANDURIL_URL, anduril)
    answers = {"hispanic_ethnicity": "Yes", "race": "Asian", "gender": "Male"}  # race shows only after a No

    with anduril.open(ANDURIL_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == {"hispanic_ethnicity": "Yes", "gender": "Male"}


def board_listing_schools(tmp_path, schools: list[str]):
    """The saved Anduril form, on a board whose school search for "Example State
    University" lists `schools` (Point72's lists only "Example State University - SUNY")."""
    form = tmp_path / "form"
    shutil.copytree(ANDURIL_FORM, form)
    har = json.loads((form / "page.har").read_text())
    for entry in har["log"]["entries"]:
        if "schools?term=Example" in entry["request"]["url"]:
            items = [{"id": n, "text": school} for n, school in enumerate(schools)]
            entry["response"]["content"]["text"] = json.dumps({"items": items, "meta": {"total_count": len(items), "per_page": 100}})
    (form / "page.har").write_text(json.dumps(har))
    return FakeJobServer(form)


def test_picks_the_one_school_named_like_the_answer_when_none_is_named_exactly(tmp_path):
    filler = GreenhouseFiller()
    with board_listing_schools(tmp_path, ["Example State University - SUNY", "Stonehill College"]) as board:
        questions = filler.question_set(ANDURIL_URL, board)
        with board.open(ANDURIL_URL) as page:
            readback = filler.fill(page, questions, {"school--0": "Example State University"})

    # Read back as the page words it, for the Pre-submit check's re-plan to adopt.
    assert readback == {"school--0": "Example State University - SUNY"}


def test_two_schools_named_like_the_answer_are_not_guessed_between(tmp_path):
    filler = GreenhouseFiller()
    with board_listing_schools(tmp_path, ["Example State University - SUNY", "Example State University - Southampton"]) as board:
        questions = filler.question_set(ANDURIL_URL, board)
        with board.open(ANDURIL_URL) as page, pytest.raises(FillError, match="Example State University - Southampton"):
            filler.fill(page, questions, {"school--0": "Example State University"})


def test_a_slow_upload_is_waited_for_not_sent_again(one_pager):
    filler = GreenhouseFiller()
    with FakeJobServer(ARC_FORM, upload_delay=7) as slow:  # seen live: Anduril's upload took over 5 s
        questions = filler.question_set(ARC_URL, slow)
        with slow.open(ARC_URL) as page:
            readback = filler.fill(page, questions, {"resume": one_pager})

    assert readback == {"resume": "one-pager.pdf"}


def test_picks_the_first_of_places_worded_alike(tmp_path):
    # Seen live: the geocoder listed two places worded "Riverton, New York, United States" (two Rivertons in NY).
    form = tmp_path / "form"
    shutil.copytree(PURE_STORAGE_FORM, form)
    har = json.loads((form / "page.har").read_text())
    for entry in har["log"]["entries"]:
        if "geocode" in entry["request"]["url"]:
            found = json.loads(entry["response"]["content"]["text"])
            twin = json.loads(json.dumps(found["features"][0]))
            twin["properties"]["id"] = twin["properties"]["gid"] = "twin"
            found["features"].insert(1, twin)
            entry["response"]["content"]["text"] = json.dumps(found)
    (form / "page.har").write_text(json.dumps(har))
    filler = GreenhouseFiller()

    with FakeJobServer(form) as board:
        questions = filler.question_set(PURE_STORAGE_URL, board)
        with board.open(PURE_STORAGE_URL) as page:
            readback = filler.fill(page, questions, {"location": "Columbus, Ohio, United States"})

    assert readback == {"location": "Columbus, Ohio, United States"}


def test_a_bare_heading_label_carries_the_question_greenhouse_puts_in_its_description(anduril):
    # Anduril's "U.S. WORK AUTHORIZATION" asks its question only in the description.
    questions = {q.name: q for q in GreenhouseFiller().question_set(ANDURIL_URL, anduril)}

    assert questions["question_13130333007"].label == (
        "U.S. WORK AUTHORIZATION: Are you authorized to work in the United States?"
    )
    assert questions["question_13130334007"].label.startswith("Will you require sponsorship")  # a question already


class BoardsOnly:
    """A JobSite whose Greenhouse API knows only the jobs given, by board."""

    def __init__(self, jobs: dict[str, str]):
        self.jobs, self.fetched = jobs, []

    def fetch(self, url, body=None):
        self.fetched.append(url)
        for board, job in self.jobs.items():
            if url == f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job}":
                return b"{}"
        raise OSError("HTTP 404")


@pytest.mark.parametrize("company, url, board", [
    ("Waymo", "https://careers.withwaymo.com/jobs?gh_jid=8257660", "waymo"),
    ("Epic Games", "https://epicgames.com/careers/jobs/6202675004?gh_jid=6202675004", "epicgames"),
    ("Zipline", "https://www.zipline.com/open-roles/8020865003?gh_jid=8020865003", "flyzipline"),
    ("Akuna Capital University", "https://www.akunacapital.com/careers/job/8018847/?gh_jid=8018847", "akunacapital"),
    ("www.zipline.com", "https://www.zipline.com/open-roles/8020865003?gh_jid=8020865003", "flyzipline"),  # a Request: named by host
    ("Optiver", "https://www.optiver.com/join-us/jobs/8401052002/?gh_jid=8401052002", "optiverus"),
    ("Stoke Space", "https://stokespace.com/careers/current-openings?gh_jid=6176786004", "stokespacetechnologies"),
])
def test_a_careers_page_with_a_greenhouse_job_is_filled_on_greenhouse(company, url, board):
    job = re.search(r"gh_jid=(\d+)", url)[1]
    posting = Posting("p", company, "Intern", url)

    behind = board_behind(posting, BoardsOnly({board: job}))

    embedded = f"https://job-boards.greenhouse.io/embed/job_app?for={board}&token={job}"
    assert (behind.url, behind.job_system, behind.id) == (embedded, "greenhouse", "p")
    assert (job_of(behind.url)["board"], job_of(behind.url)["job"]) == (board, job)


def test_a_careers_page_whose_board_is_not_found_stays_as_it_is():
    posting = Posting("p", "Mystery Co", "Intern", "https://mystery.example/jobs?gh_jid=123")

    assert board_behind(posting, BoardsOnly({})) == posting



class JobApi:
    """Greenhouse's job API, saying where each job's own page is."""

    def __init__(self, absolute_url: str | None):
        self.absolute_url = absolute_url

    def fetch(self, url, body=None):
        assert url == "https://boards-api.greenhouse.io/v1/boards/roblox/jobs/8072713"
        if self.absolute_url is None:
            raise OSError("HTTP 404")
        return json.dumps({"absolute_url": self.absolute_url}).encode()


@pytest.mark.parametrize("url", ["https://job-boards.greenhouse.io/roblox/jobs/8072713",
                                 "https://boards.greenhouse.io/roblox/jobs/8072713"])
def test_a_greenhouse_job_shown_on_the_companys_own_site_is_filled_in_its_embedded_form(url):
    # Roblox and Waymo (seen live): the hosted page sends the browser to the careers
    # site, whose form sits in a frame the Filler waited on until it timed out.
    posting = Posting("p", "Roblox", "Intern", url)

    behind = board_behind(posting, JobApi("https://careers.roblox.com/jobs/8072713?gh_jid=8072713"))

    assert behind.url == "https://job-boards.greenhouse.io/embed/job_app?for=roblox&token=8072713"


@pytest.mark.parametrize("absolute_url", ["https://job-boards.greenhouse.io/roblox/jobs/8072713", None])
def test_a_greenhouse_job_on_its_hosted_page_or_unknown_to_the_api_stays_as_it_is(absolute_url):
    posting = Posting("p", "Roblox", "Intern", "https://job-boards.greenhouse.io/roblox/jobs/8072713")

    assert board_behind(posting, JobApi(absolute_url)) == posting


class ShownOn:
    """Greenhouse's job API with one job on one board, shown on `absolute_url`."""

    def __init__(self, board: str, job: str, absolute_url: str):
        self.job, self.absolute_url = f"{board}/jobs/{job}", absolute_url

    def fetch(self, url, body=None):
        if url == f"https://boards-api.greenhouse.io/v1/boards/{self.job}":
            return json.dumps({"absolute_url": self.absolute_url}).encode()
        raise OSError("HTTP 404")


def test_a_careers_page_with_the_greenhouse_job_id_in_its_path_is_filled_on_greenhouse():
    # Roblox (seen live): no ?gh_jid=, so Claude fill worked its embedded form for 1.2M tokens.
    posting = Posting("p", "careers.roblox.com", "Intern", "https://careers.roblox.com/jobs/8072713")

    behind = board_behind(posting, ShownOn("roblox", "8072713", "https://careers.roblox.com/jobs/8072713?gh_jid=8072713"))

    assert (behind.url, behind.job_system) == ("https://job-boards.greenhouse.io/embed/job_app?for=roblox&token=8072713",
                                               "greenhouse")


def test_an_id_in_the_path_that_greenhouse_shows_on_another_site_stays_as_it_is():
    # Another job system's id that happens to be a Greenhouse job of a board the guesses hit.
    posting = Posting("p", "Roblox", "Intern", "https://careers.roblox.com/jobs/8072713")

    assert board_behind(posting, ShownOn("roblox", "8072713", "https://elsewhere.example/jobs/8072713")) == posting


class EmbedPage:
    def fetch(self, url, body=None):
        assert url == "https://boards.greenhouse.io/embed/job_app?token=6865687002"
        return b'<script src="https://job-boards.greenhouse.io/embed/job_app?for=databricks&amp;token=6865687002"></script>'


def test_an_embed_link_without_its_board_learns_it_from_the_page():
    # Databricks in the Feed (seen live): no for=, and the Filler failed reading the board.
    posting = Posting("p", "Databricks", "Intern", "https://boards.greenhouse.io/embed/job_app?token=6865687002")

    behind = board_behind(posting, EmbedPage())

    assert (job_of(behind.url)["board"], job_of(behind.url)["job"]) == ("databricks", "6865687002")


# --- Greenhouse's security code ---------------------------------------------------
# Greenhouse emails an 8-character code before it takes some applications, and
# shows a step for it after Submit. A real run only: a rehearsal never submits.

NOW = datetime(2026, 10, 16, 9, 0)


def accounts(mailbox, clock=None):
    return Accounts(keychain=None, mailbox=mailbox, clock=clock or FakeClock(NOW), login="test.person@example.com")


@pytest.mark.parametrize("boxes", [fake_greenhouse.BOXES, fake_greenhouse.ONE_BOX])
def test_greenhouses_security_code_is_read_from_gmail_typed_and_the_application_sent(boxes):
    mailbox = FakeMailbox()
    greenhouse = fake_greenhouse.FakeGreenhouse(
        boxes=boxes, on_asked=lambda: mailbox.deliver(SECURITY_CODE_SEARCH, code=fake_greenhouse.CODE))

    with greenhouse.open() as page:
        met = GreenhouseFiller(accounts(mailbox)).submit(page)

    assert greenhouse.confirmed
    assert met == ("security code",)  # a Bot signal: Greenhouse wanted more proof than the form


def test_the_security_code_is_looked_for_from_both_of_greenhouses_mail_senders():
    assert "from:" in SECURITY_CODE_SEARCH
    assert "greenhouse-mail.io" in SECURITY_CODE_SEARCH and "us.greenhouse-mail.io" in SECURITY_CODE_SEARCH


def test_a_form_greenhouse_takes_at_once_needs_no_mail():
    mailbox = FakeMailbox(set_up=False)
    greenhouse = fake_greenhouse.FakeGreenhouse(asks=False)

    with greenhouse.open() as page:
        met = GreenhouseFiller(accounts(mailbox)).submit(page)

    assert greenhouse.confirmed and mailbox.looks == 0
    assert not met


def test_a_security_code_with_gmail_not_set_up_is_a_handoff_saying_so():
    greenhouse = fake_greenhouse.FakeGreenhouse()

    with greenhouse.open() as page, pytest.raises(Handoff) as handoff:
        GreenhouseFiller(accounts(FakeMailbox(set_up=False))).submit(page)

    assert "security code" in str(handoff.value) and "Gmail isn't set up" in str(handoff.value)
    assert handoff.value.bot_signal == "security code"
    assert not greenhouse.confirmed


def test_a_security_code_that_never_comes_is_a_handoff_and_resend_is_never_clicked():
    resent = []
    greenhouse = fake_greenhouse.FakeGreenhouse(on_resend=lambda: resent.append(True))

    with greenhouse.open() as page, pytest.raises(Handoff) as handoff:
        GreenhouseFiller(accounts(FakeMailbox())).submit(page)

    assert resent == []
    assert "greenhouse-mail.io" in str(handoff.value) and "yourself" in str(handoff.value)
    assert handoff.value.bot_signal == "security code"
    assert not greenhouse.confirmed


def test_a_runs_greenhouse_filler_reads_the_applications_own_mail():
    mailbox = FakeMailbox()
    greenhouse = fake_greenhouse.FakeGreenhouse(
        on_asked=lambda: mailbox.deliver(SECURITY_CODE_SEARCH, code=fake_greenhouse.CODE))
    posting = Posting("gh-1", "Acme", "Software Engineering Intern", fake_greenhouse.URL)

    def apply(filler, site):  # the Worker, at the end of a filled form
        with greenhouse.open() as page:
            filler.submit(page)
        return Result(Status.SUBMITTED)

    by_filler(posting, FakeJobServer(), None, None, lambda: accounts(mailbox), apply)

    assert greenhouse.confirmed
