"""essay_answer.py's two pure helpers: the free, model-free fallback for a
personal/logistics question the bank could never ground, and the
section-labeled grounding text that lets the model favor the right section
for a question about a specific kind of work."""

from types import SimpleNamespace

from app.models.dto import bank_section
from app.services.bank import Bank, Entry
from app.services.essay_answer import bank_context, general_answer


def test_a_start_date_question_gets_the_fixed_answer() -> None:
    assert general_answer("What date can you start?") is not None
    assert general_answer("When can you start?") is not None


def test_a_location_preference_question_gets_the_fixed_answer() -> None:
    assert general_answer("Which top 3 locations would you want to be considered for?") is not None


def test_an_unrecognized_question_gets_none() -> None:
    assert general_answer("Why do you want to work here?") is None


def _row(**kwargs):
    defaults = {"organization": None, "field_of_study": None, "degree": None, "start_month": None,
                "end_month": None, "award_date": None, "end_kind": None}
    return SimpleNamespace(**{**defaults, **kwargs})


def test_bank_context_labels_each_entry_by_its_section() -> None:
    bank = Bank(
        entries=[
            Entry(row=_row(section=bank_section.projects, title="PennyWise"),
                  bullets=[SimpleNamespace(text="Built a budgeting app in React")]),
            Entry(row=_row(section=bank_section.experience, title="Intern", organization="Acme"),
                  bullets=[]),
        ],
        skills=[],
    )
    grounding, _ = bank_context(bank)
    assert "Projects: PennyWise" in grounding
    assert "Experience: Intern, Acme" in grounding
