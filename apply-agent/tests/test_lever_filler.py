"""Seam 2: the Lever Filler against a saved Lever form."""

import pytest
from conftest import (
    HERMEUS_FORM,
    HERMEUS_URL,
    IMMUTA_FORM,
    IMMUTA_URL,
    RHOMBUS_FORM,
    RHOMBUS_URL,
    SHIELD_AI_FORM,
    SHIELD_AI_URL,
    XCIMER_FORM,
    XCIMER_URL,
)
from fake_lever import FakeLeverServer

from apply import bot_signals
from apply.lever import LeverFiller
from apply.model import Blocked

WORK_AUTH_CARD = "cards[db60ba3f-3128-46de-8310-9d3a73d8a6c8]"
RHOMBUS_CARD = "cards[172bc91a-073a-4fe0-b995-520a2ed2e1a0]"


@pytest.fixture
def rhombus():
    with FakeLeverServer(RHOMBUS_FORM, parse_delay=0) as server:
        yield server


def test_fills_and_reads_back_a_saved_form_and_stops_before_submit(lever_server, one_pager):
    filler = LeverFiller()
    questions = filler.question_set(IMMUTA_URL, lever_server)
    answers = {
        "resume": one_pager,
        "name": "Test Person",
        "email": "test.person@example.com",
        "phone": "+1 555 010 0199",
        "location": "Columbus, OH, USA",
        "urls[LinkedIn]": "https://www.linkedin.com/in/test-person",
        f"{WORK_AUTH_CARD}[field0]": "Yes",  # authorized to work in the US
        f"{WORK_AUTH_CARD}[field1]": "No",  # needs sponsorship
        "eeo[veteran]": "I decline to self-identify for protected veteran status",
        "consent[store]": "Yes",  # data processed per the privacy policy
    }

    with lever_server.open(IMMUTA_URL) as page:
        readback = filler.fill(page, questions, answers)

    # Lever's résumé parser prefills the contact fields with what it read, so
    # the form is settled only once the parse is back; the answers must win.
    assert lever_server.parsed == [one_pager.read_bytes()]
    assert readback == {**answers, "resume": "one-pager.pdf"}
    assert lever_server.submissions == []


def test_lever_turning_the_captcha_token_down_at_the_submit_is_a_bot_block(one_pager):
    # Simbe Robotics, 2026-11-03: "There was an error verifying your application", not a confirmation timeout.
    filler = LeverFiller()
    with FakeLeverServer(IMMUTA_FORM, parse_delay=0, refuse=True) as server:
        questions = filler.question_set(IMMUTA_URL, server)
        with server.open(IMMUTA_URL) as page:
            filler.fill(page, questions, {
                "resume": one_pager, "name": "Test Person", "email": "test.person@example.com",
                "phone": "+1 555 010 0199", "location": "Columbus, OH, USA",
                f"{WORK_AUTH_CARD}[field0]": "Yes", f"{WORK_AUTH_CARD}[field1]": "No", "consent[store]": "Yes",
            })
            with pytest.raises(Blocked) as handoff:
                filler.submit(page)

    assert handoff.value.said == "There was an error verifying your application"
    assert handoff.value.bot_signal == bot_signals.BLOCKED
    assert server.submissions == []


def test_ticks_every_planned_option_of_a_multiple_select_card(rhombus):
    filler = LeverFiller()
    questions = filler.question_set(RHOMBUS_URL, rhombus)
    answers = {
        f"{RHOMBUS_CARD}[field2]": ["Backend Development", "Full-Stack Development"],  # areas of interest
        f"{RHOMBUS_CARD}[field7]": ["Yes"],  # full-time onsite in Sacramento
    }

    with rhombus.open(RHOMBUS_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_picks_the_school_from_a_university_card(rhombus):
    filler = LeverFiller()
    questions = filler.question_set(RHOMBUS_URL, rhombus)
    answers = {f"{RHOMBUS_CARD}[field0]": "Ohio State University"}

    with rhombus.open(RHOMBUS_URL) as page:
        readback = filler.fill(page, questions, answers)
        shown = page.locator(".select2-selection__rendered").first.inner_text()

    assert readback == answers
    assert shown == "Ohio State University"  # in the select2 box Lever shows, too


def test_answers_a_demographic_survey():
    survey = "surveysResponses[eaea8ee4-16c6-4561-a65e-f30bf42a0f8b][responses]"
    with FakeLeverServer(XCIMER_FORM) as xcimer:
        filler = LeverFiller()
        questions = filler.question_set(XCIMER_URL, xcimer)
        answers = {
            f"{survey}[field1]": ["Asian"],  # I identify my ethnicity as (select all that apply)
            f"{survey}[field2]": "Male",  # What gender do you identify as?
        }

        with xcimer.open(XCIMER_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_picks_the_place_by_city_and_state_however_the_country_is_spelled(rhombus):
    filler = LeverFiller()
    questions = filler.question_set(RHOMBUS_URL, rhombus)

    with rhombus.open(RHOMBUS_URL) as page:
        readback = filler.fill(page, questions, {"location": "Riverton, NY, United States"})

    assert readback == {"location": "Riverton, NY, USA"}  # as Lever names it


def test_fills_the_location_applied_for_the_self_id_signature_and_optional_cards():
    # Shield AI (seen live): these were left blank. The signature shows only once a disability status is chosen.
    degrees, groups = "cards[9ee1fad3-863a-4094-a9b7-6b69d03a5c22][field5]", "cards[f6f2afd3-61c4-4b7e-896d-5a909a7813c3][field0]"
    offices = "cards[d76a8e31-6d2d-45e7-bbab-106aae8ec955][field0]"
    with FakeLeverServer(SHIELD_AI_FORM) as shield_ai:
        filler = LeverFiller()
        questions = filler.question_set(SHIELD_AI_URL, shield_ai)
        cpp = next(q.name for q in questions if q.name.endswith("0dac5626285f][field0]"))  # C++ experience
        answers = {
            "opportunityLocationId": "Dallas, Texas",
            "eeo[disability]": "No, I do not have a disability and have not had one in the past",
            "eeo[disabilitySignature]": "Test Person",
            "eeo[disabilitySignatureDate]": "10/16/2026",
            degrees: ["I have not yet completed a degree"],
            groups: ["Robotics Club"],
            offices: "Frisco, Texas (Dallas Metro Area)",
            cpp: "C/C++ firmware for a Micromouse robot.",
        }

        with shield_ai.open(SHIELD_AI_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_picks_the_country_that_shows_a_demographic_survey_then_answers_it():
    # Hermeus (seen live): the survey stays hidden until "What is your location?" names a country, and that
    # dropdown has no name, so the survey's boxes could never be ticked.
    survey = "surveysResponses[43bf3645-8f37-4f64-90b7-5421ddb3d26f][responses]"
    with FakeLeverServer(HERMEUS_FORM) as hermeus:
        filler = LeverFiller()
        questions = filler.question_set(HERMEUS_URL, hermeus)
        [country] = [q for q in questions if q.label == "What is your location?"]
        answers = {country.name: "United States", f"{survey}[field1]": ["Asian"]}

        with hermeus.open(HERMEUS_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert "United States" in country.options
    assert readback == answers


def test_a_posting_link_without_apply_opens_the_form_page():
    # Hermeus's link (seen live) opened the job's description, which has no form.
    from apply.lever import LeverFiller
    posting = "https://jobs.lever.co/hermeus/5b08e2df-c9db-4831-aece-67d89e744796"
    assert LeverFiller().form_url(posting) == posting + "/apply"
    assert LeverFiller().form_url(posting + "/apply") == posting + "/apply"
