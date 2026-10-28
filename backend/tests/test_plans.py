"""
The Essay plan's checks (app/auto_apply/plans.py, KAN-369): a quote must be
word for word in the student's sources, a required slot needs one, an
optional one without is dropped, a story leads one answer per application,
and the company fact is the brief's. Pure: no database.
"""

from app.auto_apply import plans

EXPERIENCE = "Software Intern, Acme\n- Cut page load time by 30%\n- Wrote the billing service's tests"
FACT = "Initech launched Ledger in 37 countries."
SOURCES = plans.Sources(
    held=plans.fold(f"{EXPERIENCE}\nPython\nInitech builds payments software.\n{FACT}"),
    experience=plans.fold(EXPERIENCE),
    facts={plans.fold(FACT)},
)


def _plan(kind="general", story="", fact="", **slots) -> plans.Plan:
    return plans.Plan(kind, story, fact, "An angle.",
                      tuple(plans.Backed(name.replace("_", "-"), tuple(quotes)) for name, quotes in slots.items()))


def test_a_plan_whose_quotes_are_in_the_sources_passes_and_is_kept():
    kept, found = plans.check(_plan(answer=["cut page load time by 30%"], episode=["Wrote the billing service’s tests"]),
                              SOURCES)

    assert found == []
    assert [b.slot for b in kept.slots] == ["answer", "episode"]


def test_a_quote_not_in_the_sources_is_refused():
    _, found = plans.check(_plan(answer=["Cut page load time by 45%"], episode=["Wrote the billing service's tests"]),
                           SOURCES)

    assert len(found) == 1 and "answer" in found[0] and "45%" in found[0]


def test_a_quote_too_short_to_back_a_slot_is_refused():
    _, found = plans.check(_plan(answer=["Python"], episode=["Wrote the billing service's tests"]), SOURCES)

    assert any("answer" in reason for reason in found)


def test_a_required_slot_with_no_quote_is_refused_and_names_what_it_holds():
    _, found = plans.check(_plan(answer=["Cut page load time by 30%"]), SOURCES)

    assert len(found) == 1 and "episode" in found[0] and "no quote" in found[0]


def test_an_optional_slot_with_no_quote_is_dropped():
    kept, found = plans.check(_plan(answer=["Cut page load time by 30%"], episode=["Wrote the billing service's tests"],
                                    result=[]), SOURCES)

    assert found == []
    assert "result" not in {b.slot for b in kept.slots}


def test_an_asked_slot_counts_only_when_given():
    slots = {"project": ["Software Intern, Acme"], "own_part": ["Wrote the billing service's tests"],
             "hard_part": ["Cut page load time by 30%"], "decision": ["Cut page load time by 30%"],
             "effect": ["Cut page load time by 30%"]}

    assert plans.check(_plan("best-project", **slots), SOURCES)[1] == []
    _, found = plans.check(_plan("best-project", **slots, why=[]), SOURCES)
    assert len(found) == 1 and "why" in found[0]


def test_a_story_must_be_a_line_of_the_experience_and_lead_one_answer():
    slots = {"answer": ["Cut page load time by 30%"], "episode": ["Wrote the billing service's tests"]}

    assert plans.check(_plan(story="- Cut page load time by 30%", **slots), SOURCES)[1] == []
    assert "not a line" in plans.check(_plan(story="Led the Mars mission", **slots), SOURCES)[1][0]
    led = {plans.stories({"story": "Cut page load time by 30%"}): "question_8"}
    assert "question_8" in plans.check(_plan(story="Cut page load time by 30%", **slots), SOURCES, led)[1][0]
    # An anything-else answer may lead with a story another answer leads with.
    assert plans.check(_plan("anything-else", story="Cut page load time by 30%",
                             new_fact=["Cut page load time by 30%"]), SOURCES, led)[1] == []


def test_the_company_fact_is_the_briefs_and_only_where_the_type_links_the_company():
    slots = {"company_fact": [FACT], "own_match": ["Cut page load time by 30%"]}

    assert plans.check(_plan("why-company", fact=FACT, **slots), SOURCES)[1] == []
    assert "company_brief" in plans.check(_plan("why-company", fact="Initech went to Mars.", **slots), SOURCES)[1][0]
    general = _plan(fact=FACT, answer=["Cut page load time by 30%"], episode=["Wrote the billing service's tests"])
    assert "ties no company fact" in plans.check(general, SOURCES)[1][0]


def test_an_unknown_type_is_refused():
    assert "not a Question type" in plans.check(_plan("haiku"), SOURCES)[1][0]
