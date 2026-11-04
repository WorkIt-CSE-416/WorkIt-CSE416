"""Needs you on the page (KAN-600): an answer Lisul types on the held form
himself is saved as a card's answer is, and leaves Needs you."""

import json

import pytest
import yaml
from conftest import ARC_FORM, ARC_URL
from fakes import FakeJobServer, RecordingBoard
from playwright.sync_api import sync_playwright
from test_dashboard import FakeFrames
from test_rehearse import NeverSubmits, adapters
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
