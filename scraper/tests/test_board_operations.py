"""Shared board interpretation and complete-read policy across both commands."""

import urllib.error

import pytest

from workit_scraper.board_read import ReadStatus, read_board
from workit_scraper.providers import Board, BoardNotFound, Incomplete, TooLarge
from workit_scraper.providers.urls import board_keys


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://job-boards.greenhouse.io/Acme/jobs/1", ("greenhouse", "acme")),
        ("https://job-boards.eu.greenhouse.io/Acme/jobs/1", ("greenhouse", "acme")),
        ("https://boards.greenhouse.io/embed/job_app?token=1&for=Acme", ("greenhouse", "acme")),
        ("https://jobs.ashbyhq.com/Acme/1", ("ashby", "acme")),
        ("https://jobs.lever.co/Acme/1", ("lever", "acme")),
        ("https://jobs.lever.co/Acme/software%20intern", ("lever", "acme")),
        ("https://jobs.eu.lever.co/Acme/1", ("lever", "eu/acme")),
        ("https://apply.workable.com/Acme/j/1", ("workable", "acme")),
        ("https://Acme.recruitee.com/o/intern", ("recruitee", "acme")),
        ("https://Acme.bamboohr.com/careers/1", ("bamboohr", "acme")),
        ("https://ats.rippling.com/en-US/acme/jobs/1", ("rippling", "acme")),
        ("https://careers-acme.icims.com/jobs/1/intern", ("icims", "careers-acme")),
        (
            "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1",
            ("oracle", "acme.fa.us2/CX_1"),
        ),
        (
            "https://acme.wd5.myworkdayjobs.com/en-US/External/job/1",
            ("workday", "acme.wd5/external"),
        ),
        (
            "https://wd5.myworkdaysite.com/en-US/recruiting/acme/External/job/1",
            ("workday", "acme.wd5/external"),
        ),
    ],
)
def test_every_provider_url_uses_one_parser(url, expected):
    assert board_keys(url) == [expected]


@pytest.mark.parametrize(
    "url",
    [
        "https://eviljobs.lever.co/acme",
        "https://jobs.lever.co.evil.com/acme",
        "https://acme.recruitee.com.evil.com/o/job",
        "https://example.com/jobs.lever.co/acme",
        "https://example.com/?u=https://jobs.lever.co/acme",
        "https://user@jobs.lever.co/acme",
        "https://jobs.lever.co:999/acme",
        "https://boards.greenhouse.io/embed/job_app?for=a&for=b",
        "https://boards.greenhouse.io/embed/job_app?for=a&for=",
        "https://boards.greenhouse.io/embed/job_app?token=1",
        "https://jobs.lever.co/acme%2Dother",
        "https://boards.greenhouse.io/acme.other",
        "https://jobs.ashbyhq.com/acme%2Dother",
        "https://apply.workable.com/acme.other",
        "https://wd5.myworkdaysite.com/recruiting/acme/External.other",
        "https://acme.wd5.myworkdayjobs.com/External%2Dother",
        "https://jobs.lever.co/acme/../other",
        "https://jobs.lever.co/acme/%2e%2e/other",
        "https://jobs.lever.co/acme/.%2e/other",
        "https://jobs.lever.co/acme%2Fother",
        "https://jobs.lever.co/acme/%2F..%2Fother",
        "https://jobs.lever.co/acme/..\\other",
    ],
)
def test_untrusted_or_ambiguous_urls_are_not_boards(url):
    assert board_keys(url) == []


class Rules:
    def __init__(self, deny=None):
        self.deny = deny
        self.checked = []
        self.paced = []

    def allows(self, url):
        self.checked.append(url)
        return url != self.deny

    def pace(self, url):
        self.paced.append(url)


def test_empty_complete_read_is_successful_and_silent(swap_provider, capsys):
    swap_provider("lever", read=lambda *_: [])
    rules = Rules()
    result = read_board(Board("lever", "acme", "Acme"), rules)
    assert result.status is ReadStatus.OK
    assert result.jobs == [] and result.reason is None
    assert rules.paced == rules.checked
    assert capsys.readouterr().out == ""


def test_paged_reader_checks_public_site_and_receives_pacer(swap_provider):
    rules = Rules()
    calls = []

    def read(token, company, *, pace):
        assert pace == rules.pace
        calls.append((token, company))
        return []

    swap_provider("workday", read=read)
    board = Board("workday", "acme.wd5/external", "Acme")
    result = read_board(board, rules)
    assert result.status is ReadStatus.OK
    assert calls == [(board.token, board.company)]
    assert len(rules.checked) == 2
    assert rules.checked[1] == "https://acme.wd5.myworkdayjobs.com/external/"
    assert rules.paced == rules.checked[:1]


def test_denied_public_site_prevents_api_read(swap_provider):
    def read(*_args, **_kwargs):
        pytest.fail("robots refusal must prevent the API read")

    swap_provider("workday", read=read)
    rules = Rules("https://acme.wd5.myworkdayjobs.com/external/")
    result = read_board(Board("workday", "acme.wd5/external", "Acme"), rules)
    assert result.status is ReadStatus.SKIPPED
    assert result.reason == "robots.txt"
    assert rules.paced == []


@pytest.mark.parametrize(
    ("error", "status", "reason"),
    [
        (BoardNotFound(), ReadStatus.MISSING, "no such board"),
        (TooLarge(), ReadStatus.SKIPPED, "too large"),
        (Incomplete(), ReadStatus.FAILED, "incomplete"),
        (TimeoutError(), ReadStatus.FAILED, "timeout"),
        (
            urllib.error.HTTPError("https://api.example", 429, "limit", {}, None),
            ReadStatus.FAILED,
            "429",
        ),
    ],
)
def test_both_commands_receive_actionable_failures(swap_provider, error, status, reason):
    def read(*_):
        raise error

    swap_provider("lever", read=read)
    result = read_board(Board("lever", "acme", "Acme"), Rules())
    assert result.status is status
    assert result.reason == reason
    assert result.error is error
    assert result.jobs == []


def test_unsupported_reader_does_not_request_anything():
    rules = Rules()
    result = read_board(Board("unknown", "acme", "Acme"), rules)
    assert result.status is ReadStatus.SKIPPED
    assert result.reason == "no reader"
    assert rules.checked == []
