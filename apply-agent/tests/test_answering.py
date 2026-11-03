import csv
from pathlib import Path

import pytest

from apply import answering

TYPES = {"why-company", "what-youd-build", "values", "why-role", "preference", "best-project", "named-area",
         "failure", "not-on-resume", "ai-tools", "opinion", "why-field", "about-me", "anything-else",
         "cover-letter", "general"}
STOCK = {"best-project", "named-area", "failure", "not-on-resume", "ai-tools", "opinion", "why-field", "about-me"}
# Each essay question of the research forms with its taxonomy type (from the resume repo's
# research/sources/answer-types/lengths-forms-essays.csv, its type and label columns).
CSV = Path(__file__).parent / "fixtures" / "answer-types.csv"

# Real question wordings, from lengths-forms-essays.csv and the essay-eval sets.
REAL = [
    ("why-company", "Why do you want to join Figma? (Please share 3-4 sentences on why you want to join Figma)"),
    ("why-company", "Why are you interested in working at Harvey?"),
    ("why-company", "What excites you about Replit?"),
    ("why-company", "Why Nox Metals? Please do not use AI."),
    ("what-youd-build", "If Palantir didn't exist, what kind of company or work would you be most excited and "
                        "interested in working at/on? (Approx. 200 words)"),
    ("what-youd-build", "Why are you interested in Cloudflare's Software Engineering Internship? What products or "
                        "features are you interested in building?"),
    ("what-youd-build", "What do you want to work on during your internship at Pangram? Please, no AI text."),
    ("values", "Describe one of Belvedere Trading’s core values and what it means to you."),
    ("values", "Why does Solace's mission resonate with you?"),
    ("why-role", "What qualities do you believe make someone a great Agent Engineer, and how do your skills and "
                 "experiences make you the best candidate for this role?"),
    ("why-role", "In 1–2 sentences, what makes you a fit for this role?"),
    ("why-role", "What will you bring to InstaLily?"),
    ("preference", "Are you applying to work on something specific at Exa? (1 sentence, leave blank if you're "
                   "open to anything)"),
    ("preference", "What specific types of work are you most interested in focusing on during your time with us?"),
    ("best-project", "Tell us about a project you're most proud of."),
    ("best-project", "What is your most significant technical achievement?"),
    ("best-project", "What is one thing you built, shipped, or owned end-to-end?"),
    ("named-area", "Briefly describe a recent web application you worked on. Share specifics about the languages "
                   "and frameworks used, the team you worked with, and any challenges you faced."),
    ("named-area", "Have you done projects that involve building Predictive models?"),
    ("failure", "Tell us about a robotics project that completely failed on the first try. What failed, how did "
                "you debug it, and what did you learn from the experience?"),
    ("failure", "Describe the most technically challenging bug or problem you've debugged. What made it hard, "
                "and how did you figure it out?"),
    ("failure", "Tell us about a time you changed your mind about something. (150 words max)"),
    ("not-on-resume", "Tell us one thing that’s not on your resume that you’re proud of."),
    ("not-on-resume", "Please provide 2-3 bullet points showcasing exceptional ability."),
    ("not-on-resume", "What's something you excel at that you can teach us?"),
    ("ai-tools", "We're curious — how have AI tools shown up in your work, studies, or personal projects over the "
                 "past six months? What worked, what surprised you?"),
    ("ai-tools", "What's your default coding agent / AI setup, and how do you use it day-to-day?"),
    ("ai-tools", "What are some AI specific technologies you are comfortable with?"),
    ("opinion", "What is one trend or advancement in web development that you're excited about? Why? What have "
                "you done to learn about it? Please be specific."),
    ("opinion", "What were your top 1-2 computer science courses taken and why?"),
    ("opinion", "What's one of your favorite software products, and what would you change about it?"),
    ("why-field", "What is your current major, and what inspired you to choose this field of study?"),
    ("why-field", "Please write a few sentences around what you are looking to gain from an internship."),
    ("why-field", "What are your career goals and why do you think this role helps actualize them?"),
    ("about-me", "Tell us about yourself!"),
    ("about-me", "Give us three numbers that describe you - and tell us why."),
    ("about-me", "Tell us about a hobby, passion, or obsession outside of engineering that has unexpectedly "
                 "shaped how you think or work?"),
    ("anything-else", "Is there anything else you'd like us to know?"),
    ("anything-else", "Additional information"),
    ("anything-else", "Anything else you'd like to tell us? Please, no AI text."),
    ("cover-letter", "Cover Letter"),
    ("cover-letter", "Note to Hiring Manager"),
    ("general", "Please share your previous internship, co-curricular, research and/or hands-on engineering "
                "experience:"),
    ("general", "Describe an example of your work that required careful judgment or consistent application of rules."),
]

# The CSV files questions under the research taxonomy's numbers; the plan's
# types split or merge a few of them, so each number accepts its plan types.
ACCEPT = {"1": {"why-company", "why-role"}, "2": {"what-youd-build", "preference"}, "3": {"values"},
          "4": {"why-role"}, "5": {"best-project", "named-area"}, "6": {"named-area"}, "7": {"ai-tools"},
          "8": {"opinion"}, "9": {"why-field"}, "10": {"not-on-resume", "best-project"}, "11": {"failure"},
          "12": {"general"}, "13": {"anything-else"}, "14": {"cover-letter"}, "15": {"about-me"}}


def test_every_type_loads_with_all_fields():
    guides = answering.load()
    assert set(guides) == TYPES
    for name, g in guides.items():
        assert g.type == name
        assert g.company_link in ("same-kind", "never")
        assert g.stock == (name in STOCK)
        assert isinstance(g.high_stakes, bool)
        assert g.match or name == "general"
        for heading in ("What the reader is checking", "Order", "Rules", "Pairs"):
            assert f"## {heading}" in g.body, (name, heading)


def test_every_type_has_slots_and_one_always_required():
    for name, g in answering.load().items():
        assert g.slots, name
        assert all(s.required in (True, False, "asked") and s.holds for s in g.slots), name
        assert len({s.name for s in g.slots}) == len(g.slots), name
        assert any(s.required is True for s in g.slots) or name == "about-me", name


def test_lengths_are_valid():
    for name, g in answering.load().items():
        low, high = g.length
        assert isinstance(low, int) and isinstance(high, int) and 0 < low < high <= 350, name


def test_rules_and_guide_text():
    assert "first sentence" in answering.rules()
    text = answering.guide_text(["failure", "why-company", "failure"])
    assert text.count("# Question type:") == 2
    assert "swap test" in text


@pytest.mark.parametrize("expected, question", REAL)
def test_classify_real_questions(expected, question):
    assert answering.classify(question) == expected


def test_classify_falls_back_to_general():
    assert answering.classify("Lorem ipsum") == "general"


def test_classify_accuracy_on_the_forms():
    rows = list(csv.DictReader(CSV.open()))
    right = sum(answering.classify(r["label"]) in ACCEPT[r["type"].split()[0]] for r in rows)
    print(f"classify: {right}/{len(rows)} = {right / len(rows):.1%}")
    assert right / len(rows) >= 0.93


def test_why_a_field_is_not_why_a_company():
    assert answering.classify("Why did you choose computer science?") == "why-field"
    assert answering.classify("Why are you interested in software engineering?") == "why-field"
    assert answering.classify("Why are you interested in working at Stripe?") == "why-company"


def test_every_type_has_a_yes_no_checklist_for_the_critic():
    assert answering.checklist("values")[0] == "Is exactly one value named, in the company's own words?"
    assert all(len(answering.checklist(t)) >= 5 for t in answering.load())
