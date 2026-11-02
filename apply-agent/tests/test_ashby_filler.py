"""Seam 2: the Ashby Filler against a saved Ashby form."""

import time
from datetime import date

import pytest
from conftest import (
    AMPLIFY_FORM,
    AMPLIFY_URL,
    APPLY,
    COHERE_FORM,
    COHERE_URL,
    FIXTURES,
    HARVEY_FORM,
    HARVEY_URL,
    PATREON_FORM,
    PATREON_URL,
    SEMGREP_FORM,
    SEMGREP_URL,
    SKYDIO_FORM,
    SKYDIO_URL,
)
from fakes import FakeJobServer

from apply import bot_signals
from apply.ashby import AshbyFiller
from apply.fill_engine import plan
from apply.model import Handoff, Posting, Question
from apply.profile import ApplicantProfile


def test_fills_and_reads_back_a_saved_form_and_stops_before_submit(ashby_server, one_pager):
    filler = AshbyFiller()
    questions = filler.question_set(SKYDIO_URL, ashby_server)
    answers = {
        "_systemfield_name": "Test Person",
        "_systemfield_email": "test.person@example.com",
        "6165f03b-05a6-4df2-be8d-7a7cda5b110c": "+1 555 010 0199",  # Phone Number
        "c844e287-5fe4-4294-9317-9f17ca09f26e": "https://www.linkedin.com/in/test-person",  # Linkedin URL
        "6740d716-7398-44bc-acc7-f6c9ab74edd5": "No",  # Prior US Government Employment? (Yes/No buttons)
        "e3b7defc-c91c-4b8a-bde2-b838f2ed0a6f": ["May 2027"],  # start month(s) (checkboxes)
        "_systemfield_eeoc_veteran_status": "I am not a protected veteran",  # radios
        "_systemfield_resume": one_pager,
    }

    with ashby_server.open(SKYDIO_URL) as page:
        readback = filler.fill(page, questions, answers)

    assert readback == {**answers, "_systemfield_resume": "one-pager.pdf"}
    assert ashby_server.submissions == []


def test_reads_the_question_set_from_the_page_when_the_query_fails():
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM) as up:
        from_query = filler.question_set(SKYDIO_URL, up)
    with FakeJobServer(SKYDIO_FORM, question_api_down=True) as down:
        from_page = filler.question_set(SKYDIO_URL, down)

    assert Question("6740d716-7398-44bc-acc7-f6c9ab74edd5", "Prior US Government Employment?", "select", True, ("Yes", "No")) in from_page
    assert from_page == from_query


NAME = "_systemfield_name"
RESUME = "_systemfield_resume"


def test_a_file_whose_save_fails_is_attached_again(one_pager):
    # Seen live on Skydio: the résumé's save returned, and the page never showed the file.
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM, failed_file_saves=1) as server:
        questions = filler.question_set(SKYDIO_URL, server)
        with server.open(SKYDIO_URL) as page:
            readback = filler.fill(page, questions, {NAME: "Test Person", RESUME: one_pager})

    assert readback == {NAME: "Test Person", RESUME: "one-pager.pdf"}


def test_a_file_save_that_never_answers_is_attached_again(monkeypatch, one_pager):
    # Seen live on Abridge: the save got no response and the fill died of the timeout.
    monkeypatch.setattr("apply.ashby.UPLOAD_WAIT", 1_000)
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM, dropped_file_saves=1) as server:
        questions = filler.question_set(SKYDIO_URL, server)
        with server.open(SKYDIO_URL) as page:
            readback = filler.fill(page, questions, {NAME: "Test Person", RESUME: one_pager})

    assert readback == {NAME: "Test Person", RESUME: "one-pager.pdf"}


def test_a_file_whose_save_never_answers_reads_blank_and_the_fill_goes_on(monkeypatch, one_pager):
    monkeypatch.setattr("apply.ashby.UPLOAD_WAIT", 500)
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM, dropped_file_saves=99) as server:
        questions = filler.question_set(SKYDIO_URL, server)
        with server.open(SKYDIO_URL) as page:
            readback = filler.fill(page, questions, {RESUME: one_pager, NAME: "Test Person"})

    assert readback == {RESUME: "", NAME: "Test Person"}


def test_a_field_that_cant_be_read_back_reads_blank_and_the_fill_goes_on(one_pager):
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM, failed_file_saves=99) as server:
        questions = filler.question_set(SKYDIO_URL, server)
        with server.open(SKYDIO_URL) as page:
            readback = filler.fill(page, questions, {RESUME: one_pager, NAME: "Test Person"})

    assert readback == {RESUME: "", NAME: "Test Person"}


LOCATION = "_systemfield_location"
GRADUATION = "c00a8060-196c-47a4-95fd-2a7b923f8e92"


def test_a_phone_label_ends_with_the_format_its_description_gives():
    # Amplify: "please enter your number in format (###-###-####)" under Mobile Number (live, 2026-10-21).
    filler = AshbyFiller()
    with FakeJobServer(AMPLIFY_FORM) as up:
        from_query = filler.question_set(AMPLIFY_URL, up)
    with FakeJobServer(AMPLIFY_FORM, question_api_down=True) as down:
        from_page = filler.question_set(AMPLIFY_URL, down)

    mobile = "4577859f-91a5-4418-b401-4c03382b6c90"
    assert [q.label for q in from_query if q.name == mobile] == ["Mobile Number (###-###-####)"]
    assert [q.label for q in from_page if q.name == mobile] == ["Mobile Number (###-###-####)"]


def test_reads_every_field_harvey_asks_its_location_and_date_too():
    # Harvey's form asks 22 questions, all required; the Question set held 20 (2026-10-16).
    filler = AshbyFiller()
    with FakeJobServer(HARVEY_FORM) as up:
        from_query = filler.question_set(HARVEY_URL, up)
    with FakeJobServer(HARVEY_FORM, question_api_down=True) as down:
        from_page = filler.question_set(HARVEY_URL, down)

    assert len(from_query) == 22 and all(q.required for q in from_query)
    assert Question(LOCATION, "Current Location", "text", True) in from_query
    assert Question(GRADUATION, "Graduation Date (YYYY-MM-DD)", "text", True) in from_query
    assert from_page == from_query


def test_picks_a_place_from_ashby_s_search_and_types_a_date(one_pager):
    filler = AshbyFiller()
    answers = {LOCATION: "Riverton, New York, United States", GRADUATION: "2028-05-01", NAME: "Test Person"}
    with FakeJobServer(HARVEY_FORM) as server:
        questions = filler.question_set(HARVEY_URL, server)
        with server.open(HARVEY_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert readback == answers


def test_harvey_s_location_and_graduation_date_are_planned_as_ashby_takes_them():
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
    with FakeJobServer(HARVEY_FORM) as server:
        questions = AshbyFiller().question_set(HARVEY_URL, server)

    planned = plan(questions, Posting("p", "Harvey", "Intern", HARVEY_URL), profile)

    assert planned.answers[LOCATION] == "Springfield, Illinois, United States"  # as Ashby's place search names it
    assert planned.answers[GRADUATION] == "2028-05-01"  # the graduation month's first day


def test_names_the_required_fields_on_the_page_the_question_set_lacks():
    filler = AshbyFiller()
    with FakeJobServer(HARVEY_FORM) as server:
        questions = filler.question_set(HARVEY_URL, server)
        with server.open(HARVEY_URL) as page:
            filler.fill(page, questions, {})
            full = filler.unasked(page, questions)
            short = filler.unasked(page, [q for q in questions if q.name not in (LOCATION, GRADUATION)])

    assert full == []
    assert short == ["Current Location", "Graduation Date"]


UNAVAILABLE = "Application submission is unavailable at this time, please try again later."


def test_a_form_ashby_wont_serve_is_a_handoff_in_its_words_not_a_timeout(one_pager):
    # Seen live on Base Power and Cohere (2026-10-19): the notice stood where the form should be.
    filler = AshbyFiller()
    with FakeJobServer(SKYDIO_FORM) as up:
        questions = filler.question_set(SKYDIO_URL, up)
    with FakeJobServer(SKYDIO_FORM, unavailable=True) as server:
        with server.open(SKYDIO_URL) as page, pytest.raises(Handoff) as handoff:
            filler.fill(page, questions, {NAME: "Test Person", RESUME: one_pager})

    assert str(handoff.value) == f"Ashby showed no form: {UNAVAILABLE}"
    assert handoff.value.bot_signal == bot_signals.REFUSED


def test_reading_the_question_set_from_a_form_ashby_wont_serve_is_a_handoff():
    with FakeJobServer(SKYDIO_FORM, question_api_down=True, unavailable=True) as server:
        with pytest.raises(Handoff, match="Ashby showed no form"):
            AshbyFiller().question_set(SKYDIO_URL, server)


def test_a_choice_among_many_options_is_searched_for_and_reads_back():
    # Cohere (seen live, 2026-10-19): the options sit behind a search box, and
    # the readback looked only for buttons and radios, so it showed blank.
    heard = "0897a4c2-be15-448a-9e61-68df833e84fe"  # How did you hear about this role?
    filler = AshbyFiller()
    with FakeJobServer(COHERE_FORM) as server:
        questions = filler.question_set(COHERE_URL, server)
        assert next(q for q in questions if q.name == heard).kind == "select"
        with server.open(COHERE_URL) as page:
            readback = filler.fill(page, questions, {heard: "LinkedIn"})

    assert readback == {heard: "LinkedIn"}
    assert server.submissions == []


def test_a_texts_consent_under_the_phone_field_is_asked_and_lisul_gives_it(data_folder):
    # Patreon (seen live, 2026-10-20): Ashby puts the consent's radios under
    # Phone, not among the form's fields, so it was never asked or ticked.
    # Lisul says yes to texts (sms_opt_in in his policies); the default is no.
    (data_folder / "policies.yaml").write_text("sms_opt_in: true\n")
    filler = AshbyFiller()
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml")
    with FakeJobServer(PATREON_FORM) as server:
        questions = filler.question_set(PATREON_URL, server)
        [sms] = [q for q in questions if "text message" in q.label]
        planned = plan(questions, Posting("p", "Patreon", "Intern", PATREON_URL), profile)
        with server.open(PATREON_URL) as page:
            readback = filler.fill(page, questions, {sms.name: planned.answers[sms.name]})

    assert sms.label.startswith("Check Yes or No to indicate your agreement to receive text message updates from Patreon")
    assert (sms.kind, sms.required) == ("select", False)
    assert planned.answers[sms.name] == "Yes - I consent to receiving text messages"
    assert readback == {sms.name: "Yes - I consent to receiving text messages"}
    assert server.submissions == []


def test_the_texts_consent_saves_nothing_so_its_fill_waits_for_no_save():
    # The consent goes with the submit, not in a save: waiting for one cost 1.5 s.
    filler = AshbyFiller()
    with FakeJobServer(PATREON_FORM) as server:
        questions = filler.question_set(PATREON_URL, server)
        [sms] = [q for q in questions if "text message" in q.label]
        with server.open(PATREON_URL) as page:
            saves = _saves_in_flight(page)
            started = time.monotonic()
            readback = filler.fill(page, questions, {sms.name: sms.options[0]})
            seconds = time.monotonic() - started

    assert readback == {sms.name: sms.options[0]}
    assert saves == []
    assert seconds < 1.0, f"{seconds:.1f} s"


def test_semgrep_s_start_days_are_answered_from_his_term_and_filled():
    # Semgrep (seen live, 2026-10-20): left blank as a Missing fact.
    filler = AshbyFiller()
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
    with FakeJobServer(SEMGREP_FORM) as server:
        questions = filler.question_set(SEMGREP_URL, server)
        [start] = [q for q in questions if q.label.startswith("Are you available to start on either")]
        planned = plan(questions, Posting("p", "Semgrep", "Intern", SEMGREP_URL), profile)
        with server.open(SEMGREP_URL) as page:
            readback = filler.fill(page, questions, {start.name: planned.answers[start.name]})

    assert start not in planned.missing
    assert readback == {start.name: "Yes"}
    assert server.submissions == []


def _saves_in_flight(page) -> list[int]:
    """How many of Ashby's answer saves are in flight as each one is sent."""
    flying, counts = [0], []
    def sent(request):
        if "op=ApiSetFormValue" in request.url:
            flying[0] += 1
            counts.append(flying[0])
    def done(request):
        if "op=ApiSetFormValue" in request.url:
            flying[0] -= 1
    page.on("request", sent)
    page.on("requestfinished", done)
    page.on("requestfailed", done)
    return counts


def test_each_answer_is_saved_before_the_next_is_entered(one_pager):
    # Whatnot (seen live, 2026-10-20): saves sent while others were in flight
    # left answers off Ashby's saved form, though the page showed them, and
    # its submit said "Missing entry for required field" for six of them.
    filler = AshbyFiller()
    with FakeJobServer(SEMGREP_FORM) as server:
        questions = filler.question_set(SEMGREP_URL, server)
        answers = {q.name: v for q, v in [
            (questions[0], "Test Person"), (questions[1], "test.person@example.com"), (questions[2], one_pager),
            (questions[3], "+1 555 010 0199"), (questions[5], "https://www.linkedin.com/in/test-person"),
            (questions[6], "https://example.com"), (questions[7], "2028"), (questions[8], "Yes"), (questions[9], "No"),
            (questions[10], "Because."), (questions[11], "Careers page"), (questions[12], "Yes")]}
        with server.open(SEMGREP_URL) as page:
            in_flight = _saves_in_flight(page)
            readback = filler.fill(page, questions, answers)

    assert max(in_flight) == 1, in_flight
    assert readback == {**answers, questions[2].name: "one-pager.pdf"}


def test_an_answer_ashby_s_saved_form_lacks_reads_back_blank():
    # Whatnot (seen live, 2026-10-20): the page showed answers Ashby had not
    # saved, so the readback passed and only Lisul's own submit found them.
    filler = AshbyFiller()
    linkedin = "question_9925006007"
    with FakeJobServer(SEMGREP_FORM, lost_saves=(linkedin,)) as server:
        questions = filler.question_set(SEMGREP_URL, server)
        assert any(q.name == linkedin for q in questions)
        with server.open(SEMGREP_URL) as page:
            readback = filler.fill(page, questions, {NAME: "Test Person", linkedin: "https://www.linkedin.com/in/test"})

    assert readback == {NAME: "Test Person", linkedin: ""}


EDUCATION = "_systemfield_education_history"
SCHOOL, DEGREE, MAJOR = f"{EDUCATION}-school", f"{EDUCATION}-degree", f"{EDUCATION}-major"
START, END, STILL = f"{EDUCATION}-startDate", f"{EDUCATION}-endDate", f"{EDUCATION}-isCurrent"


def _amplify_plan():
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
    with FakeJobServer(AMPLIFY_FORM) as server:
        questions = AshbyFiller().question_set(AMPLIFY_URL, server)
    return questions, plan(questions, Posting("p", "Amplify", "Intern", AMPLIFY_URL), profile, today=date(2026, 10, 21))


def test_amplify_s_education_history_is_asked_as_one_entry_and_planned_from_the_profile():
    # Amplify (seen live, 2026-10-21): the required Education History was never
    # in the Question set, so it was left empty.
    questions, planned = _amplify_plan()
    asked = {q.name: q for q in questions}

    assert asked[SCHOOL] == Question(SCHOOL, "Education 1 / School", "text", True)
    assert [asked[n].label for n in (DEGREE, MAJOR, STILL)] == [
        "Education 1 / Degree", "Education 1 / Field of Study", "Education 1 / Still Student?"]
    assert asked[END].label == f"Education 1 / End Date, up to December {date.today().year + 1} (MM/YYYY)"
    assert planned.answers[SCHOOL] == "Example State University"
    assert planned.answers[DEGREE] == "Bachelor's Degree"
    assert planned.answers[MAJOR] == "Computer Science"
    assert planned.answers[STILL] == "Yes"
    assert END not in planned.answers  # May 2028 isn't offered; "Still Student?" says it instead
    assert not {SCHOOL, DEGREE, MAJOR, START, END, STILL} & {q.name for q in planned.missing + planned.drafts}


def test_amplify_s_education_history_is_filled_and_reads_back():
    filler = AshbyFiller()
    answers = {SCHOOL: "Example State University", DEGREE: "Bachelor's Degree", MAJOR: "Computer Science",
               START: "08/2024", STILL: "Yes"}
    with FakeJobServer(AMPLIFY_FORM) as server:
        questions = filler.question_set(AMPLIFY_URL, server)
        with server.open(AMPLIFY_URL) as page:
            readback = filler.fill(page, questions, answers)
            unasked = filler.unasked(page, questions)

    assert readback == answers
    assert unasked == []
    assert server.submissions == []


ALIGNS = "35818646-fe1e-4ba2-81c5-b4d081da546a"  # Does the posted salary or hourly pay range align with your expectations?
DESIRED = "65f4f03d-1210-4334-bf9f-20eff0468280"  # If the posted salary or hourly range does not align ..., your desired range
AGREEMENTS = "c95a5ece-7fdf-4d3a-b36a-b26f4826c383"  # If 'Yes' was your response to the previous question, ... agreement(s).


def test_amplify_s_pay_question_and_the_follow_ups_his_answers_dont_call_for():
    # Amplify (seen live, 2026-10-21): the pay Yes/No and two follow-ups to
    # questions answered No were held as Missing facts, and the follow-up for
    # a range that doesn't align got "30".
    _, planned = _amplify_plan()
    unanswered = {q.name for q in planned.missing + planned.drafts + planned.essays}

    assert planned.answers[ALIGNS] == "Yes"
    # "If a contingent worker" follows a question Claude drafts: test_run_answers covers it.
    assert not {DESIRED, AGREEMENTS} & (unanswered | set(planned.answers))


START_DAY = "119febc7-92e6-42f1-b845-cd6ef235997f"  # What is your earliest preferred start date if hired?


def test_amplify_s_whole_form_fills_in_seconds_one_save_at_a_time(one_pager):
    # Amplify (seen live, 2026-10-21): each answer waited 1.5 s for a save
    # after its own had already landed, so its 43 fields took minutes.
    questions, planned = _amplify_plan()
    answers = {**planned.answers, RESUME: one_pager, LOCATION: "Riverton, New York, United States",
               SCHOOL: "Example State University", START_DAY: "2027-05-24"}  # as the saved form's searches offer
    answers = {q.name: answers[q.name] for q in questions if q.name in answers}
    filler = AshbyFiller()
    with FakeJobServer(AMPLIFY_FORM) as server, server.open(AMPLIFY_URL) as page:
        in_flight = _saves_in_flight(page)
        started = time.monotonic()
        readback = filler.fill(page, questions, answers)
        seconds = time.monotonic() - started

    assert readback == {**answers, RESUME: "one-pager.pdf"}
    assert max(in_flight) == 1, in_flight
    assert len(answers) >= 25 and seconds < 0.3 * len(answers), f"{seconds:.1f} s for {len(answers)} answers"
