"""The Eightfold Filler's reading of a form, from the questions Netflix's and
Lockheed Martin's own form pages fetched (saved 2026-10-20). Its filling is
proved on the live forms by rehearsing them (apply rehearse <link>)."""

import json

import pytest
from conftest import FORMS

from apply.eightfold import EightfoldFiller, _dom_id, form_url
from apply.fill_engine import job_names, job_of
from apply.model import MoreQuestions, Posting

NETFLIX = "https://explore.jobs.netflix.net/careers/job/790318904468"
LOCKHEED = "https://lockheedmartin.eightfold.ai/careers/job/996477106402"


def read(name: str) -> tuple[EightfoldFiller, dict]:
    filler = EightfoldFiller()
    questions = filler._parse(json.loads((FORMS / f"eightfold-{name}" / "questions.json").read_text()))
    return filler, {q["questionId"]: q for q in questions}


@pytest.mark.parametrize("url", [NETFLIX, LOCKHEED, "https://explore.jobs.netflix.net/careers/apply?pid=790318904468"])
def test_netflixs_and_lockheeds_careers_sites_are_eightfold(url):
    assert Posting("x", "", "", url).job_system == "eightfold"


def test_a_careers_search_is_no_posting():
    assert Posting("x", "", "", "https://explore.jobs.netflix.net/careers?query=intern").job_system == "other"


def test_the_form_is_opened_from_the_postings_own_link():
    assert job_of(LOCKHEED)["pid"] == "996477106402"
    assert form_url(NETFLIX) == "https://explore.jobs.netflix.net/careers/apply?pid=790318904468"


def test_the_company_comes_from_the_careers_sites_host():
    class Site:
        def fetch(self, url, body=None):
            assert url == "https://explore.jobs.netflix.net/api/apply/v2/jobs/790318904468"
            return json.dumps({"name": "Software Engineer Intern - Summer 2027"}).encode()

    assert job_names(NETFLIX, Site()) == ("Netflix", "Software Engineer Intern - Summer 2027")


def test_each_field_is_found_by_its_sections_title_and_its_question_id():
    assert _dom_id("Application Questions", "QUESTION_SETUP-6-664") == "Application_Questions_QUESTION_SETUP_6_664"
    assert _dom_id("Self-ID Questions", "US_genderIdentity") == "Self_ID_Questions_US_genderIdentity"
    assert _dom_id("Resume/CV", "resume") == "Resume_CV_resume"


def test_netflixs_question_set_holds_every_field_but_those_another_answer_brings_on():
    filler, _ = read("netflix")
    asked = {q.name: q for q in filler._questions()}
    assert asked["resume"].kind == "file" and asked["resume"].required
    assert asked["US_genderIdentity"].kind == "multi_select" and "I choose not to disclose" in asked["US_genderIdentity"].options
    assert asked["QUESTION_SETUP-6-663"].options == ("2024", "2025", "2026", "2027", "2028", "2029", "2030")
    assert asked["candidate_portfolio_url"].kind == "text" and not asked["candidate_portfolio_url"].required
    assert "state" not in asked and "QUESTION_SETUP-6-665" not in asked  # State after Country; "If Other" after Other
    assert not any(name.startswith("We would like") for name in asked)  # an instruction has no field


def test_lockheeds_labels_are_its_words_without_their_markup():
    filler, _ = read("lockheed")
    labels = [q.label for q in filler._questions()]
    assert "Please sign by typing your full legal name" in labels
    assert not any("<" in label for label in labels)


def test_answering_with_other_brings_on_its_follow_up():
    filler, _ = read("netflix")
    with pytest.raises(MoreQuestions) as more:
        filler._more(None, "QUESTION_SETUP-6-666", "Other", {q.name: q.kind for q in filler._questions()})
    assert [q.name for q in more.value.questions] == ["QUESTION_SETUP-6-665"]
    assert more.value.questions[0].kind == "text"


def test_a_choice_nothing_hangs_on_brings_on_nothing():
    filler, _ = read("netflix")
    filler._more(None, "QUESTION_SETUP-6-666", "Computer Science", {q.name: q.kind for q in filler._questions()})


def test_lockheeds_source_brings_on_the_details_of_that_source_only():
    filler, _ = read("lockheed")
    with pytest.raises(MoreQuestions) as more:
        filler._more(None, "q_customSourcePrimary", "Job Board/Job Search Site",
                     {q.name: q.kind for q in filler._questions()})
    [details] = more.value.questions
    assert details.name == "q_customSourceSecondary_q_customSourcePrimary_82198"
    assert details.kind == "select" and "Handshake" in details.options


def test_a_follow_up_already_asked_is_not_asked_again():
    filler, _ = read("lockheed")
    kinds = {q.name: q.kind for q in filler._questions()} | {"q_customSourceSecondary_q_customSourcePrimary_82198": "select"}
    filler._more(None, "q_customSourcePrimary", "Job Board/Job Search Site", kinds)


def test_a_question_about_the_categories_above_carries_the_instruction_naming_them():
    # Lockheed's U.S. Persons question names its categories only in the instruction before it.
    filler, _ = read("lockheed")
    [person] = [q for q in filler._questions() if q.name == "q_customCitizenshipStatus"]
    assert person.label.startswith("Please indicate if you belong to one of the categories above:")
    assert "U.S. Citizen" in person.label
