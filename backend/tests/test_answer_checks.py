"""The checks every saved answer passes (app/auto_apply/checks.py, KAN-380),
as pure functions. The connector's tests (test_connector_checks.py) run
the same checks over MCP."""

from app.auto_apply.checks import Context, copied, numbers, problems

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


def test_every_problem_is_named_at_once():
    assert len(problems("I am thrilled! I grew it by 99%.", Context(limit=10))) == 3
