'''
The truth-rule check (KAN-217): one pure function that drops a bullet
variant holding a number or a tool that is in neither its original bullet
nor the experience bank's skills. Tailor runs it on every variant the model
proposes and again on every variant the student approves.
'''

import pytest

from app.services.truth_rule import invented

ORIGINAL = "Wrote billing services in Python that cut invoice errors by 40%"
SKILLS = ["Docker", "PostgreSQL", "C++"]


def test_a_rewording_of_the_same_facts_passes() -> None:
    assert invented("Built Python billing services, cutting invoice errors 40%", ORIGINAL, SKILLS) == []


def test_a_new_number_is_invented() -> None:
    assert invented("Wrote Python billing services that cut invoice errors by 60%", ORIGINAL, SKILLS) == ["60"]


def test_a_number_written_with_a_thousands_comma_matches_one_without() -> None:
    assert invented("Served 1,200 users with Python", "Served 1200 users in Python", []) == []


@pytest.mark.parametrize(
    ("variant", "tool"),
    [
        ("Wrote Python billing services on Kubernetes, cutting errors 40%", "Kubernetes"),
        ("Wrote TypeScript and Python billing services", "TypeScript"),
        ("Wrote Python billing services hosted on AWS", "AWS"),
        ("Wrote Python and Node.js billing services", "Node.js"),
        ("Wrote Python and C# billing services", "C#"),
    ],
)
def test_a_tool_in_neither_the_bullet_nor_the_skills_is_invented(variant: str, tool: str) -> None:
    assert invented(variant, ORIGINAL, SKILLS) == [tool]


def test_a_tool_from_the_skills_passes_in_any_case() -> None:
    assert invented("Wrote Python billing services in docker and postgresql with C++", ORIGINAL, SKILLS) == []


def test_the_first_word_is_a_verb_not_a_tool() -> None:
    # A rewording may open with a new verb; capitalized only because it leads.
    assert invented("Engineered Python billing services that cut invoice errors by 40%", ORIGINAL, SKILLS) == []


def test_a_named_tool_counts_even_as_the_first_word() -> None:
    # The posting's keywords name the tools a variant is most tempted to add.
    assert invented("Kubernetes billing services in Python", ORIGINAL, SKILLS, tools=["Kubernetes"]) == [
        "Kubernetes"
    ]
    assert invented("Python billing services that cut errors by 40%", ORIGINAL, SKILLS, tools=["Python"]) == []


def test_go_is_not_found_inside_another_word() -> None:
    # "Go" named as a tool is not "good" or "Django" in the variant.
    assert invented("Wrote good Python billing services", ORIGINAL, SKILLS, tools=["Go"]) == []


def test_each_invented_fact_is_named_once() -> None:
    assert invented("Used Rust and Rust with 5 and 5 engineers", "Wrote code", []) == ["5", "Rust"]


def test_the_pronoun_i_is_never_a_tool_wherever_it_falls() -> None:
    # Essay generation writes first-person prose, unlike Tailor's bullets —
    # "I" is grammatically capitalized everywhere, not because it names a
    # tool, in a clause like "..., and I believe..." or "because I...".
    assert invented("I built an app, and I believe this fits the role.", "Built an app", []) == []
    assert invented("I think I can help because I know Python.", "", ["Python"]) == []


def test_a_real_single_letter_tool_is_still_invented() -> None:
    assert invented("I used R for the analysis.", "Did data work", []) == ["R"]
