"""The Pre-submit check's readback comparison and Claude's review prompt, on their own."""

import json
import re

import pytest

from apply import fill_engine
from apply.fill_engine import readback_problems
from apply.model import Posting, Question
from apply.presubmit import replan, review

INTERESTS = Question("cards[a][field0]", "Areas of interest", "multi_select",
                     options=("Embedded Development", "Full-Stack Development", "Machine Learning"))


def test_a_multi_select_ticked_as_meant_passes_whatever_order_the_page_lists_it_in():
    meant = {INTERESTS.name: ["Embedded Development", "Full-Stack Development"]}
    shown = {INTERESTS.name: ["Full-Stack Development", "Embedded Development"]}

    assert readback_problems([INTERESTS], meant, shown) == []


def test_a_multi_select_missing_a_tick_is_a_problem():
    meant = {INTERESTS.name: ["Embedded Development", "Full-Stack Development"]}
    shown = {INTERESTS.name: ["Full-Stack Development"]}

    [problem] = readback_problems([INTERESTS], meant, shown)
    assert problem.startswith("Areas of interest: meant")


MAJOR = Question("My Experience / Education 1 / Field of Study", "Education 1 / Field of Study", "select", True)
ACCEPTED = {MAJOR.name: ("Computer Sciences", "Computer and Information Science")}


def test_a_wording_lisul_accepts_for_the_answer_passes():
    # AmFam's Workday search for Computer Science offered only its own wording (seen live).
    meant = {MAJOR.name: "Computer Science"}
    shown = {MAJOR.name: "Computer and Information Science"}

    assert readback_problems([MAJOR], meant, shown, ACCEPTED) == []


def test_another_wording_is_still_a_problem():
    meant = {MAJOR.name: "Computer Science"}
    shown = {MAJOR.name: "Business Management Science and Computer System"}

    assert readback_problems([MAJOR], meant, shown, ACCEPTED) == [
        "Education 1 / Field of Study: meant 'Computer Science', page shows 'Business Management Science and Computer System'"]


def test_a_replan_leaves_an_answer_shown_in_a_wording_lisul_accepts():
    class Replanning:
        def __init__(self):
            self.prompts = []

        def ask(self, model, system, prompt, schema):
            self.prompts.append(prompt)
            return {"replanned": {"q2": {"answer": "Yes"}}}

    claude = Replanning()
    authorized = Question("auth", "Are you authorized to work in the US?", "select", True, ("Yes", "No"))
    meant = {MAJOR.name: "Computer Science", authorized.name: "Yes"}
    shown = {MAJOR.name: "Computer and Information Science", authorized.name: ""}

    assert replan(claude, [MAJOR, authorized], meant, shown, ACCEPTED) == meant
    [prompt] = claude.prompts
    assert "Field of Study" not in prompt


class RecordingClaude:
    def __init__(self):
        self.prompts = []
        self.systems = []

    def ask(self, model, system, prompt, schema):
        self.prompts.append(prompt)
        self.systems.append(system)
        return {"problems": []}


def test_review_sees_the_options_so_a_range_answer_is_not_called_wrong():
    # Rhombus: the GPA question offers only ranges, and the review called "3.6 - 4.0" not a GPA.
    gpa = Question("gpa", "What is your GPA?", "select", options=("Below 3.0", "3.0 - 3.59", "3.6 - 4.0"))
    school = Question("school", "Which university?", "select", options=tuple(f"College {n}" for n in range(500)))
    claude = RecordingClaude()

    review(claude, Posting("r", "Rhombus", "Intern", "https://jobs.lever.co/r/1"), [gpa, school],
           {"gpa": "3.6 - 4.0", "school": "College 7"})

    rows = json.loads(re.search(r"<form>(.*)</form>", claude.prompts[0], re.DOTALL).group(1))
    assert rows == [{"question": "What is your GPA?", "answer": "3.6 - 4.0", "options": ["Below 3.0", "3.0 - 3.59", "3.6 - 4.0"]},
                    {"question": "Which university?", "answer": "College 7"}]



def test_review_is_shown_the_boxes_ticked_apart_from_the_options_offered():
    # Palantir (seen live): with its long language list, the review read the ticked boxes as the options
    # and called "Other" unticked.
    languages = Question("lang", "Language Skill(s) (Check all that apply)", "multi_select",
                         options=tuple(f"Language {n}" for n in range(33)) + ("English (ENG)", "Spanish (SPA)", "Other"))
    claude = RecordingClaude()

    review(claude, Posting("p", "Palantir", "Intern", "https://jobs.lever.co/p/1"), [languages],
           {"lang": ["English (ENG)", "Spanish (SPA)", "Other"]})

    rows = json.loads(re.search(r"<form>(.*)</form>", claude.prompts[0], re.DOTALL).group(1))
    assert rows == [{"question": "Language Skill(s) (Check all that apply)", "ticked": ["English (ENG)", "Spanish (SPA)", "Other"]}]


def test_an_agreement_picked_from_options_is_shown_to_the_review_though_it_mentions_secrets():
    # CesiumAstro (seen live): the review saw "(secret)" for a picked agreement and called it wrong.
    agreement = Question("nda", "Confidentiality agreement: you must protect Proprietary Information and trade secrets.",
                         "select", options=("I agree with the above obligations.",))
    password = Question("pw", "Create a password", "text")
    claude = RecordingClaude()

    review(claude, Posting("c", "CesiumAstro", "Intern", "https://jobs.lever.co/c/1"), [agreement, password],
           {"nda": "I agree with the above obligations.", "pw": "hunter2"})

    rows = json.loads(re.search(r"<form>(.*)</form>", claude.prompts[0], re.DOTALL).group(1))
    assert [row["answer"] for row in rows] == ["I agree with the above obligations.", "(secret)"]


def test_review_is_told_a_yes_to_an_either_or_question_is_right_when_one_branch_is():
    # Scout: "commute to Boulder, or open to relocating?" offers only Yes/No, and the review called Yes wrong.
    question = Question("commute", "Are you able to commute to our Boulder office? If not, are you open to relocating?",
                        "select", options=("Yes", "No"))
    claude = RecordingClaude()

    review(claude, Posting("s", "Scout Clean Energy", "Intern", "https://apply.workable.com/s/j/1"), [question],
           {"commute": "Yes"})

    assert "either/or" in claude.systems[0] and "Yes when either part is true" in claude.systems[0]


@pytest.mark.parametrize("meant, shown, same", [
    ("10/16/2026", "2026-10-16", True),  # Tyler's (Jobvite, seen live): a date field reads back as ISO
    ("2028-05-21", "05/21/2028", True),
    ("10/16/2026", "2026-10-17", False),
    ("05/2028", "2028-05-01", False),  # a month is not a day
])
def test_a_date_shown_in_another_format_is_the_same_date(meant, shown, same):
    assert fill_engine.shows(shown, meant) is same


@pytest.mark.parametrize("meant, shown, same", [
    ("+15550100199", "+1 555-010-0199", True),  # Anduril's (Greenhouse, seen live): the phone field formats as typed
    ("+1 555-010-0199", "(555) 010-0199", False),  # the country code is part of the number
    ("+15550100199", "+15165324676", False),
    ("2028", "20-28", False),  # only a phone number's worth of digits
])
def test_a_phone_number_shown_in_another_format_is_the_same_number(meant, shown, same):
    assert fill_engine.shows(shown, meant) is same


@pytest.mark.parametrize("meant, shown, same", [
    ("$30/hr", "30", True),  # Axiom's salary (Workday, seen live): a number field keeps only the number
    ("$60,000", "60000", True),
    ("$30/hr", "31", False),
    ("$25-30/hr", "25", False),  # a range is more than its first number
])
def test_a_number_field_showing_the_answers_one_number_shows_the_answer(meant, shown, same):
    assert fill_engine.shows(shown, meant) is same


class FindsSomeFine(RecordingClaude):
    def __init__(self, answer):
        super().__init__()
        self.answer, self.schemas = answer, []

    def ask(self, model, system, prompt, schema):
        super().ask(model, system, prompt, schema)
        self.schemas.append(schema)
        return self.answer


def test_answers_the_review_checked_and_found_right_are_no_problems():
    # Point72 (seen live): "consistent with each other - no problem found" came back as a problem, and held the form.
    race = Question("race", "Ethnicity/Race", "select", options=("Asian", "White"))
    claude = FindsSomeFine({"problems": ["Ethnicity/Race: says Asian, but Hispanic/Latinx says Yes"],
                            "fine": ["Ethnicity/Race and Hispanic/Latinx are consistent - no problem found"]})

    found = review(claude, Posting("p", "Point72", "Intern", "https://boards.greenhouse.io/point72/jobs/1"), [race],
                   {"race": "Asian"})

    assert found == ["Ethnicity/Race: says Asian, but Hispanic/Latinx says Yes"]
    assert "fine" in claude.schemas[0]["properties"]


def test_review_is_told_an_answer_it_cannot_check_or_a_profile_fact_is_no_problem():
    # Point72 and xAI (seen live): "no profile is provided to verify this" and an SAT score were called problems.
    sat = Question("sat", "SAT Score", "text")
    claude = RecordingClaude()

    review(claude, Posting("x", "xAI", "Intern", "https://job-boards.greenhouse.io/xai/jobs/1"), [sat], {"sat": "1400"})

    system = claude.systems[0]
    assert "nothing given lets you check" in system and "test scores" in system


def test_review_is_told_the_terms_he_can_intern_are_a_profile_fact():
    # Cloudflare (seen live): Winter/Spring 2027, one of his available terms, was called a term he never named.
    terms = Question("terms", "Which term(s) are you available to intern?", "multi_select",
                     options=("Winter/Spring (January - May 2027)", "Summer (May - September 2027)"))
    claude = RecordingClaude()

    review(claude, Posting("c", "Cloudflare", "Intern", "https://boards.greenhouse.io/cloudflare/jobs/1"), [terms],
           {"terms": ["Winter/Spring (January - May 2027)", "Summer (May - September 2027)"]})

    assert "terms they can intern" in claude.systems[0]


def test_review_is_told_a_yes_to_either_of_two_days_is_right_when_one_is():
    # Semgrep (seen live, 2026-10-20): "start on either May 25th, 2026 or June 8th, 2027?" answered Yes was
    # called wrong for the 2026 day.
    question = Question("start", "Are you available to start on either Tuesday, May 25th, 2026 or Tuesday, June 8th, "
                        "2027?", "select", options=("Yes", "No"))
    claude = RecordingClaude()

    review(claude, Posting("s", "Semgrep", "Intern", "https://jobs.ashbyhq.com/semgrep/1"), [question], {"start": "Yes"})

    assert "start on either of two days" in claude.systems[0]


def test_review_is_told_which_answers_are_lisuls_own():
    # Semgrep (seen live, 2026-10-20): his own answer to its bot check was called a fact none of the sources hold.
    question = Question("left", "What is currently to the immediate left of your computer?", "text")
    claude = RecordingClaude()

    review(claude, Posting("s", "Semgrep", "Intern", "https://jobs.ashbyhq.com/semgrep/1"), [question],
           {"left": "My water bottle and my wallet"}, own={"left"})

    rows = json.loads(re.search(r"<form>(.*)</form>", claude.prompts[0], re.DOTALL).group(1))
    assert rows == [{"question": "What is currently to the immediate left of your computer?",
                     "answer": "My water bottle and my wallet", "his_own_answer": True}]
    assert "his_own_answer" in claude.systems[0]


def test_the_review_gives_the_right_answer_for_a_wrong_one_the_sources_answer():
    # Arrowstreet (live, 2026-11-04): the review named the school start for a From filled with the internship's,
    # but only as a banner. Its fix now comes back by the question, for the Worker to fill.
    start = Question("from", "From (MM/DD/YYYY)", "text", True)
    gpa = Question("gpa", "Overall GPA", "text", True)
    claude = FindsSomeFine({"problems": ["'From (MM/DD/YYYY)': 05/26/2027 is the internship start date"], "fine": [],
                            "fixes": [{"question": "'From (MM/DD/YYYY)'", "answer": "08/01/2024"},
                                      {"question": "A question not on the form", "answer": "Yes"},
                                      {"question": "Overall GPA", "answer": ""}]})

    found = review(claude, Posting("a", "Arrowstreet Capital", "Intern", "https://arrowstreetcapital.wd5.myworkdayjobs.com/x"),
                   [start, gpa], {"from": "05/26/2027", "gpa": "3.86"})

    assert found == ["'From (MM/DD/YYYY)': 05/26/2027 is the internship start date"]
    assert found.fixes == {"From (MM/DD/YYYY)": "08/01/2024"}
    assert "fixes" in claude.schemas[0]["properties"] and "fixes" in claude.systems[0]


def test_a_fix_with_no_problem_is_no_fix():
    start = Question("from", "From (MM/DD/YYYY)", "text", True)
    claude = FindsSomeFine({"problems": [], "fine": [], "fixes": [{"question": "From (MM/DD/YYYY)", "answer": "08/01/2024"}]})

    found = review(claude, Posting("a", "Acme", "Intern", "https://boards.greenhouse.io/acme/jobs/1"), [start], {"from": "08/01/2024"})

    assert found == [] and found.fixes == {}
