"""essay_answer.py's two pure helpers: the free, model-free fallback for a
personal/logistics question the bank could never ground, and the
section-labeled grounding text that lets the model favor the right section
for a question about a specific kind of work. Plus generate() itself,
seam-1 style (workit_scout.testing.ScriptedLLM standing in for the model),
for the company-name grounding fix."""

import json
from types import SimpleNamespace

import pytest
from workit_scout.identity import Identity
from workit_scout.testing import ScriptedLLM

from app.models.dto import bank_section
from app.schemas.essay_answer import EssayAnswerRequest
from app.services.bank import Bank, Entry
from app.services.essay_answer import bank_context, general_answer, generate

pytestmark = pytest.mark.anyio


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


def _bank_with_one_project() -> Bank:
    return Bank(
        entries=[
            Entry(row=_row(section=bank_section.projects, title="PennyWise"),
                  bullets=[SimpleNamespace(text="Built a budgeting app in React")]),
        ],
        skills=[],
    )


async def test_naming_the_company_the_question_is_from_is_not_invention() -> None:
    """The real bug: prompt() tells the model which company the question is
    from, so a well-grounded answer naturally names it back — and the
    truth-rule check must agree that's not an invented fact, or every
    "why this company" answer fails with a false 422 regardless of how
    well it used the bank."""
    llm = ScriptedLLM([json.dumps({
        "answer": "I'm drawn to Globex because I built PennyWise, a budgeting app in React, "
        "and want to bring that same hands-on experience to Globex's team.",
    })])
    request = EssayAnswerRequest(question="Why do you want to work at Globex?", company_name="Globex")

    answer = await generate(llm, Identity(), request, _bank_with_one_project())

    assert answer is not None
    assert "Globex" in answer


async def test_a_company_name_the_question_was_never_from_is_still_invention() -> None:
    """Confirms the fix is scoped to the request's own company/job title,
    not a blanket allowance of any capitalized word."""
    llm = ScriptedLLM([json.dumps({
        "answer": "I'm drawn to Initech because I built PennyWise, a budgeting app in React.",
    })])
    request = EssayAnswerRequest(question="Why do you want to work at Globex?", company_name="Globex")

    answer = await generate(llm, Identity(), request, _bank_with_one_project())

    assert answer is None
