"""answers_from_bank: the stored bank read back as the API's shape, with no
database (schemas/autofill_answers.py)."""

from app.schemas.autofill_answers import answers_from_bank


def test_an_option_no_longer_offered_reads_as_unanswered():
    bank = {
        "needs_sponsorship": {"question_text": "...", "answer": "no"},
        "security_clearance": {"question_text": "...", "answer": "q_clearance"},
        "a_key_from_a_later_version": {"question_text": "...", "answer": "x"},
    }
    answers = answers_from_bank(bank)
    assert answers.needs_sponsorship == "no"
    assert answers.security_clearance is None
