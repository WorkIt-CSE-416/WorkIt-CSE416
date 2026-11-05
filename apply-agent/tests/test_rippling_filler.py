"""Seam 2: the Rippling Filler against Rippling's saved job API answers and a fake Rippling form."""

import pytest
from conftest import FIXTURES, FORMS
from fake_rippling import FakeRipplingServer

from apply import company, request
from apply.fill_engine import plan
from apply.fillers import FILLERS
from apply.model import Handoff, Posting, Question
from apply.profile import ApplicantProfile
from apply.rippling import RipplingFiller

RIPPLING_FORM = FORMS / "rippling-rippling"
RIPPLING_URL = "https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba"
TIVE_FORM = FORMS / "rippling-tive"
TIVE_URL = "https://ats.rippling.com/tive-careers/jobs/c88ab3d3-a8e7-4639-b95b-d6c9b5290dd0"

SUMMER = "customQuestions.6ab5476a04b5920be3201cdf.a66b1a66-c374-4fde-91b4-92b33796320d"
GRADUATION = "customQuestions.6ab5476a04b5920be3201cdf.bb2d2547-3e43-4ac6-a86e-3c783e576065"
SCHOOL = "customQuestions.6ab5476a04b5920be3201cdf.8c66b335-b966-4b8a-93d7-7a858dc71dd7"
AUTHORIZATION = "customQuestions.6ab5476a04b5920be3201ce0.76bae754-0426-42f6-8c66-298e0797525c"


def test_reads_the_question_set_from_the_job_api():
    with FakeRipplingServer(RIPPLING_FORM) as server:
        questions = RipplingFiller().question_set(RIPPLING_URL, server)

    by_name = {q.name: q for q in questions}
    assert [q.name for q in questions][:10] == [
        "first_name", "last_name", "email", "pronouns", "phone_number", "location",
        "linkedin_link", "website_link", "resume", "cover_letter",
    ]
    assert by_name["first_name"] == Question("first_name", "First name", "text", True)
    assert by_name["pronouns"].kind == "select" and "He/him/his" in by_name["pronouns"].options
    assert by_name["resume"] == Question("resume", "Resume", "file", True)
    assert by_name["cover_letter"] == Question("cover_letter", "Cover letter", "file", False)
    # A knockout is a dropdown; its options as the page words them, one space apart.
    assert by_name[GRADUATION].kind == "select"
    assert by_name[GRADUATION].options == (
        "I have already graduated", "Before July 2027", "Between August 2027 - December 2027",
        "Between January 2028 - May 2028", "After June 2028",
    )
    assert by_name[SCHOOL].kind == "text" and by_name[SCHOOL].required
    assert by_name[AUTHORIZATION] == Question(
        AUTHORIZATION, "Do you require work authorization to work in the United States for this internship?",
        "select", True, ("Yes", "No"))
    # The equal-opportunity block, which the API only says is on.
    assert by_name["eeoc.gender"] == Question("eeoc.gender", "Gender", "select", False,
                                              ("Male", "Female", "Non-binary", "Choose not to disclose"))
    assert [q.name for q in questions][-5:] == [
        "eeoc.gender", "eeoc.race", "eeoc.hispanicOrLatino", "eeoc.veteranStatus", "sms_opt_in"]


def test_a_posting_without_the_equal_opportunity_block_asks_none_of_it():
    with FakeRipplingServer(TIVE_FORM) as server:
        questions = RipplingFiller().question_set(TIVE_URL, server)

    assert not [q for q in questions if q.name.startswith("eeoc.")]
    assert Question("customQuestions.6aa819dfab4e144a5f104f66.69eff8d5-abec-43d9-8fc8-7bd72fefa68d",
                    "Why are you interested to join Tive?", "text", True) in questions


def test_attaches_the_resume_first_then_fills_over_what_rippling_parsed_and_reads_back(one_pager):
    filler = RipplingFiller()
    answers = {
        "resume": one_pager,
        "first_name": "Test",
        "last_name": "Person",
        "email": "test.person@example.com",
        "pronouns": "He/him/his",  # a dropdown you can type in
        "phone_number": "+15165550199",
        "location": "Woodbury, NY, USA",  # Google's city search
        "linkedin_link": "https://www.linkedin.com/in/test-person",
        SUMMER: "Yes",  # a knockout dropdown
        GRADUATION: "Between January 2028 - May 2028",
        SCHOOL: "Stony Brook University",
        AUTHORIZATION: "No",  # radios
        "eeoc.gender": "Male",
        "eeoc.race": "Asian",
    }
    with FakeRipplingServer(RIPPLING_FORM) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        with server.open(RIPPLING_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert server.parsed == ["one-pager.pdf"]
    assert readback == {**answers, "resume": "one-pager.pdf"}
    assert server.submissions == []


TIVE = "customQuestions.6aa819dfab4e144a5f104f6"
COLLIER_FORM = FORMS / "rippling-collieraerospace"
COLLIER_URL = "https://ats.rippling.com/collieraerospace/jobs/4981b0ba-5b6f-4ebe-95c0-9d1cda036b77"
COLLIER_TRANSCRIPT = "customQuestions.6aa198d384b00403051b4501.68505601-e351-4ce6-93b9-14c82b95cace"


def test_fills_checkboxes_long_answers_and_the_employers_own_uploads(one_pager, tmp_path):
    filler = RipplingFiller()
    tive = {
        f"{TIVE}5.1e41d4c8-50c6-404f-8e2d-df1f26fcb074": "US citizen",
        f"{TIVE}6.69eff8d5-abec-43d9-8fc8-7bd72fefa68d": "Tive's trackers.",
        f"{TIVE}7.9432b0cb-aca6-415e-9ff9-d0f21296b1ef": "Yes",
        f"{TIVE}7.94f3defe-fea6-4b10-bd1c-4cacc54a3b51": "A friend\nwho works there",
        f"{TIVE}7.6ab85fa1-ab13-4f76-acb6-51cad4a9d166": ["Friend", "Former Colleague"],
    }
    transcript = tmp_path / "transcript.pdf"
    transcript.write_bytes(one_pager.read_bytes())
    collier = {"resume": one_pager, COLLIER_TRANSCRIPT: transcript}
    with FakeRipplingServer(TIVE_FORM, COLLIER_FORM) as server:
        for url, answers in ((TIVE_URL, tive), (COLLIER_URL, collier)):
            questions = filler.question_set(url, server)
            with server.open(url) as page:
                readback = filler.fill(page, questions, answers)
            assert readback == {**answers, **{n: a.name for n, a in answers.items() if hasattr(a, "name")}}


def test_a_rippling_posting_is_filled_by_the_rippling_filler():
    posting = Posting("p", "Rippling", "Intern", RIPPLING_URL)

    assert posting.job_system == "rippling"
    assert isinstance(FILLERS[posting.job_system], RipplingFiller)


def test_the_location_is_planned_as_rippling_s_city_search_names_it():
    # The page asks "Location", a search of Google's cities ("Woodbury, NY, USA").
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml")
    with FakeRipplingServer(RIPPLING_FORM) as server:
        questions = RipplingFiller().question_set(RIPPLING_URL, server)

    planned = plan(questions, Posting("p", "Rippling", "Intern", RIPPLING_URL), profile)

    assert planned.answers["location"] == "Springfield, IL, USA"


def test_a_pasted_rippling_link_is_named_and_its_posting_text_read_from_the_job_api():
    with FakeRipplingServer(TIVE_FORM) as server:
        posting, ended = request.resolve(TIVE_URL, server)
        material = company.description(posting, server)

    assert ended is None
    assert (posting.company, posting.title) == ("Tive Inc", "Software Engineer Co-op")
    assert "Tive" in material and "<p" not in material


def test_submits_the_filled_form_once_and_waits_for_rippling_to_confirm(one_pager):
    filler = RipplingFiller()
    with FakeRipplingServer(RIPPLING_FORM) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        with server.open(RIPPLING_URL) as page:
            filler.fill(page, questions, {"resume": one_pager, "first_name": "Test", SUMMER: "Yes"})
            filler.submit(page)

    [submission] = server.submissions
    assert (submission.application["first_name"], submission.application[SUMMER]) == ("Test", "Yes")


def test_a_turnstile_challenge_at_submit_is_a_handoff_and_sends_nothing(one_pager):
    filler = RipplingFiller()
    with FakeRipplingServer(RIPPLING_FORM, turnstile=True) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        with server.open(RIPPLING_URL) as page:
            filler.fill(page, questions, {"first_name": "Test"})
            with pytest.raises(Handoff, match="captcha") as handoff:
                filler.submit(page)

    assert handoff.value.bot_signal == "captcha"
    assert server.submissions == []


def test_a_field_the_page_marks_required_reads_back_blank_whatever_its_box_shows(one_pager):
    # Collier (seen live 2026-10-16): Location showed "Woodbury, NY, USA" under "This field is required".
    filler = RipplingFiller()
    answers = {"resume": one_pager, "first_name": "Test", "location": "Woodbury, NY, USA"}
    with FakeRipplingServer(RIPPLING_FORM, rejects=("location",)) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        with server.open(RIPPLING_URL) as page:
            readback = filler.fill(page, questions, answers)

    assert readback == {"resume": "one-pager.pdf", "first_name": "Test", "location": ""}


def test_waits_for_rippling_to_put_in_what_it_parsed_before_filling_over_it(one_pager):
    # Rippling's parse empties Location; put in after the city was picked, it left the field required.
    filler = RipplingFiller()
    answers = {"resume": one_pager, "first_name": "Test", "location": "Woodbury, NY, USA"}
    with FakeRipplingServer(RIPPLING_FORM, parse_settles=2000) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        with server.open(RIPPLING_URL) as page:
            readback = filler.fill(page, questions, answers)
            page.wait_for_timeout(2500)  # any parse still to come has come
            filler.submit(page)

    assert readback == {**answers, "resume": "one-pager.pdf"}
    [submission] = server.submissions
    assert submission.application["location"] == "Woodbury, NY, USA"


SMS_YES = "Yes - I consent to receiving text messages"


def test_every_rippling_form_asks_for_text_message_consent_and_lisul_gives_it(one_pager, data_folder):
    # Shown under the questions on Rippling's, Collier's and Tive's forms (seen live 2026-10-16), never in the API.
    # Lisul says yes to texts (sms_opt_in in his policies); the default is no.
    (data_folder / "policies.yaml").write_text("sms_opt_in: true\n")
    filler = RipplingFiller()
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml")
    with FakeRipplingServer(RIPPLING_FORM) as server:
        questions = filler.question_set(RIPPLING_URL, server)
        [sms] = [q for q in questions if "text message" in q.label]
        planned = plan(questions, Posting("p", "Rippling", "Intern", RIPPLING_URL), profile)
        with server.open(RIPPLING_URL) as page:
            readback = filler.fill(page, questions, {"first_name": "Test", sms.name: planned.answers[sms.name]})

    assert sms.label.startswith("Check Yes or No to indicate your agreement to receive text message updates from Rippling")
    assert (sms.kind, sms.required) == ("select", False)
    assert planned.answers[sms.name] == SMS_YES
    assert readback[sms.name] == SMS_YES
