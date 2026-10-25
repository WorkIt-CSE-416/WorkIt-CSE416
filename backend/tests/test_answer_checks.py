"""The checks every saved answer passes (app/auto_apply/checks.py, KAN-380),
as pure functions. The connector's tests (test_connector_checks.py) run
the same checks over MCP."""

import pytest

from app.auto_apply.checks import (
    Context,
    company_specific,
    copied,
    high_stakes,
    numbers,
    problems,
)

BANK = ("Software Intern", "Acme", "Cut page load time by 30%", "Python", "2025")
CLEAN = "At Acme I cut page load time by 30% in 2025. I want to do that work on your payments team."


def test_a_clean_answer_passes():
    assert problems(CLEAN, Context(sources=BANK, employers=("Globex",), limit=600)) == []


def test_machine_made_words_and_marks_are_named():
    (found,) = problems("I am passionate about this journey — it is crucial!", Context())

    for word in ('"passionate"', '"journey"', '"—"', '"crucial"', '"!"'):
        assert word in found


def test_a_run_copied_from_a_writing_sample_is_named():
    sample = "I like to take a broken thing apart until I know why it broke."
    (found,) = problems("Since I was young I like to take a broken thing apart.", Context(samples=(sample,)))

    assert '"i like to take a"' in found
    assert copied("I take broken things apart.", (sample,)) == []


def test_a_number_the_sources_dont_hold_is_named():
    (found,) = problems("I cut page load time by 45% at Acme.", Context(sources=BANK))

    assert "45" in found and "30" not in found
    assert problems("I cut it by 30%.", Context(sources=BANK)) == []


def test_numbers_are_compared_as_numbers():
    assert numbers("1,200 users and a 3.80 GPA") == {"1200", "3.8"}
    assert problems("A 3.8 GPA, 1200 users.", Context(sources=("GPA 3.80", "1,200 users"))) == []


def test_another_applications_company_is_named():
    (found,) = problems("I want to build Globex's payments team.", Context(employers=("Globex", "Initech")))

    assert '"Globex"' in found and "Initech" not in found
    # Matched as written: a company named Ramp is not "ramp up".
    assert problems("I would ramp up fast.", Context(employers=("Ramp",))) == []


def test_a_long_sentence_is_named():
    long = " ".join(["word"] * 31) + "."

    (found,) = problems(long, Context())

    assert "31 words" in found
    assert problems(" ".join(["word"] * 30) + ".", Context()) == []


def test_a_placeholder_is_named():
    (found,) = problems("My portfolio is at [insert link].", Context())

    assert '"[insert link]"' in found


def test_an_answer_over_the_forms_limit_is_named():
    (found,) = problems("x" * 101, Context(limit=100))

    assert "101 characters" in found and "at most 100" in found
    assert problems("x" * 100, Context(limit=100)) == []


@pytest.mark.parametrize(("answer", "named", "fix"), [
    # How it was written: the student's files, the posting cited to its employer, a hedge, an AI.
    ("My resume doesn't say why I chose Acme.", "My resume doesn't", "as if the student wrote it"),
    ("As an AI, I should be upfront about this.", "As an AI", "as if the student wrote it"),
    # Talk of the posting: the employer wrote it.
    ("The role requires Python, which I used at Acme.", "The role requires", "Show the work"),
    # Time counted from today: the answer is read weeks later.
    ("Last summer I cut page load time at Acme.", "Last summer", "Date it as the student's experience does"),
    # "Hence", and more than one signpost word.
    ("I cut page load time. Hence the team shipped sooner.", "Hence", '"so"'),
    ("In fact I cut page load time. Indeed the team shipped.", "In fact, Indeed", "at most one"),
    # More than 2 numbers, years aside.
    ("In 2025 I cut 3 pages by 30% for 12 users.", "3, 30, 12", "the 2 that matter most"),
    # Detail below what a recruiter follows.
    ("I packed the messages with Protobuf over UDP.", "Protobuf", "in plain words"),
    # A course credited with what the student did.
    ("My databases class taught me where to look.", "class taught", "only as one the student liked"),
])
def test_writing_that_reads_machine_made_is_refused_with_what_to_change(answer, named, fix):
    sources = (answer, "Acme")  # every number and name is the student's: only the new check speaks

    (found,) = problems(answer, Context(sources=sources))

    assert named in found and fix in found
    assert problems(CLEAN, Context(sources=BANK)) == []


def test_an_answer_about_this_company_or_beyond_the_resume_is_for_the_student_to_read_first():
    assert high_stakes("Why do you want to work at Acme?", "Acme")
    assert high_stakes("What would you build at Acme?", "Acme")
    assert high_stakes("Tell us something that is not on your resume.", "Acme")
    # Read from the question alone: a project answer that names where the student worked is not one.
    assert not high_stakes("Tell us about a project you are proud of.", "Acme")


def test_every_problem_is_named_at_once():
    assert len(problems("I am thrilled! I grew it by 99%.", Context(limit=10))) == 3


def test_an_answer_about_one_company_is_specific_to_it():
    assert company_specific("Why do you want to work here?", "I like boats.", "Acme")
    assert company_specific("What excites you about this role?", "Boats.", "Acme")
    assert company_specific("Why Acme?", "Boats.", "Acme")
    assert company_specific("Tell us about a project you are proud of.", "At Acme's hackathon I built a boat.", "Acme")
    assert not company_specific("Tell us about a project you are proud of.", "I built a boat.", "Acme")
    assert not company_specific("What is your greatest strength?", "I finish things.", None)
