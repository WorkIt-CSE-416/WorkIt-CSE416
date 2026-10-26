"""
Question types (app/auto_apply/question_types.py, KAN-369): every written
question gets one type, its guide loads with its slots, and a form's own
length wins over the type's default. Never the guides' wording.
"""

import pytest

from app.auto_apply import question_types


def test_every_type_has_a_guide_with_slots_one_of_them_required():
    guides = question_types.load()

    assert set(guides) == {*question_types.PRIORITY, question_types.GENERAL}
    for name, guide in guides.items():
        assert guide.company_link in ("same-kind", "never"), name
        assert guide.summary and guide.body, name
        low, high = guide.length
        assert 0 < low < high, name
        assert any(s.required in (True, "asked") for s in guide.slots), name
        assert all(s.required in (True, False, "asked") for s in guide.slots), name
        assert len({s.name for s in guide.slots}) == len(guide.slots), name


@pytest.mark.parametrize(("question", "kind"), [
    ("Why do you want to work at Acme?", "why-company"),
    ("Tell us about a project you are proud of.", "best-project"),
    ("Describe a time you failed and what you learned.", "failure"),
    ("Which team would you most like to join?", "preference"),
    ("Is there anything else you'd like us to know?", "anything-else"),
    ("Cover letter", "cover-letter"),
    ("How do you use AI tools in your work?", "ai-tools"),
    ("Tell us about yourself.", "about-me"),
    ("What is your favorite color of sock?", "general"),
])
def test_a_question_gets_its_type(question, kind):
    assert question_types.classify(question) == kind


def test_a_note_banning_ai_text_says_nothing_about_the_type():
    assert question_types.classify("Why Acme? (Please do not use AI.)") == question_types.classify("Why Acme?")


def test_the_default_length_only_when_the_form_states_none():
    low, high = question_types.load()["why-company"].length

    assert question_types.default_length("Why Acme?", "why-company", None) == f"{low}-{high} words"
    assert question_types.default_length("Why Acme?", "why-company", 600) is None
    assert question_types.default_length("Why Acme? (150 words max)", "why-company", None) is None
    assert question_types.default_length("Why Acme, in a few sentences?", "why-company", None) is None


def test_a_guide_is_handed_out_with_its_slots():
    shown = question_types.load()["failure"].shown()

    assert shown["company_link"] == "never"
    assert {"name", "required", "holds"} <= set(shown["slots"][0])
    assert shown["guide"]
