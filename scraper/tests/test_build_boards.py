"""Apply links to board slugs: a pattern that misses grows no boards and says nothing.

Every link that names a board is from the curated lists build_boards.py reads, as
they were on 2026-10-10. The ones that name none are each provider's own addresses.
"""

from __future__ import annotations

import urllib.error
from dataclasses import replace
from types import SimpleNamespace

import pytest

import build_boards
from build_boards import Listing, tokens, unread_cause, unread_hosts


def slugs(link: str) -> list[tuple[str, str]]:
    return tokens(link)


@pytest.mark.parametrize(
    ("link", "board"),
    [
        ("https://apply.workable.com/coldquanta/j/32919D6F52/apply", ("workable", "coldquanta")),
        (
            "https://apply.workable.com/quadric-dot-i-o-inc/j/4F8EDFF366/apply",
            ("workable", "quadric-dot-i-o-inc"),
        ),
        ("https://1x.recruitee.com/o/data-analytics-intern", ("recruitee", "1x")),
        (
            "https://hardrockdigital.recruitee.com/o/associate-ai-agent-analyst",
            ("recruitee", "hardrockdigital"),
        ),
        ("https://nexthopai.bamboohr.com/careers/24", ("bamboohr", "nexthopai")),
        ("https://specteraerospace.bamboohr.com/careers/121/", ("bamboohr", "specteraerospace")),
        # Greenhouse's EU host (seen 2026-10-26): the same board, which the US
        # boards-api answers. Missing `.eu.` dropped 26 companies.
        (
            "https://job-boards.eu.greenhouse.io/stubhubinc/jobs/4794786101",
            ("greenhouse", "stubhubinc"),
        ),
        ("https://job-boards.greenhouse.io/stripe/jobs/7012345", ("greenhouse", "stripe")),
        # Lever's EU data centre (seen 2026-10-27), whose API is api.eu.lever.co:
        # missing `.eu.` left Quantinuum's and Cirrus's boards unread.
        (
            "https://jobs.eu.lever.co/quantinuum/46b3f32c-a2ad-4d4d-bff6-b1bbebf3e382/apply",
            ("lever", "eu/quantinuum"),
        ),
        ("https://jobs.lever.co/palantir/abc", ("lever", "palantir")),
    ],
)
def test_an_apply_link_names_its_board(link: str, board: tuple[str, str]) -> None:
    assert slugs(link) == [board]


@pytest.mark.parametrize(
    "link",
    [
        # Workable's account-less short link and its API name no board.
        "https://apply.workable.com/j/81B46579FE",
        "https://apply.workable.com/api/v1/widget/accounts/huggingface",
        # The vendors' own sites.
        "https://www.bamboohr.com/careers",
        "https://www.recruitee.com/",
    ],
)
def test_links_that_name_no_board(link: str) -> None:
    assert slugs(link) == []


def test_unread_links_are_counted_by_host() -> None:
    # Where the next reader would pay off: links no pattern takes, by host.
    links = [
        "https://jobs.smartrecruiters.com/Visa/744000089542455",
        "https://jobs.smartrecruiters.com/ServiceNow/744000090109135",
        "https://jobs.apple.com/en-us/details/200620000",
        "https://jobs.lever.co/palantir/abc",
        "",
    ]
    assert unread_hosts(links).most_common() == [
        ("jobs.smartrecruiters.com", 2),
        ("jobs.apple.com", 1),
    ]


@pytest.mark.parametrize(
    ("link", "cause"),
    [
        # Every link here was in the curated lists on 2026-10-27. Batch apply
        # (KAN-369) reads Keysight's iCIMS Jibe site, SuccessFactors and TikTok
        # now, so those three left this list.
        ("https://go.vansh.nyc/o", "a link shortener (--resolve)"),
        (
            "https://generatebiomedicines.com/open-positions?gh_jid=4643139006",
            "Greenhouse behind the company's site (--resolve)",
        ),
        (
            "https://jobs.smartrecruiters.com/RedBull/744000112125687",
            "SmartRecruiters, whose robots.txt disallows us",
        ),
        ("https://johndeere.eightfold.ai/careers/job/137479374700", "Eightfold"),
        (
            "https://specialisterne.applytojob.com/apply/Vt3hev3H0E/Software-Engineer-Intern",
            "JazzHR",
        ),
    ],
)
def test_an_unread_link_is_counted_by_why(link: str, cause: str) -> None:
    assert tokens(link) == []
    assert unread_cause(link) == cause


def test_a_list_whose_links_name_no_board_says_so(monkeypatch, capsys) -> None:
    # The vanshb03 list wrapped every link in a short link (2026-10-27): its 1,877
    # rows named no board, and the old report printed only its row count.
    rows = {
        build_boards.SOURCES[0]: [{"url": "https://jobs.lever.co/palantir/abc", "active": True}],
        build_boards.SOURCES[1]: [],
        build_boards.SOURCES[2]: [{"url": "https://go.vansh.nyc/o", "company_name": "Acme"}],
    }
    monkeypatch.setattr(build_boards, "Robots", lambda urls: ROBOTS)
    monkeypatch.setattr(build_boards, "fetch", lambda url, robots: rows[url])
    found, unread = build_boards.harvest({("lever", "palantir")})
    printed = capsys.readouterr().out
    assert found == {("lever", "palantir"): "palantir"}
    assert unread == [Listing("https://go.vansh.nyc/o", "Acme", False)]
    assert "1 boards, 0 new" in printed
    assert "!       1 listings  vanshb03/Summer2027-Internships: no link names a board" in printed


ROBOTS = SimpleNamespace(allows=lambda url: True, pace=lambda url: None)


class Web:
    """Answers by URL: bytes for a 200, a str for a redirect to it (refused, as
    `web.get` refuses any to another site), else a 404. Records what was asked."""

    def __init__(self, answers: dict[str, bytes | str]) -> None:
        self.answers, self.asked = answers, []

    def __call__(self, url: str) -> bytes:
        self.asked.append(url)
        answer = self.answers.get(url)
        if isinstance(answer, bytes):
            return answer
        if isinstance(answer, str):
            raise urllib.error.HTTPError(answer, 302, "refused cross-origin redirect", None, None)
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)


class TestResolve:
    """Built cases: this session could not reach the hosts, so the first real
    `--resolve` run's diff of boards.csv is the live check. What they pin is that
    nothing is kept on a guess: a board under the wrong name would put another
    company's name on real cards."""

    WAYMO = Listing("https://careers.withwaymo.com/jobs?gh_jid=8189848", "Waymo", True)
    GH = "https://boards-api.greenhouse.io/v1/boards/{}/jobs/{}"

    def test_a_careers_page_maps_to_the_board_that_holds_its_posting(self) -> None:
        web = Web({self.GH.format("waymo", "8189848"): b"{}"})
        assert build_boards.greenhouse_board(self.WAYMO, ROBOTS, web) == "waymo"
        assert web.asked == [self.GH.format("waymo", "8189848")]

    def test_a_board_only_its_page_names_is_proved_the_same_way(self) -> None:
        listing = Listing("https://www.zipline.com/careers?gh_jid=77", "Zipline", True)
        page = b'<script src="https://boards.greenhouse.io/embed/job_board/js?for=flyzipline">'
        web = Web({listing.link: page, self.GH.format("flyzipline", "77"): b"{}"})
        assert build_boards.greenhouse_board(listing, ROBOTS, web) == "flyzipline"

    def test_a_name_no_board_confirms_is_never_kept(self) -> None:
        listing = Listing("https://www.zipline.com/careers?gh_jid=77", "Zipline", True)
        page = b'<a href="https://job-boards.greenhouse.io/someoneelse">'
        assert build_boards.greenhouse_board(listing, ROBOTS, Web({listing.link: page})) is None

    def test_an_icims_page_maps_to_the_tenant_whose_sitemap_lists_it(self) -> None:
        listing = Listing(
            "https://jobs.keysight.com/jobs/51813?lang=en-us&icims=1", "Keysight", True
        )
        page = b'<a href="https://careers-keysight.icims.com/jobs/51813/login">Apply</a>'
        sitemap = b"<urlset><loc>https://careers-keysight.icims.com/jobs/51813/x/job</loc></urlset>"
        web = Web({listing.link: page, "https://careers-keysight.icims.com/sitemap.xml": sitemap})
        assert build_boards.icims_board(listing, ROBOTS, web) == "careers-keysight"

    def test_a_sitemap_without_the_posting_proves_nothing(self) -> None:
        listing = Listing("https://jobs.keysight.com/jobs/51813?icims=1", "Keysight", True)
        web = Web({"https://careers-keysight.icims.com/sitemap.xml": b"<urlset></urlset>"})
        assert build_boards.icims_board(listing, ROBOTS, web) is None

    def test_a_short_link_is_followed_to_its_board(self) -> None:
        short = Listing("https://go.vansh.nyc/o", "Acme", True)
        web = Web({short.link: "https://job-boards.greenhouse.io/acme/jobs/123"})
        assert build_boards.resolve([short], ROBOTS, web) == {("greenhouse", "acme"): "Acme"}

    def test_a_short_link_to_a_careers_page_is_resolved_from_there(self) -> None:
        short = Listing("https://go.vansh.nyc/p", "Waymo", True)
        web = Web({short.link: self.WAYMO.link, self.GH.format("waymo", "8189848"): b"{}"})
        assert build_boards.resolve([short], ROBOTS, web) == {("greenhouse", "waymo"): "Waymo"}

    def test_an_open_posting_is_tried_before_a_closed_one(self) -> None:
        closed = replace(self.WAYMO, link=self.WAYMO.link.replace("8189848", "1"), active=False)
        web = Web({self.GH.format("waymo", "8189848"): b"{}"})
        found = build_boards.resolve([closed, self.WAYMO], ROBOTS, web)
        assert found == {("greenhouse", "waymo"): "Waymo"}
        assert web.asked[0] == self.GH.format("waymo", "8189848")

    def test_robots_txt_is_obeyed(self) -> None:
        robots = SimpleNamespace(allows=lambda url: False, pace=lambda url: None)
        web = Web({})
        assert build_boards.resolve([self.WAYMO], robots, web) == {}
        assert web.asked == []
