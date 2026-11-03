"""Cover letters as the PDF an upload sends: printed by real Chrome here, where
every other test prints just the letter's text (conftest)."""

import re
from datetime import date
from pathlib import Path

import pytest
from conftest import FIXTURES, POLICIES

from apply import cover_letter
from apply.model import Posting
from apply.profile import ApplicantProfile

PROFILE = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", POLICIES)
POSTING = Posting("p", "Figma", "Software Engineer Intern", "https://jobs.example.com/1")
LETTER = "Dear Figma Recruiting Team:\n\nOpening.\n\nClosing.\n\nSincerely,\nTest Person"
PRINT = cover_letter.pdf  # before conftest swaps in the text printer


def test_the_file_is_named_like_the_resume():
    assert cover_letter.file_name(PROFILE) == "Test_Person_Cover_Letter.pdf"


@pytest.mark.skipif(not cover_letter.CHROME.exists(), reason="needs Google Chrome")
def test_chrome_prints_the_letter_as_a_one_page_pdf(tmp_path):
    path = tmp_path / "letter.pdf"

    PRINT(LETTER, POSTING, PROFILE, path, date(2026, 10, 19))

    printed = path.read_bytes()
    assert printed.startswith(b"%PDF")
    assert len(re.findall(rb"/Type\s*/Page\b", printed)) == 1
    assert b"LMRoman10" in printed  # the resume's font, embedded


def test_printing_without_chrome_raises_so_the_worker_sends_text_instead(tmp_path, monkeypatch):
    monkeypatch.setattr(cover_letter, "CHROME", Path("/nowhere/Google Chrome"))

    with pytest.raises(OSError):
        PRINT(LETTER, POSTING, PROFILE, tmp_path / "letter.pdf")


def test_the_header_writes_phone_and_links_as_the_resume_does():
    assert cover_letter._phone("+15165550123") == "(516) 555-0123"
    assert cover_letter._bare("https://www.linkedin.com/in/someone/") == "linkedin.com/in/someone"
