"""The Fill engine's loader on its own: what Apply asks of the engine with no page open."""

import json
from datetime import date

import pytest
from conftest import APPLY, FIXTURES, FORMS

from apply import fill_engine
from apply.answer_bank import AnswerBank
from apply.model import FillError, Posting, Question
from apply.profile import ApplicantProfile

PROFILE = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
POSTING = Posting("p", "Acme", "Software Engineer Intern", "https://job-boards.greenhouse.io/acme/jobs/1")


def test_the_postings_text_is_read_only_when_the_engine_asks_for_it():
    reads = []

    def posting_text():
        reads.append(1)
        return "The pay is $30 to $40 an hour."

    fill_engine.plan([Question("q1", "First Name", "text", True)], POSTING, PROFILE, posting_text=posting_text)
    assert reads == []
    pay = Question("q2", "What hourly rate do you expect?", "text", True)
    fill_engine.plan([pay], POSTING, PROFILE, posting_text=posting_text)
    assert reads == [1]


def test_a_workday_try_list_answer_is_shown_by_whichever_of_its_wordings_the_page_shows():
    # How Did You Hear About Us? is never read on Workday: it is answered with sources to search for in turn.
    posting = Posting("w", "Acme", "Intern", "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Intern_R1")
    heard = Question("q1", "How Did You Hear About Us?", "select", True)
    planned = fill_engine.plan([heard], posting, PROFILE)
    tries = planned.answers["q1"].split("|")

    assert len(tries) > 1
    assert fill_engine.readback_problems([heard], planned.answers, {"q1": tries[1].title()}, planned.accepted) == []
    assert fill_engine.readback_problems([heard], planned.answers, {"q1": "Somewhere else"}, planned.accepted)


def test_a_workday_answer_with_a_bar_that_is_no_try_list_must_show_whole(tmp_path):
    # Only the how-heard plan is a try-list; any other answer that holds a "|" is meant as it is.
    posting = Posting("w", "Acme", "Intern", "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Intern_R1")
    shell = Question("q1", "Which shell do you use?", "text", True)
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    bank.add(shell, "zsh|bash", "Acme", date(2026, 11, 2))
    planned = fill_engine.plan([shell], posting, PROFILE, bank)

    assert planned.answers["q1"] == "zsh|bash"
    assert "q1" not in planned.accepted
    assert fill_engine.readback_problems([shell], planned.answers, {"q1": "bash"}, planned.accepted)


def test_an_engine_error_comes_back_as_apply_own():
    try:
        fill_engine.call_without_page("parseQuestions", "bamboohr", "")
    except FillError as error:
        assert str(error) == "the engine has no parser for bamboohr"
    else:
        raise AssertionError("no FillError")


def test_an_essay_on_a_job_system_the_policies_name_holds_its_application():
    # The real policies name Ashby: the engine must read the Posting's link as Ashby's.
    essay = Question("q1", "Tell us about a project you are proud of.", "textarea", True)
    ashby = Posting("p", "Acme", "Intern", "https://jobs.ashbyhq.com/acme/00000000-0000-0000-0000-000000000000")
    assert fill_engine.plan([essay], ashby, PROFILE).high_stakes == [essay]


class Site:
    """A JobSite's fetch over saved answers, recording what was asked."""

    def __init__(self, answers):
        self.answers, self.asked = answers, []

    def fetch(self, url, body=None):
        self.asked.append((url, body and json.loads(body)["operationName"]))
        if url not in self.answers:
            raise LookupError(f"nothing saved at {url}")
        return self.answers[url].encode()


def test_a_jobs_question_set_and_names_are_fetched_through_the_sites_fetch():
    url = "https://jobs.ashbyhq.com/semgrep/1b1e3e7c-c19e-4cd0-9e8b-8d5c09a6d8e0/application"
    graphql = "https://jobs.ashbyhq.com/api/non-user-graphql"
    site = Site({f"{graphql}?op=ApiJobPosting": (FORMS / "ashby-semgrep" / "questions.json").read_text(),
                 f"{graphql}?op=ApiOrganizationFromHostedJobsPageName": '{"data": {"organization": {"name": "Semgrep"}}}'})

    questions = fill_engine.fetched_question_set(url, site)
    company, title = fill_engine.job_names(url, site)

    assert [q.label for q in questions][:2] == ["Name", "Email"] and company == "Semgrep" and title
    assert site.asked[0] == (f"{graphql}?op=ApiJobPosting", "ApiJobPosting")


def test_a_fetch_that_fails_raises_the_sites_own_error():
    with pytest.raises(LookupError, match="nothing saved"):
        fill_engine.job_description("https://apply.workable.com/acme/j/AB12", Site({}))


def test_a_link_the_engine_covers_names_its_job_system_and_form():
    assert fill_engine.job_of("https://explore.jobs.netflix.net/careers/job/790318904468") == {
        "site": "eightfold", "pid": "790318904468", "form": "https://explore.jobs.netflix.net/careers/apply?pid=790318904468", "onForm": False}
    assert fill_engine.job_of("https://example.com/jobs/1") is None


def test_a_host_call_may_call_the_engine_again():
    # The Posting's text is read only when the plan asks, and reading it makes text of HTML with the engine.
    pay = Question("q2", "What hourly rate do you expect?", "text", True)
    planned = fill_engine.plan([pay], POSTING, PROFILE, posting_text=lambda: fill_engine.text_of("<p>The pay is $30 to $40 an hour.</p>"))
    assert pay in planned.missing or planned.answers


def test_the_options_lisul_picked_for_a_missing_multi_select_are_each_ticked():
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
    question = Question("q1", "Which offices would you work in?", "multi_select", True, ("Austin", "Boston", "Denver"))
    fill_engine.remember(profile, POSTING, question, "Austin; Denver")  # as the Inbox joins his picks

    assert fill_engine.plan([question], POSTING, profile).answers["q1"] == ["Austin", "Denver"]


def test_a_question_keeps_the_help_text_and_limit_the_engine_reads():
    # the essay call needs them: Figma asks for "3-4 sentences" only in a description
    found = {"name": "q1", "label": "Why Figma?", "kind": "textarea", "required": True, "options": [],
             "description": "Please answer in 3-4 sentences.", "maxLength": 1500}
    [question] = fill_engine.question_set([found])
    assert (question.description, question.max_length) == ("Please answer in 3-4 sentences.", 1500)
    [bare] = fill_engine.question_set([{k: v for k, v in found.items() if k not in ("description", "maxLength")}])
    assert (bare.description, bare.max_length) == ("", None)


def engine_bundle(**env):
    """The bundle a fresh Apply process loads, with the given environment."""
    import os
    import subprocess
    import sys
    code = "from apply.fill_engine import ENGINE; print(ENGINE)"
    run = subprocess.run([sys.executable, "-c", code], env={**os.environ, **env}, capture_output=True, text=True, check=True)
    return run.stdout.strip()


def test_apply_loads_the_extensions_engine_from_the_workit_checkout():
    bundle = engine_bundle(APPLY_FILL_ENGINE="")
    assert bundle == str(APPLY.resolve().parent / "autofiller_extension" / "fill-engine" / "dist" / "engine.js")
    assert fill_engine.ENGINE.is_file()


def test_apply_fill_engine_points_apply_at_another_engine_checkout(tmp_path):
    assert engine_bundle(APPLY_FILL_ENGINE=str(tmp_path)) == str(tmp_path / "dist" / "engine.js")


def test_apply_fill_engine_may_start_at_the_home_folder(tmp_path):
    assert engine_bundle(APPLY_FILL_ENGINE="~/fill-engine", HOME=str(tmp_path)) == str(tmp_path / "fill-engine" / "dist" / "engine.js")
