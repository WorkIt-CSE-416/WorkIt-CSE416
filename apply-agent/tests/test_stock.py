from datetime import date

import pytest

from apply import home, stock
from apply.story_map import line_hash

BANK = "# Micromouse\n- Adapted the UKMARS firmware to our maze.\n- Tuned the PID loop on the bench.\n"


@pytest.fixture
def path(tmp_path, monkeypatch):
    path = tmp_path / "stock-answers.yaml"
    monkeypatch.setattr(stock, "PATH", path)
    monkeypatch.setattr(home, "STORY_BANK", tmp_path / "story-bank.md")
    (tmp_path / "story-bank.md").write_text(BANK)
    return path


def test_a_proposed_answer_is_pending_and_not_used_until_approved(path):
    stock.propose("why-field", "I chose CS because...", "Khan Academy", "Why this major?",
                  ["- Adapted the UKMARS firmware to our maze."])

    assert stock.get("why-field") is None
    [candidate] = stock.pending()
    assert candidate.type == "why-field" and candidate.approved is None
    assert candidate.from_company == "Khan Academy" and candidate.from_question == "Why this major?"
    assert candidate.facts == (line_hash("- Adapted the UKMARS firmware to our maze."),)


def test_approving_makes_it_his_stock_answer_for_the_type(path):
    stock.propose("why-field", "I chose CS because...", "Khan Academy", "Why this major?")
    stock.approve("why-field", today=date(2026, 10, 22))

    approved = stock.get("why-field")
    assert approved.text == "I chose CS because..." and approved.approved == date(2026, 10, 22)
    assert stock.pending() == []
    assert "approved:" in path.read_text()  # kept in a file Lisul can read and edit


def test_a_new_candidate_leaves_the_approved_answer_in_use(path):
    stock.propose("ai-tools", "Old.", "A", "Q?")
    stock.approve("ai-tools")
    stock.propose("ai-tools", "New.", "B", "Q?")

    assert stock.get("ai-tools").text == "Old."
    assert [s.text for s in stock.pending()] == ["New."]


def test_only_a_type_whose_guide_allows_stock_takes_one(path):
    with pytest.raises(ValueError):
        stock.propose("why-company", "Because you...", "Figma", "Why Figma?")
    with pytest.raises(ValueError):
        stock.propose("no-such-type", "x", "A", "Q?")
    with pytest.raises(KeyError):
        stock.approve("failure")  # nothing proposed


def test_editing_an_approved_answer_keeps_where_it_came_from(path):
    stock.propose("failure", "Draft.", "Datacor", "Tell us about a failure.")
    stock.approve("failure")
    stock.edit("failure", "My words.")

    edited = stock.get("failure")
    assert edited.text == "My words." and edited.from_company == "Datacor"
    with pytest.raises(KeyError):
        stock.edit("opinion", "x")


def test_a_stock_answer_whose_story_bank_lines_changed_is_stale(path):
    stock.propose("best-project", "Micromouse.", "A", "Q?", ["- Tuned the PID loop on the bench."])
    stock.approve("best-project")
    stock.propose("about-me", "Me.", "A", "Q?")  # no lines known: never stale
    stock.approve("about-me")

    assert stock.stale(BANK) == []
    assert stock.stale(BANK.replace("on the bench", "in the lab")) == ["best-project"]


def test_material_gives_each_approved_fresh_answer_once(path):
    assert stock.material(["why-field"]) == ""
    stock.propose("why-field", "Robots made it click.", "A", "Why CS?")
    stock.approve("why-field")
    stock.propose("best-project", "Micromouse.", "A", "Q?", ["- Gone from the bank."])
    stock.approve("best-project")
    stock.propose("ai-tools", "Pending only.", "A", "Q?")

    block = stock.material(["why-field", "why-field", "best-project", "ai-tools", "why-company"])

    assert block.count("Robots made it click.") == 1
    assert '<core_answer type="why-field">' in block
    assert "Micromouse." not in block  # stale: its facts may have changed
    assert "Pending only." not in block
