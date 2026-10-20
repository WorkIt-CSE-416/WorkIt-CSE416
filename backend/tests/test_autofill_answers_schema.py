"""answers_from_bank: the stored bank read back as the API's shape, with no
database (schemas/autofill_answers.py)."""

from app.schemas.autofill_answers import answers_from_bank


def test_an_option_no_longer_offered_reads_as_unanswered():
    bank = {
        "needs_sponsorship": "no",
        "security_clearance": "q_clearance",
        "a_key_from_a_later_version": "x",
    }
    answers = answers_from_bank(bank)
    assert answers.needs_sponsorship == "no"
    assert answers.security_clearance is None


def test_an_entry_of_the_wrong_shape_reads_as_unanswered():
    # Only the PATCH route writes the bank today, always as plain answers; a
    # script, the extension or a hand fix could store a list or an object.
    bank = {
        "gender": "male",
        "veteran_status": ["declined"],
        "disability_status": {"answer": "yes"},
    }
    answers = answers_from_bank(bank)
    assert answers.gender == "male"
    assert answers.veteran_status is None
    assert answers.disability_status is None
