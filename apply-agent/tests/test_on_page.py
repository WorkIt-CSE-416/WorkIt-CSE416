"""Needs you on the page (KAN-600): Go to question shows a Missing fact's
field on the held form, and an answer Lisul types there himself is saved as
a card's answer is, and leaves Needs you."""

import json
import threading
import urllib.error
import urllib.request

import pytest
import yaml
from conftest import ARC_FORM, ARC_URL
from fake_workday import EXPERIENCE_STEPS, FakeWorkdayServer
from fakes import FakeJobServer, RecordingBoard
from playwright.sync_api import sync_playwright
from test_dashboard import FakeFrames
from test_employer_accounts import XCEL_FORM, XCEL_URL
from test_rehearse import (
    NeverSubmits,
    NeverSubmittingWorkday,
    adapters,
    experience_profile,
)
from test_run_answers import profile_with

from apply import cli, essays, on_page, rehearsal
from apply.answer_bank import AnswerBank
from apply.answers_tab import AnswersTab
from apply.dashboard import Dashboard
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.model import Question
from apply.profile import ApplicantProfile
from apply.records import FolderRecords


@pytest.fixture
def page():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page()
        finally:
            browser.close()


class TypesOnThePage(RecordingBoard):
    """Lisul, on the held form: types `answer` into the field `selector`, and leaves it (Tab). The page
    closes once Apply took his answer, which ends the hold."""

    def __init__(self, selector: str, answer: str):
        super().__init__()
        self.selector, self.answer, self.typed_in, self.page = selector, answer, [], None
        self._typing = True

    def answered(self, worker):  # on the held page's own thread, each turn
        if self.page is None:
            return []
        if self._typing:
            self._typing = False
            self.page.focus(self.selector)
            self.page.keyboard.type(self.answer)
            self.page.keyboard.press("Tab")
        elif self.typed_in:
            self.page.close()
        return []


def test_an_answer_typed_on_the_held_form_is_saved_and_leaves_needs_you(monkeypatch, tmp_path):
    # Live: Lisul answered a Missing fact on the form itself, and its card stayed in Needs you.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    monkeypatch.setattr(on_page, "IDLE_S", 0.5)
    profile = profile_with(tmp_path, **{"identity.email": None})
    board = TypesOnThePage("#email", "lisul@example.com")
    ticked = on_page.Watch.tick

    def tick(self, page, questions):
        board.page = page
        return ticked(self, page, questions)
    monkeypatch.setattr(on_page.Watch, "tick", tick)
    lines = []
    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile), 1, keep_open=True, out=lines.append)

    assert board.typed_in == [(0, ["Email"], "lisul@example.com")]  # saved as a card's answer is
    assert board.captions[0]["missing"] == []  # it leaves Needs you
    assert "Missing facts: none" in board.captions[0]["line"]
    assert any("took your answer to 'Email' from the page" in line for line in lines)
    [readme] = (tmp_path / "rehearsals").glob("*/*/README.md")
    [row] = [r for r in json.loads((readme.parent / "answers.json").read_text()) if r["question"] == "Email"]
    assert row["planned"] == row["on_page"] == "lisul@example.com"  # the Record and its plan have his answer
    assert fake.submissions == []


class AsksClaude(RecordingBoard):
    """Lisul, in the tile: asks Claude to fix the held form once its fields are watched. Claude's fix changes a
    field waiting on him; the page closes a few turns later."""

    def __init__(self):
        super().__init__()
        self.page, self.ticks, self.sent, self.replies = None, 0, False, []

    def asks(self, worker):
        if self.ticks < 2 or self.sent:
            return []
        self.sent = True
        return [{"id": "ask-1", "message": "fix my email", "thread": []}]

    def replied(self, worker, ask_id, **reply):
        self.replies.append(reply)

    def answered(self, worker):
        if self.sent and self.ticks > 10:
            self.page.close()
        return []


def test_what_ask_claude_changed_on_the_held_form_is_never_taken_as_his_answer(monkeypatch, tmp_path):
    # Live (KAN-693): an `apply ask` fix on the held form was read by the Watch as Lisul typing, and its
    # values were saved to his Applicant profile as his answers to the fields still waiting on him.
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    monkeypatch.setattr(on_page, "IDLE_S", 0.5)
    profile = profile_with(tmp_path, **{"identity.email": None})
    board = AsksClaude()
    ticked = on_page.Watch.tick

    def tick(self, page, questions):
        board.page = page
        board.ticks += 1
        return ticked(self, page, questions)
    monkeypatch.setattr(on_page.Watch, "tick", tick)

    def claude_fixes(claude, page, message, *args, **kwargs):  # Claude types into the waiting field, and leaves it
        page.fill("#email", "claude@example.com")
        page.keyboard.press("Tab")
        return rehearsal.ask.Reply("Set Email.", changed=[{"field": "Email", "step": "", "shown": "claude@example.com"}])
    monkeypatch.setattr(rehearsal.ask, "ask", claude_fixes)
    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile), 1, keep_open=True, out=lambda line: None)

    assert board.sent and board.ticks > 10
    assert getattr(board, "typed_in", []) == []  # Claude's value is the page's, never his answer
    assert fake.submissions == []


FORM = """<form>
  <div class="application-question"><div class="application-label">Pronouns<span>*</span></div>
    <input type="text" name="cards[x][field0]"></div>
  <div data-automation-id="formField-degree"><label>Degree</label><button aria-haspopup="listbox">Select One</button></div>
  <section><h3>Education 1</h3><div class="field"><label>From (MM/YYYY)</label><input id="from-1"></div></section>
  <section><h3>Education 2</h3><div class="field"><label>From (MM/YYYY)</label><input id="from-2"></div></section>
  <fieldset><legend>Willing to relocate?</legend>
    <label><input type="radio" name="move" value="y"> Yes</label><label><input type="radio" name="move" value="n"> No</label>
  </fieldset>
  <div class="field"><label for="term">Term</label><select id="term"><option value="">Pick</option><option>Summer 2027</option></select></div>
</form>
<div id="apply-rehearsal-blocked"><label>Pronouns</label><input id="note-input"></div>"""


def test_a_field_is_found_by_its_label_in_its_own_section_never_in_apply_s_note(page):
    page.set_content(FORM)
    read = lambda q: on_page._in_frames(page, q, "read")

    assert read(Question("cards[x][field0]", "Pronouns", "text"))["value"] == ""
    assert read(Question("pronouns", "Pronouns", "text")) | {"value": ""} == {"found": True, "focused": False, "value": ""}
    page.fill("input[name='cards[x][field0]']", "he/him")
    assert read(Question("pronouns", "Pronouns", "text"))["value"] == "he/him"  # Lever's label is a div, not the note's

    assert on_page.go_to(page, Question("My Experience / Education 2 / From (MM/YYYY)", "Education 2 / From (MM/YYYY)", "text")) == ""
    assert page.evaluate("document.activeElement.id") == "from-2"  # the panel the name says, not the first From
    assert read(Question("Degree", "Degree", "select"))["value"] == ""  # Workday's "Select One" is no answer
    page.check("input[value=n]")
    page.select_option("#term", label="Summer 2027")
    assert read(Question("move", "Willing to relocate?", "radio"))["value"] == "No"
    assert read(Question("term", "Term", "select"))["value"] == "Summer 2027"


SECTIONS = """<form>
  <fieldset><legend>Contact</legend>
    <label for="first">First name</label><input id="first" value="Ann">
    <label for="mail">Email</label><input id="mail" value="ann@example.com">
    <label for="alt">Alternate Phone Number</label><input id="alt">
  </fieldset>
  <fieldset><legend>Eligibility</legend>
    <div>Are you legally authorized to work here?</div>
    <label><input type="radio" name="auth" value="y" checked> Yes</label><label><input type="radio" name="auth" value="n"> No</label>
    <div>Will you require sponsorship?</div>
    <label><input type="radio" name="visa" value="y"> Yes</label><label><input type="radio" name="visa" value="n" checked> No</label>
  </fieldset>
  <div class="section">
    <div><label>School</label><select id="school"><option>Pick</option><option selected>Stony Brook University</option></select></div>
    <div><label>If your school is not listed, enter it here</label><input id="other-school" style="display:none"></div>
    <div><label>Degree</label><input id="degree" value="BS"></div>
  </div>
</form>"""


def test_a_field_in_a_section_reads_only_its_own_value_never_the_section_s(page):
    # Live (KAN-693): a field whose box was its whole section read every field in it, joined with "; ", and
    # that string was saved to the Applicant profile as the answer to the one field Lisul had left blank.
    page.set_content(SECTIONS)
    read = lambda q: on_page._in_frames(page, q, "read")

    assert read(Question("alt", "Alternate Phone Number", "text"))["value"] == ""
    assert read(Question("mail", "Email", "text"))["value"] == "ann@example.com"
    assert read(Question("auth", "Are you legally authorized to work here?", "radio"))["value"] == "Yes"
    assert read(Question("visa", "Will you require sponsorship?", "radio"))["value"] == "No"
    # Its own box is hidden: the School list next to it is another field's, never this one's.
    assert read(Question("other", "If your school is not listed, enter it here", "text")).get("value", "") == ""
    page.fill("#alt", "555-0100")
    assert read(Question("alt", "Alternate Phone Number", "text"))["value"] == "555-0100"
# Microsoft Careers' contact section (live 2026-11-06): a field whose control the page script can't see (a
# dropdown drawn as a plain div, an input in a shadow root) sits among inputs labelled by divs. Going up from its
# label reached the whole section: "Alternate Phone Number" read every answer in it joined, then (KAN-693) the
# first name, another field's.
CONTACT = """<div class="section">
  <div class="field"><div class="label">Preferred First Name</div><input id="first" value="Ada"></div>
  <div class="field"><div class="label">Email</div><input id="email" value="ada@example.com"></div>
  <div class="field"><div class="label">Alternate Phone Number</div><div class="phone-host"></div></div>
  <div class="field"><div class="label">Is your legal name the same as your preferred name?</div><div class="dropdown">Select</div></div>
</div>"""


def test_a_field_with_no_control_of_its_own_never_reads_the_sections_other_answers(page):
    page.set_content(CONTACT)
    clock = [0.0]
    watch = on_page.Watch("claude", now=lambda: clock[0])
    asked = [Question("q9", "Alternate Phone Number", "text"), Question("q5", "Is your legal name the same as your preferred name?", "select")]

    assert [on_page._in_frames(page, q, "read").get("value", "") for q in asked] == ["", ""]
    assert watch.tick(page, asked) == []
    page.fill("#email", "ada@example.org")  # another field changed: never an answer to these
    clock[0] = 1 + on_page.TYPING_S
    assert watch.tick(page, asked) == []


def test_a_field_on_another_workday_step_is_named_and_nothing_moves(page):
    page.set_content(FORM)
    said = on_page.go_to(page, Question("Application Questions / Visa status", "Visa status", "text"))
    assert "'Application Questions' step" in said and "what you filled stays" in said
    assert "couldn't find" in on_page.go_to(page, Question("visa", "Visa status", "text"))


def test_typing_counts_once_he_leaves_the_field_and_rests_and_a_pick_once_it_rests(page):
    page.set_content(FORM)
    clock = [0.0]
    watch = on_page.Watch("claude", now=lambda: clock[0])
    pronouns, term = Question("pronouns", "Pronouns", "text"), Question("term", "Term", "select")
    tick = lambda: watch.tick(page, [pronouns, term])

    assert tick() == []  # what the form shows now is Apply's
    page.focus("input[name='cards[x][field0]']")
    page.keyboard.type("he/")
    page.select_option("#term", label="Summer 2027")
    page.focus("input[name='cards[x][field0]']")
    clock[0] = 1
    assert tick() == []
    clock[0] = 1 + on_page.IDLE_S
    assert tick() == [(term, "Summer 2027")]  # a pick counts once it rests, the caret anywhere
    clock[0] = 10
    assert tick() == []  # still typing in it
    page.keyboard.type("him")
    page.keyboard.press("Tab")
    clock[0] = 11
    assert tick() == []
    clock[0] = 11 + on_page.IDLE_S
    assert tick() == [(pronouns, "he/him")]  # left, and rested
    assert tick() == []  # once


def test_text_left_with_the_caret_in_it_counts_once_it_rests_long(page):
    page.set_content(FORM)
    clock = [0.0]
    watch = on_page.Watch("claude", now=lambda: clock[0])
    pronouns = Question("pronouns", "Pronouns", "text")
    watch.tick(page, [pronouns])
    page.focus("input[name='cards[x][field0]']")
    page.keyboard.type("she/her")
    clock[0] = 1
    assert watch.tick(page, [pronouns]) == []
    clock[0] = 1 + on_page.TYPING_S
    assert watch.tick(page, [pronouns]) == [(pronouns, "she/her")]


def test_a_bare_date_is_bare_and_a_dated_label_is_not():
    assert on_page.bare("From (MM/DD/YYYY)") and on_page.bare("To") and on_page.bare("Start date*")
    assert not on_page.bare("Expected graduation date") and not on_page.bare("Education 1 / From")


# The window's side: a typed answer is saved as a card's is.

def test_an_answer_typed_on_the_form_is_saved_as_a_cards_answer_and_a_bare_date_is_not(monkeypatch, tmp_path):
    profile_file = tmp_path / "applicant-profile.yaml"
    profile_file.write_text(yaml.safe_dump({"identity": {"legal_first_name": "Lisul"}}))
    story = tmp_path / "story-bank.md"
    story.write_text("# Story bank\n")
    monkeypatch.setattr(essays.data_folder, "STORY_BANK", story)
    tab = AnswersTab(AnswerBank(tmp_path / "answer-bank.yaml"), profile_file)
    ask1, ask2 = "Essay fact: what did the robot do?", "Essay fact: what did you learn?"
    with Dashboard(1, FakeFrames({}), tab, answer=cli._answering(lambda: None, tab)) as board:
        board.update(0, company="Point72", posting_url="https://p.example/1", status=rehearsal.READY,
                     missing=["Pronouns", "From (MM/DD/YYYY)", ask1, ask2])
        saved = board.typed(0, ["Pronouns"], "he/him")
        bare = board.typed(0, ["From (MM/DD/YYYY)"], "08/01/2024")
        essay = board.typed(0, [ask1, ask2], "It solved the maze, and I learned to test early.")
        [item] = board.state()["items"]

    assert saved.startswith("Saved to your facts") and bare.startswith("Kept on this form only")
    assert essay.startswith("Saved to your Story bank")
    assert item["questions"] == [] and item["answered"]  # it leaves Needs you
    answered = ApplicantProfile.load(profile_file).get("answered_questions") or {}
    assert "he/him" in json.dumps(answered) and "08/01/2024" not in json.dumps(answered)
    assert "- what did the robot do?; what did you learn? It solved the maze" in story.read_text()


def test_an_essay_facts_field_is_its_essays():
    essay = Question("q_9", "Why Point72?", "textarea")
    done = rehearsal.Rehearsed(None, rehearsal.READY, questions=(Question("q_1", "Pronouns", "text"), essay),
                               where={"Essay fact: what?": rehearsal.for_essay(essay)})
    assert rehearsal._field_of(done, "Essay fact: what?") is essay
    assert rehearsal._field_of(done, "Pronouns").name == "q_1"
    assert rehearsal._field_of(done, "Essay fact: other?") is None


# Go to question.

class PressesGoTo(RecordingBoard):
    """Lisul, in Needs you: presses Go to question for `question`, types `answer` into the field it
    focused, and leaves it (Tab). The page closes once Apply took his answer, which ends the hold."""

    def __init__(self, question: str, answer: str):
        super().__init__()
        self.question, self.answer, self.said, self.focused, self.typed_in = question, answer, [], [], []
        self._turn = 0

    def wanted(self, worker):
        if not self.captions.get(worker, {}).get("missing") and not self.typed_in:
            return []
        self._turn += 1
        if self._turn == 1:
            return [(self.question, self.said.append)]
        page = self.page
        if self._turn == 2:
            self.focused.append(page.evaluate("[document.activeElement.id, [...document.querySelectorAll('*')]"
                                              ".some((e) => e.contains(document.activeElement) && e.style.outline.includes('solid'))]"))
            page.keyboard.type(self.answer)
            page.keyboard.press("Tab")
        elif self.typed_in:
            page.close()
        return []


def test_go_to_question_focuses_the_field_and_his_answer_typed_there_leaves_needs_you(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    monkeypatch.setattr(on_page, "IDLE_S", 0.5)
    profile = profile_with(tmp_path, **{"identity.email": None})
    board = PressesGoTo("Email", "lisul@example.com")
    went = on_page.go_to

    def go_to(page, q):
        board.page = page
        return went(page, q)
    monkeypatch.setattr(on_page, "go_to", go_to)
    lines = []
    with FakeJobServer(ARC_FORM) as fake:
        rehearsal.rehearse([ARC_URL], adapters(fake, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(profile), 1, keep_open=True, out=lines.append)

    assert board.said == [""]  # the field was shown
    [(focused, outline)] = board.focused
    assert focused == "email" and outline  # focused, and outlined for a moment
    assert board.typed_in == [(0, ["Email"], "lisul@example.com")]  # saved as a card's answer is
    assert board.captions[0]["missing"] == []  # it leaves Needs you
    assert "Missing facts: none" in board.captions[0]["line"]
    assert any("took your answer to 'Email' from the page" in line for line in lines)
    [readme] = (tmp_path / "rehearsals").glob("*/*/README.md")
    [row] = [r for r in json.loads((readme.parent / "answers.json").read_text()) if r["question"] == "Email"]
    assert row["planned"] == row["on_page"] == "lisul@example.com"  # the Record and its plan have his answer
    assert fake.submissions == []


def post(board, path, body, token=None):
    request = urllib.request.Request(board.url + path, json.dumps(body).encode(), {"X-Apply-Token": token or board.token})
    try:
        with urllib.request.urlopen(request) as reply:
            return reply.status, json.loads(reply.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_go_to_question_asks_the_held_form_and_says_what_it_did(monkeypatch):
    shown = []
    with Dashboard(1, FakeFrames({}), answer=lambda *a: "Saved.", show=lambda k: shown.append(k) or False) as board:
        board.update(0, company="Point72", posting_url="https://p.example/1", status=rehearsal.READY,
                     missing=["Certifications"])
        [item] = board.state()["items"]

        def hold_loop():  # the Worker's held page, on its next turn
            for _ in range(100):
                if wanted := board.wanted(0):
                    [(question, reply)] = wanted
                    reply("" if question == "Certifications" else "no")
                    return
                threading.Event().wait(0.05)
        threading.Thread(target=hold_loop).start()
        status, said = post(board, "/goto", {"id": item["id"], "question": "Certifications"})
        refused, _ = post(board, "/goto", {"id": item["id"], "question": "Certifications"}, token="guessed")
        gone, _ = post(board, "/goto", {"id": item["id"], "question": "Pronouns"})
        board.update(0, company="Next", posting_url="https://n.example/2", status="filling")  # the Worker moved on
        closed, why = post(board, "/goto", {"id": item["id"], "question": "Certifications"})

    assert (status, said["front"], shown) == (200, False, [0])  # no window of its own: the page shows its tile
    assert said["message"].startswith("There it is")
    assert (refused, gone, closed) == (403, 404, 409) and "closed" in why["error"]


def test_go_to_question_on_a_paused_workday_step_shows_its_field(monkeypatch, tmp_path):
    # The rehearsal pauses on My Experience: Snap's degree list has no Bachelor's Degree (a Missing fact).
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    said, shown = [], []

    class Board(RecordingBoard):
        def wanted(self, worker):
            if self.captions.get(worker, {}).get("missing") and not said:
                return [("Education 1 / Degree", said.append)]
            if said and not shown:
                shown.append(page_of[0].evaluate("document.activeElement.closest('[data-automation-id^=formField]')"
                                                 " ? document.activeElement.closest('[data-automation-id^=formField]')"
                                                 ".innerText : ''"))
                page_of[0].close()
            return []
    page_of = []
    went = on_page.go_to
    monkeypatch.setattr(on_page, "go_to", lambda page, q: page_of.append(page) or went(page, q))
    world = experience_profile()
    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        rehearsal.rehearse([XCEL_URL], adapters(server, board=Board(), records=FolderRecords(tmp_path / "rehearsals")),
                           ApplicantProfile.load(world.profile), 1, keep_open=True, out=lambda line: None)

    assert said == [""] and "Degree" in shown[0]
    assert server.submissions == []


def test_only_a_question_on_a_form_held_open_has_go_to_question(page):
    with Dashboard(2, FakeFrames({}), answer=lambda *a: "Saved.", show=lambda k: True) as board:
        board.update(0, company="Point72", posting_url="https://p.example/1", status=rehearsal.READY,
                     missing=["Certifications", "Essay fact: what did the robot do?"])
        board.update(1, company="Cohere", posting_url="https://c.example/2", status="filling", missing=["Pronouns"])
        page.goto(board.url + "/#inbox")
        page.wait_for_selector(".item .ask", timeout=10_000)
        cards = page.eval_on_selector_all(".item", "cs => cs.map(c => [c.innerText.includes('Point72'), "
                                                   "c.querySelectorAll('.ask').length, c.querySelectorAll('button.goto').length])")

    assert sorted(cards, reverse=True) == [[True, 2, 2], [False, 1, 0]]  # a form still filling is Apply's to drive
