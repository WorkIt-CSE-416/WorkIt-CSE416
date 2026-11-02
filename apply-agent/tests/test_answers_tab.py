"""The Answers tab of the Apply window: everything Apply answers from, and
Lisul's edits to his one-off answers, his answers to Missing facts and his
Stock answers. Served by the dashboard on 127.0.0.1, over a throwaway Answer
bank and Applicant profile (never Lisul's own)."""

import json
import threading
import urllib.error
import urllib.request
from datetime import date

import pytest
from playwright.sync_api import sync_playwright

from apply import home, stock
from apply.answer_bank import AnswerBank
from apply.answers_tab import AnswersTab
from apply.dashboard import Dashboard
from apply.model import Question, Status
from apply.profile import ApplicantProfile
from apply.tracker import Row

DAY = date(2026, 10, 16)
SKILLS = Question("q1", "Skill Areas (Select all that apply)", "multi_select", True, ("Finance", "Software", "Robotics"))
HEARD = Question("q2", "Tell us how you heard about Zipline", "text", True)

PROFILE = """\
# A dummy Applicant profile. Never Lisul's real data.
identity:
  legal_first_name: Test
  legal_last_name: Person
  current_location:
    city: Columbus
    state: OH
  pronouns:
files:
  resume_pdf: ../final/Test_Person_Resume.pdf  # relative to this file
logistics:
  available_terms: [Summer 2027, Fall 2027]
stock_answers:
  internship_goals: >-  # Datacor
    I want to own a project and see it get used.
  why_this_major: I like building things.
answered_questions:
  Do you have a valid driver's license?: 'Yes'
"""


class NoFrames:
    def frame(self, worker): return None
    def wait(self, worker, after, timeout): return None, after
    def input(self, worker, event): return None
    def chooser(self, worker): return None


@pytest.fixture(autouse=True)
def stock_file(tmp_path, monkeypatch):
    """A throwaway stock-answers.yaml: never Lisul's own."""
    monkeypatch.setattr(stock, "PATH", tmp_path / "stock-answers.yaml")
    monkeypatch.setattr(home, "STORY_BANK", tmp_path / "story-bank.md")


ESSAYS = "## Why did you choose your major?\nRobots made it click.\n\n## Why do you want to join Acme?\nYour robots."
HELD = Row("a1", "Acme", "SWE Intern", "https://jobs.example.com/1", "greenhouse", Status.HELD, essay=ESSAYS)


@pytest.fixture
def files(tmp_path):
    profile = tmp_path / "applicant-profile.yaml"
    profile.write_text(PROFILE)
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    bank.add(SKILLS, ["Software"], "Zipline", DAY)
    bank.add(HEARD, "From the Simplify list.", "Skydio", DAY)
    return profile, tmp_path / "answer-bank.yaml"


@pytest.fixture
def board(files):
    profile, bank = files
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile, today=lambda: DAY)) as board:
        yield board


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())


def test_the_answers_tab_lists_the_bank_his_answers_his_stock_answers_and_his_profile(board):
    view = get_json(board.url + "/answers")

    assert view["bank"] == [
        {"question": SKILLS.label, "answer": ["Software"], "options": list(SKILLS.options), "source": "claude",
         "reviewed": False, "company": "Zipline", "date": "2026-10-16", "uses": 0, "last_used": ""},
        {"question": HEARD.label, "answer": "From the Simplify list.", "options": [], "source": "claude",
         "reviewed": False, "company": "Skydio", "date": "2026-10-16", "uses": 0, "last_used": ""},
    ]
    assert view["answered"] == [{"question": "Do you have a valid driver's license?", "answer": "Yes"}]
    assert view["stock"] == [
        {"key": "internship_goals", "answer": "I want to own a project and see it get used."},
        {"key": "why_this_major", "answer": "I like building things."},
    ]
    assert view["profile"] == [
        {"section": "identity", "facts": [["legal_first_name", "Test"], ["legal_last_name", "Person"],
                                          ["current_location.city", "Columbus"], ["current_location.state", "OH"],
                                          ["pronouns", ""]]},
        {"section": "files", "facts": [["resume_pdf", "Test_Person_Resume.pdf"]]},  # a name, never a path
        {"section": "logistics", "facts": [["available_terms", "Summer 2027, Fall 2027"]]},
    ]


def test_unreviewed_drafts_used_again_come_first_most_used_first_with_their_uses(board, files):
    path = files[1]
    AnswerBank(path).answer("Are you open to a hybrid schedule?", "Yes", DAY)
    AnswerBank(path).use(["Are you open to a hybrid schedule?", HEARD.label], date(2026, 10, 17))
    AnswerBank(path).use(["Are you open to a hybrid schedule?", HEARD.label], date(2026, 10, 18))
    AnswerBank(path).use([SKILLS.label], date(2026, 10, 18))
    AnswerBank(path).use([HEARD.label], date(2026, 10, 19))

    bank = get_json(board.url + "/answers")["bank"]

    assert [(e["question"], e["uses"], e["last_used"]) for e in bank] == [
        (HEARD.label, 3, "2026-10-19"),
        (SKILLS.label, 1, "2026-10-18"),
        ("Are you open to a hybrid schedule?", 2, "2026-10-18"),  # his own: in bank order
    ]


def test_the_answers_tab_never_shows_a_key_that_looks_like_a_secret(tmp_path):
    # A profile file with one is refused on load; one in memory still never reaches the window.
    profile = ApplicantProfile({
        "identity": {"legal_first_name": "Test", "gmail_app_password": "hunter2"},
        "accounts": {"api_key": "sk-123", "workday": {"site": "acme", "Password": "pw"}},
        "stock_answers": {"internship_goals": "Ship things.", "secret_token": "abc"},
        "answered_questions": {"What is your SSN password?": "1234", "Pronouns?": "he/him"},
    }, tmp_path, path=tmp_path / "applicant-profile.yaml")
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(), profile)) as board:
        view = get_json(board.url + "/answers")

    shown = json.dumps(view)
    assert all(secret not in shown for secret in ("hunter2", "sk-123", "pw\"", "abc", "1234", "password", "api_key"))
    assert view["profile"] == [{"section": "identity", "facts": [["legal_first_name", "Test"]]},
                               {"section": "accounts", "facts": [["workday.site", "acme"]]}]


def post(board: Dashboard, path: str, body: object, headers: dict | None = None) -> tuple[int, dict]:
    """POST `body` to the window's server as the page itself does: with its token."""
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    sent = {"Content-Type": "application/json", "X-Apply-Token": board.token, "Origin": board.url} | (headers or {})
    request = urllib.request.Request(board.url + path, data, {k: v for k, v in sent.items() if v is not None})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def test_lisuls_answer_saved_in_the_tab_becomes_the_banks_and_counts_as_reviewed(board, files):
    status, view = post(board, "/answers/bank/save", {"question": SKILLS.label, "answer": ["Software", "Robotics"]})

    assert status == 200
    skills = AnswerBank(files[1]).get(SKILLS.label)
    assert (skills.answer, skills.source, skills.reviewed) == (["Software", "Robotics"], "lisul", True)
    assert view["bank"][0] == {"question": SKILLS.label, "answer": ["Software", "Robotics"], "options": list(SKILLS.options),
                               "source": "lisul", "reviewed": True, "company": "Zipline", "date": "2026-10-16",
                               "uses": 0, "last_used": ""}


def test_marking_reviewed_in_the_tab_leaves_claudes_answer(board, files):
    status, view = post(board, "/answers/bank/review", {"question": HEARD.label})

    assert status == 200
    heard = AnswerBank(files[1]).get(HEARD.label)
    assert (heard.answer, heard.source, heard.reviewed) == ("From the Simplify list.", "claude", True)
    assert view["bank"][1]["reviewed"] is True


def test_deleting_in_the_tab_takes_the_answer_out_of_the_bank(board, files):
    status, view = post(board, "/answers/bank/delete", {"question": HEARD.label})

    assert status == 200
    assert AnswerBank(files[1]).get(HEARD.label) is None
    assert [e["question"] for e in view["bank"]] == [SKILLS.label]
    assert post(board, "/answers/bank/delete", {"question": HEARD.label})[0] == 404


def test_a_question_added_in_the_tab_joins_the_bank_as_lisuls(board, files):
    status, view = post(board, "/answers/bank/add", {"question": "Are you open to a hybrid schedule?", "answer": "Yes"})

    assert status == 200
    entry = AnswerBank(files[1]).get("Are you open to a hybrid schedule?")
    assert (entry.answer, entry.source, entry.reviewed, entry.first_seen) == ("Yes", "lisul", True, DAY)
    assert view["bank"][-1]["question"] == "Are you open to a hybrid schedule?"
    # A question already in the bank is edited where it is listed, never replaced by an add.
    status, reply = post(board, "/answers/bank/add", {"question": HEARD.label.upper(), "answer": "A friend."})
    assert status == 409 and "already" in reply["error"]
    assert AnswerBank(files[1]).get(HEARD.label).answer == "From the Simplify list."


@pytest.mark.parametrize("path, body", [
    ("/answers/bank/save", {"question": "", "answer": "Yes"}),
    ("/answers/bank/save", {"question": SKILLS.label, "answer": "  "}),
    ("/answers/bank/save", {"question": SKILLS.label, "answer": []}),
    ("/answers/bank/save", {"question": SKILLS.label, "answer": 7}),
    ("/answers/bank/save", {"question": SKILLS.label, "answer": "x" * 20_001}),
    ("/answers/bank/add", {"question": "q" * 1_001, "answer": "Yes"}),
    ("/answers/bank/save", {"question": SKILLS.label, "answer": ["Software"] * 101}),
])
def test_an_edit_that_is_empty_or_too_long_is_refused(board, files, path, body):
    before = files[1].read_text()

    status, reply = post(board, path, body)

    assert status == 400 and reply["error"]
    assert files[1].read_text() == before


def test_a_body_too_big_for_any_answer_is_refused_unread(board):
    assert post(board, "/answers/bank/save", b"{" + b" " * 300_000 + b"}")[0] == 413


def test_his_answer_to_a_missing_fact_is_saved_into_the_profile(board, files):
    status, view = post(board, "/answers/answered/save", {"question": "Do you have a valid driver's license?", "answer": "No"})

    assert status == 200
    assert view["answered"] == [{"question": "Do you have a valid driver's license?", "answer": "No"}]
    text = files[0].read_text()
    assert "Do you have a valid driver's license?: 'No'" in text and "# A dummy Applicant profile" in text


def test_an_answer_to_a_missing_fact_under_a_secret_looking_question_is_refused(board, files):
    before = files[0].read_text()
    status, reply = post(board, "/answers/answered/save", {"question": "Choose a password for your account", "answer": "x"})

    assert status == 400 and "must not hold secrets" in reply["error"]
    assert files[0].read_text() == before


def test_a_stock_answer_is_saved_into_the_profile_in_its_own_style(board, files):
    status, view = post(board, "/answers/stock/save", {"key": "internship_goals", "answer": "I want to ship to real users."})

    assert status == 200
    assert view["stock"][0] == {"key": "internship_goals", "answer": "I want to ship to real users."}
    text = files[0].read_text()
    assert "internship_goals: >-  # Datacor\n    I want to ship to real users.\n" in text
    assert post(board, "/answers/stock/save", {"key": "favorite_color", "answer": "Blue"})[0] == 404


def test_a_held_essay_of_a_stock_type_offers_to_become_his_stock_answer(files):
    profile, bank = files
    sent = Row("a2", "Beta", "SWE Intern", "https://jobs.example.com/2", "greenhouse", Status.SUBMITTED, essay=ESSAYS)
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile, held=lambda: [HELD, sent])) as board:
        view = get_json(board.url + "/answers")
        # only the held one, and only the type that takes stock (not why-company); nothing saved yet
        assert view["stock_offers"] == [{"type": "why-field", "company": "Acme",
                                         "question": "Why did you choose your major?",
                                         "answer": "Robots made it click."}]
        assert view["stock_types"] == [] and stock.get("why-field") is None

        status, view = post(board, "/answers/stock/keep", {"type": "why-field", "company": "Acme",
                                                           "question": "Why did you choose your major?",
                                                           "answer": "Robots, then math."})

    assert status == 200 and view["stock_offers"] == []
    assert view["stock_types"][0]["type"] == "why-field" and view["stock_types"][0]["answer"] == "Robots, then math."
    kept = stock.get("why-field")
    assert kept.text == "Robots, then math." and kept.from_company == "Acme" and kept.approved is not None


def test_only_an_offered_essay_can_be_kept_and_a_kept_one_is_editable(files):
    profile, bank = files
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile, held=lambda: [HELD])) as board:
        assert post(board, "/answers/stock/keep", {"type": "why-company", "company": "Acme",
                                                   "question": "Why do you want to join Acme?", "answer": "x"})[0] == 404
        assert post(board, "/answers/stock/type/save", {"type": "why-field", "answer": "x"})[0] == 404
        post(board, "/answers/stock/keep", {"type": "why-field", "company": "Acme",
                                            "question": "Why did you choose your major?", "answer": "Robots."})
        status, view = post(board, "/answers/stock/type/save", {"type": "why-field", "answer": "My own words."})

    assert status == 200 and view["stock_types"][0]["answer"] == "My own words."
    assert stock.get("why-field").text == "My own words."


def test_the_tab_edits_the_profile_a_run_holds_so_the_runs_own_save_keeps_it(files):
    profile_path, bank = files
    profile = ApplicantProfile.load(profile_path)
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile)) as board:
        post(board, "/answers/stock/save", {"key": "why_this_major", "answer": "Robots."})

    profile.set_answered("Pronouns?", "he/him")  # a Worker's Missing fact, later in the run
    profile.save()
    assert ApplicantProfile.load(profile_path).get("stock_answers.why_this_major") == "Robots."


@pytest.mark.parametrize("headers", [
    {"X-Apply-Token": None},
    {"X-Apply-Token": "guessed"},
    {"Origin": "https://evil.example"},
    {"Host": "evil.example"},  # DNS rebinding: another site's name on this port
])
def test_an_edit_from_anywhere_but_the_page_itself_is_refused(board, files, headers):
    before = files[1].read_text()

    status, _reply = post(board, "/answers/bank/delete", {"question": HEARD.label}, headers)

    assert status == 403
    assert files[1].read_text() == before


def test_another_sites_name_for_this_port_reads_nothing(board):
    request = urllib.request.Request(board.url + "/answers", headers={"Host": "evil.example"})
    with pytest.raises(urllib.error.HTTPError) as refused:
        urllib.request.urlopen(request)
    assert refused.value.code == 403


def test_edits_in_the_tab_and_a_runs_drafts_at_once_lose_nothing(board, files):
    drafts = [Question(f"d{n}", f"Drafted question {n}?", "text", True) for n in range(12)]
    added = [f"Lisul's question {n}?" for n in range(12)]

    def draft(q):  # a Worker of the run, with a bank of its own, as another process has
        AnswerBank(files[1]).add(q, f"Draft {q.name}", "Acme", DAY)

    threads = [threading.Thread(target=draft, args=(q,)) for q in drafts] + \
              [threading.Thread(target=post, args=(board, "/answers/bank/add", {"question": q, "answer": "Mine"})) for q in added]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    bank = AnswerBank(files[1])
    assert [bank.get(q.label).answer for q in drafts] == [f"Draft d{n}" for n in range(12)]
    assert [bank.get(q).answer for q in added] == ["Mine"] * 12
    assert len(get_json(board.url + "/answers")["bank"]) == 2 + 24


# The tab in the window itself.

@pytest.fixture
def window():
    """The Apply window: a page in a throwaway headless Chromium."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page(viewport={"width": 900, "height": 600})
        finally:
            browser.close()


def entry(window, question: str):
    return window.locator(".bank-entry", has_text=question)


def test_lisul_opens_the_answers_tab_and_edits_a_choice_and_a_text_answer(board, files, window):
    window.goto(board.url)
    window.click("#tab-answers")

    skills = entry(window, SKILLS.label)
    assert "Zipline" in skills.inner_text() and "2026-10-16" in skills.inner_text()
    assert "Written by Claude" in skills.inner_text() and "Check this" in skills.inner_text()
    skills.click()
    # A choice question offers its own options, with Claude's ticked.
    assert skills.locator("input[type=checkbox]").evaluate_all("bs => bs.map(b => [b.value, b.checked])") == \
        [["Finance", False], ["Software", True], ["Robotics", False]]
    skills.locator("input[value=Robotics]").check()
    assert skills.locator(".status").inner_text() == "Unsaved changes"
    skills.locator("button", has_text="Save").click()
    window.wait_for_function("document.querySelector('.bank-entry .status')?.textContent === 'Saved'")
    assert AnswerBank(files[1]).get(SKILLS.label).answer == ["Software", "Robotics"]
    assert "Written by you" in entry(window, SKILLS.label).inner_text()

    heard = entry(window, HEARD.label)
    heard.click()
    heard.locator("textarea").fill("A friend on the avionics team.")
    heard.locator("button", has_text="Save").click()
    window.wait_for_function("[...document.querySelectorAll('.bank-entry .status')].some(s => s.textContent === 'Saved')")
    entry_now = AnswerBank(files[1]).get(HEARD.label)
    assert (entry_now.answer, entry_now.source, entry_now.reviewed) == ("A friend on the avionics team.", "lisul", True)


def test_an_unreviewed_draft_used_again_shows_how_often_and_comes_first(board, files, window):
    AnswerBank(files[1]).use([HEARD.label], date(2026, 10, 17))
    AnswerBank(files[1]).use([HEARD.label], date(2026, 10, 18))
    window.goto(board.url + "/#answers")

    first = window.locator(".bank-entry").first
    assert HEARD.label in first.inner_text()
    assert "Used on 3 applications · last 2026-10-18" in first.inner_text()
    assert "Used on" not in entry(window, SKILLS.label).inner_text()


def test_lisul_marks_one_reviewed_deletes_another_and_adds_his_own(board, files, window):
    window.goto(board.url + "/#answers")
    entry(window, HEARD.label).click()
    entry(window, HEARD.label).locator("button", has_text="Looks right").click()
    window.wait_for_function("document.body.innerText.includes('Marked checked')")
    assert AnswerBank(files[1]).get(HEARD.label).reviewed

    window.once("dialog", lambda dialog: dialog.accept())
    entry(window, SKILLS.label).click()
    entry(window, SKILLS.label).locator("button", has_text="Delete").click()
    entry(window, SKILLS.label).wait_for(state="detached")
    assert AnswerBank(files[1]).get(SKILLS.label) is None

    window.click("#add-open")
    window.fill("#add-question", "Are you open to a hybrid schedule?")
    window.fill("#add-answer", "Yes")
    window.click("#add-button")
    entry(window, "Are you open to a hybrid schedule?").wait_for()
    assert AnswerBank(files[1]).get("Are you open to a hybrid schedule?").answer == "Yes"


def show(window, segment: str) -> None:
    window.click(f".segments label:has-text('{segment}')")


def test_a_refused_edit_says_why_in_the_tab(board, files, window):
    window.goto(board.url + "/#answers")
    show(window, "Your facts")
    answered = window.locator(".answered-entry", has_text="driver's license")
    answered.locator("textarea").fill("")
    answered.locator("button", has_text="Save").click()
    answered.locator(".status.error").wait_for()
    assert answered.locator(".status").inner_text() == "Write an answer."


def test_lisul_clicks_save_as_stock_answer_on_a_held_essay(files, window):
    profile, bank = files
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile, held=lambda: [HELD])) as board:
        window.goto(board.url + "/#answers")
        show(window, "Your facts")
        offer = window.locator(".stock-entry", has_text="Save as stock answer? why-field")
        assert stock.get("why-field") is None  # shown, not saved
        offer.locator("textarea").fill("Robots, then math.")
        offer.locator("button", has_text="Save as stock answer").click()
        window.wait_for_selector(".stock-entry >> text=first written for Acme")

    assert stock.get("why-field").text == "Robots, then math."


def test_his_stock_answers_and_profile_facts_show_and_a_stock_answer_saves(board, files, window):
    window.goto(board.url + "/#answers")
    show(window, "Your facts")
    goals = window.locator(".stock-entry", has_text="Internship goals")
    goals.locator("textarea").fill("I want to ship to real users.")
    goals.locator("button", has_text="Save").click()
    window.wait_for_function("document.querySelector('.stock-entry .status').textContent === 'Saved'")
    assert ApplicantProfile.load(files[0]).get("stock_answers.internship_goals") == "I want to ship to real users."

    facts = window.inner_text("#profile-facts")
    assert facts.startswith("Identity\nlegal first name\nTest\n")
    assert "current location › city\nColumbus" in facts and "pronouns\n—" in facts
    assert "Test_Person_Resume.pdf" in facts and "../final" not in facts


def test_the_search_box_narrows_every_section(board, window):
    window.goto(board.url + "/#answers")
    window.fill("#search", "zipline")

    assert window.locator(".bank-entry:visible").count() == 2  # HEARD asks about Zipline; SKILLS was first seen there
    window.fill("#search", "robotics")
    assert window.locator(".bank-entry:visible").count() == 1
    assert window.locator(".stock-entry:visible").count() == 0


def test_text_in_the_answers_tab_can_be_selected_but_tiles_still_cannot(board, window):
    window.goto(board.url + "/#answers")
    window.locator(".bank-entry").first.click()

    assert window.eval_on_selector(".bank-entry textarea, .bank-entry .other", "e => getComputedStyle(e).userSelect") != "none"
    assert window.eval_on_selector("#answers", "e => getComputedStyle(e).userSelect") != "none"
    assert window.eval_on_selector("#workers", "e => getComputedStyle(e).userSelect") == "none"


def test_with_no_run_going_the_workers_tab_says_so(board, window):
    window.goto(board.url)

    assert window.is_visible("#inbox")  # the tab that says what needs him, and what to do first
    window.click("#tab-workers")
    assert "No applications are being filled" in window.inner_text("#workers")


def test_the_answers_tab_fits_a_small_window(board, window):
    window.set_viewport_size({"width": 360, "height": 480})
    window.goto(board.url + "/#answers")
    entry(window, SKILLS.label).click()

    assert window.evaluate("document.documentElement.scrollWidth <= innerWidth")


def test_an_answer_with_markup_shows_as_text(files, window):
    profile, bank = files
    AnswerBank(bank).answer("<img src=x onerror=\"document.title='pwned'\">", "<b>bold</b>", DAY)
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile)) as board:
        window.goto(board.url + "/#answers")
        show(window, "All")
        entry(window, "<b>bold</b>").wait_for()
        assert window.title() != "pwned"


def test_while_a_run_goes_the_window_opens_on_its_inbox_with_workers_and_answers_a_tab_away(files, window):
    profile, bank = files
    with Dashboard(2, NoFrames(), AnswersTab(AnswerBank(bank), profile)) as board:
        board.update(1, company="Rhombus", status="filling")
        window.goto(board.url)
        window.wait_for_function("document.getElementById('caption-1').textContent.includes('Rhombus')", timeout=10_000)
        assert window.is_visible("#inbox") and not window.is_visible(".tile[data-k='1']")
        assert "Apply is filling 1 application." in window.inner_text("#inbox")

        window.click("#tab-workers")
        assert window.is_visible(".tile[data-k='1']") and not window.is_visible("#answers")

        window.click("#tab-answers")
        entry(window, SKILLS.label).wait_for()
        assert not window.is_visible(".tile[data-k='1']")
        window.click("#tab-workers")
        assert window.is_visible(".tile[data-k='1']")


def test_the_tab_opens_on_what_there_is_to_check_and_says_what_its_filter_hides(board, files, window):
    window.goto(board.url + "/#answers")
    entry(window, HEARD.label).wait_for()

    assert window.is_checked("[name=answers-filter][value=check]")
    assert not window.is_visible("#sec-stock") and not window.is_visible("#sec-facts")
    show(window, "Your facts")
    assert window.is_visible("#profile-facts") and not window.is_visible("#sec-bank")
    show(window, "All")
    window.fill("#search", "robotics")
    assert window.inner_text("#sec-bank .hidden-note").startswith("1 hidden by your search")
    window.click("#sec-bank .hidden-note button")
    assert window.input_value("#search") == "" and window.locator(".bank-entry:visible").count() == 2


def test_with_nothing_to_check_the_tab_opens_on_all(files, window):
    profile, bank = files
    for question in [HEARD.label, SKILLS.label]:
        AnswerBank(bank).review(question)
    with Dashboard(0, NoFrames(), AnswersTab(AnswerBank(bank), profile)) as board:
        window.goto(board.url + "/#answers")
        entry(window, HEARD.label).wait_for()

        assert window.is_checked("[name=answers-filter][value=all]")
