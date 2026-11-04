"""The resume heading labeler's own steps; nothing here calls a model."""

from app.scripts import label_resume_headings as labeler
from app.utils import resume_parser


def test_candidates_skip_comments_rules_and_learned_headings(tmp_path, monkeypatch):
    monkeypatch.setattr(resume_parser, "LEARNED", {"tech stack": "skills"})
    path = tmp_path / "candidates.txt"
    path.write_text(
        "# a comment\n\nEducation:\nTech Stack\nCapstone:\ncapstone\nGreek Life\n",
        encoding="utf-8",
    )
    # the rules name Education, Tech Stack is learned, and capstone is asked once
    assert labeler.candidates(path) == ["Capstone", "Greek Life"]


def test_keep_drops_invented_labels_and_renamed_lines():
    asked = ["Capstone", "Greek Life", "Contact"]
    reply = {"Capstone": "projects", "Greek Life": "fraternity", "contact info": "other"}
    assert labeler.keep(reply, asked) == {"Capstone": "projects"}


def test_meanings_cover_every_label():
    assert set(labeler.MEANINGS) == set(resume_parser.LEARNED_LABELS)
