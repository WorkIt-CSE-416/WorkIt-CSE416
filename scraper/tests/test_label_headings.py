"""The learned headings: what is asked about, how an answer is read, and how the
parser uses it (label_headings.py, sections.LEARNED_PATH). No test calls Groq."""

import io
import json

import pytest

import label_headings
from workit_scraper import sections


@pytest.fixture
def learned(monkeypatch):
    """Stand-in learned labels; the committed file never decides a test here."""

    def use(labels: dict[str, str]) -> None:
        monkeypatch.setattr(
            sections, "_LEARNED", {sections.learned_key(k): v for k, v in labels.items()}
        )

    use({})
    return use


def test_only_titles_and_labels_no_rule_names_are_asked_about(learned) -> None:
    text = (
        "Role Purpose\nTo support the underwriters.\n"
        "Responsibilities\nPython\nOnsite gym\nThings to know:\nApply by May."
    )

    assert sections.unknown_headings(text) == ["Role Purpose", "Things to know"]


def test_a_marked_heading_is_asked_about_and_a_list_item_never(learned) -> None:
    text = "Vos missions\nOnboard Systems Work"
    assert sections.unknown_headings(text, ("b", "li")) == ["Vos missions"]


def test_a_learned_label_opens_its_section(learned) -> None:
    # Starr's "Role Purpose": with no label, its summary stayed in the intro.
    learned({"Role Purpose": "role"})
    text = "Starr is an insurer.\nRole Purpose\nTo support the underwriters."

    assert sections.kept(text) == "Starr is an insurer.\nOverview\nTo support the underwriters."
    assert sections.unknown_headings(text) == []


def test_a_line_learned_as_no_heading_stays_content_and_is_not_asked_again(learned) -> None:
    learned({"Meaningful Impact": sections.NOT_A_HEADING})
    text = "Responsibilities\nShip code\nMeaningful Impact\nOwn a service"

    assert sections.kept(text) == "Responsibilities\nShip code\nMeaningful Impact\nOwn a service"
    assert sections.unknown_headings(text) == []


def test_a_learned_label_never_hides_kept_text(learned) -> None:
    # Groq filed Blenheim Chalcot's early-careers programme as the company's.
    learned({"The Centre of Excellence": "company"})
    text = "Responsibilities\nShip code\nThe Centre of Excellence\nIt trains new engineers."

    assert sections.kept(text) == (
        "Responsibilities\nShip code\nThe Centre of Excellence\nIt trains new engineers."
    )


def test_a_learned_label_moves_job_text_out_of_an_extra(learned) -> None:
    # Into the job's sections, which matching reads; About the Company it never does.
    learned({"Role Purpose": "role"})
    text = "About Us\nWe insure ships.\nRole Purpose\nTo support the underwriters."

    assert sections.kept(text) == (
        "Overview\nTo support the underwriters.\nAbout the Company\nWe insure ships."
    )


def test_a_pattern_beats_a_learned_label(learned) -> None:
    learned({"Requirements": "company"})
    assert sections.heading("Requirements") == "requirements"


def test_a_learned_label_is_not_held_to_the_company_voice_rule(learned) -> None:
    # The rule guards patterns, which match words; the model read the heading.
    learned({"Our ideal builders will have": "requirements"})
    assert sections.heading("Our ideal builders will have:") == "requirements"


def _reply(content: dict) -> io.BytesIO:
    reply = {"choices": [{"message": {"content": json.dumps(content)}}]}
    return io.BytesIO(json.dumps(reply).encode())


def test_an_invented_label_or_a_renamed_line_is_dropped(monkeypatch) -> None:
    labels = {"Role Purpose": "role", "Onsite gym": "perks", "role purpose!": "role"}
    monkeypatch.setattr(
        label_headings.urllib.request, "urlopen", lambda *a, **k: _reply({"labels": labels})
    )

    assert label_headings.ask(["Role Purpose", "Onsite gym"], "key", "model") == {
        "Role Purpose": "role"
    }


def test_a_run_saves_what_it_learned_and_asks_only_the_rest(tmp_path, monkeypatch, learned) -> None:
    source = tmp_path / "feed.json"
    source.write_text(
        json.dumps([{"description": "Role Purpose\nTo support.\nUSA Hiring Timelines:\nMay."}])
    )
    path = tmp_path / "learned_headings.json"
    path.write_text(json.dumps({"labels": {"USA Hiring Timelines": "logistics"}}))
    learned({"USA Hiring Timelines": "logistics"})
    monkeypatch.setattr(sections, "LEARNED_PATH", path)
    monkeypatch.setattr(label_headings, "PAUSE_S", 0)
    monkeypatch.setenv("GROQ_API_KEY", "key")
    asked = []

    def ask(names, key, model):
        asked.append(names)
        return {name: "role" for name in names}

    monkeypatch.setattr(label_headings, "ask", ask)

    assert label_headings.main([str(source)]) == 0
    assert asked == [["Role Purpose"]]
    assert json.loads(path.read_text())["labels"] == {
        "Role Purpose": "role",
        "USA Hiring Timelines": "logistics",
    }
    assert sections.load_learned(path) == {
        "role purpose": "role",
        "usa hiring timelines": "logistics",
    }


def test_the_committed_file_holds_only_known_labels() -> None:
    if not sections.LEARNED_PATH.exists():
        pytest.skip("no learned headings yet")
    labels = json.loads(sections.LEARNED_PATH.read_text(encoding="utf-8"))["labels"]
    assert set(labels.values()) <= sections.LEARNED_LABELS
