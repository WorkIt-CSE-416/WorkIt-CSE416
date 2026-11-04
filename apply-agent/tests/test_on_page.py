"""Needs you on the page (KAN-600): finding a Missing fact's field on the
held form, and the rules for when an answer typed there is finished."""

import pytest
from playwright.sync_api import sync_playwright

from apply import on_page
from apply.model import Question


@pytest.fixture
def page():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page()
        finally:
            browser.close()


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
