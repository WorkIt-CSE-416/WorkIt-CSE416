"""Logos: a wrong pattern shows another image, or none, and nothing errors.

Every snippet is copied from the live board page on 2026-09-29.
"""

from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from unittest import mock

from workit_scraper import logos, store
from workit_scraper.store import RunStats

GREENHOUSE = (
    '<meta property="og:image" content="https://s8-recruiting.cdn.greenhouse.io/'
    'external_greenhouse_job_boards/logos/400/009/600/original/Logo.png?1761765757"/>'
)
ASHBY = (
    '"logoWordmarkImageUrl":"https://app.ashbyhq.com/api/images/org-theme-wordmark/f789/21749954.png",'
    '"logoSquareImageUrl":"https://app.ashbyhq.com/api/images/org-theme-logo/f789/5210ba9e.png",'
)
LEVER = (
    '<meta property="og:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/'
    'a4f4f8e4-1656455575501.png" />\n'
    '<a href="https://jobs.lever.co/economicmodeling" class="main-header-logo"><img alt="Lightcast'
    ' logo" src="https://lever-client-logos.s3.us-west-2.amazonaws.com/a4f4f8e4-1656357502645.png">'
)


class TestExtract:
    def test_greenhouse_board_logo(self) -> None:
        assert (
            logos.extract("greenhouse", GREENHOUSE)
            == "https://s8-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/009/600/original/Logo.png?1761765757"
        )

    def test_ashby_square_not_wordmark(self) -> None:
        assert (
            logos.extract("ashby", ASHBY)
            == "https://app.ashbyhq.com/api/images/org-theme-logo/f789/5210ba9e.png"
        )

    def test_lever_header_logo_not_the_og_banner(self) -> None:
        assert (
            logos.extract("lever", LEVER)
            == "https://lever-client-logos.s3.us-west-2.amazonaws.com/a4f4f8e4-1656357502645.png"
        )

    def test_a_logo_on_any_other_host_is_refused(self) -> None:
        # next.config.ts allows only the ATS image hosts; anything else would fail the page.
        page = LEVER.replace("lever-client-logos.s3.us-west-2.amazonaws.com", "cdn.example.com")
        assert logos.extract("lever", page) is None

    def test_ashby_without_a_logo_falls_back_to_its_websites_favicon(self) -> None:
        # Beacon Software's Ashby board: no logo uploaded, website named.
        page = '"logoSquareImageUrl":null,"publicWebsite":"https://beaconsoftware.com/"'
        assert (
            logos.extract("ashby", page)
            == "https://www.google.com/s2/favicons?domain=beaconsoftware.com&sz=128"
        )

    def test_workable_account_logo_not_the_social_image(self) -> None:
        # Hugging Face's account, 2026-10-10: a 120x120 square.
        page = (
            '{"id":514327,"logo":"https://workablehr.s3.amazonaws.com/uploads/account/logo/'
            '514327/logo","subdomain":"huggingface","name":"Hugging Face",'
            '"url":"https://huggingface.co/","details":{"gdpr":{"url":'
            '"https://apply.workable.com/huggingface/gdpr_policy"}}}'
        )
        assert (
            logos.extract("workable", page)
            == "https://workablehr.s3.amazonaws.com/uploads/account/logo/514327/logo"
        )
        # With no logo, its website's icon -- the account's own `url`, not the GDPR page's.
        bare = page.replace('"https://workablehr.s3.amazonaws.com/uploads/account/logo/', '"x')
        assert logos.extract("workable", bare) == logos.favicon("huggingface.co")

    def test_a_board_without_a_logo(self) -> None:
        # Axios's Greenhouse board carries no uploaded logo.
        assert logos.extract("greenhouse", "<html><h1>Axios</h1></html>") is None


class TestStatedSite:
    def test_the_employers_own_site_not_the_boilerplate_links(self) -> None:
        # Scale AI's descriptions: an EEOC notice, then the company's own careers site.
        text = (
            'See &lt;a href="https://www.eeoc.gov/poster"&gt;EEOC&lt;/a&gt; or '
            '&lt;a href="https://scale.com/careers"&gt;careers&lt;/a&gt;'
        )
        assert logos.stated_site(text, "scaleai", "Scale AI") == "scale.com"

    def test_matches_on_the_company_name_when_the_token_differs(self) -> None:
        text = "Learn more at https://www.asteralabs.com/about"
        assert logos.stated_site(text, "asteraearlycareer2026", "Astera Labs") == "asteralabs.com"

    def test_a_hyphenated_domain_still_matches(self) -> None:
        # Squarepoint Capital's board redirects to www.squarepoint-capital.com.
        text = "https://www.squarepoint-capital.com/careers"
        assert (
            logos.stated_site(text, "squarepointcapital", "Squarepoint Capital")
            == "squarepoint-capital.com"
        )

    def test_only_unrelated_sites_means_none(self) -> None:
        # Freedom Technology Solutions links only a compliance-poster vendor.
        text = "https://www.mandatoryview.com/freedom and https://www.eeoc.gov"
        assert logos.stated_site(text, "freedomconsulting", "Freedom Technology") is None


def serve(pages: dict[str, bytes | str]):
    """A stand-in for `web.get`: the body for a URL, a refused redirect for a `str`."""

    def get(url: str, *, timeout: float) -> bytes:
        for prefix, answer in pages.items():
            if url.startswith(prefix):
                if isinstance(answer, str):
                    raise urllib.error.HTTPError(answer, 302, "refused", None, None)
                return answer
        raise urllib.error.HTTPError(url, 404, "not found", None, None)

    return get


def fetch(board: tuple[str, str, str], pages: dict[str, bytes | str]) -> dict:
    with (
        mock.patch.object(logos, "Robots"),
        mock.patch.object(logos.web, "get", serve(pages)),
    ):
        return logos.fetch([board])


# The Greenhouse jobs API JSON-escapes the HTML in `content` -- `\u0026lt;` -- which
# once leaked into the domain ("morsecorp.com%5Cu0026lt%3B").
def greenhouse_jobs(*links: str) -> bytes:
    content = " ".join(f"&lt;a href=&quot;{link}&quot;&gt;" for link in links)
    return json.dumps({"jobs": [{"content": content}]}).replace("&", "\\u0026").encode()


def png(side: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + bytes(8) + side.to_bytes(4) + side.to_bytes(4)


class TestFetch:
    def test_a_board_redirecting_to_its_own_site_gets_that_sites_favicon(self) -> None:
        # Stripe's Greenhouse board 302s to stripe.com, a redirect `web.get` refuses.
        found = fetch(
            ("greenhouse", "stripe", "Stripe"),
            {
                "https://job-boards.greenhouse.io/stripe": "https://stripe.com/jobs",
                "https://boards-api.greenhouse.io/": greenhouse_jobs(),
            },
        )
        assert found == {"greenhouse/stripe": logos.favicon("stripe.com")}

    def test_a_redirect_to_someone_elses_host_defers_to_the_descriptions(self) -> None:
        # Accenture Federal's board redirects to a Salesforce host; its jobs link accenture.com.
        found = fetch(
            ("greenhouse", "accenturefederalservices", "Accenture"),
            {
                "https://job-boards.greenhouse.io/": "https://smartafs.my.site.com/careers/s/",
                "https://boards-api.greenhouse.io/": greenhouse_jobs(
                    "https://www.accenture.com/us-en/careers"
                ),
            },
        )
        assert found == {"greenhouse/accenturefederalservices": logos.favicon("accenture.com")}

    def test_a_tiny_ashby_logo_gives_way_to_the_websites_icon(self) -> None:
        # Bedrock Robotics uploaded a 50px square; bedrockrobotics.com has a 128px icon.
        page = (
            b'"logoSquareImageUrl":"https://app.ashbyhq.com/api/images/org-theme-logo/b.png",'
            b'"publicWebsite":"https://bedrockrobotics.com/"'
        )
        board = ("ashby", "bedrock-robotics", "Bedrock Robotics")
        tiny = fetch(
            board, {"https://jobs.ashbyhq.com/": page, "https://app.ashbyhq.com/": png(50)}
        )
        assert tiny == {"ashby/bedrock-robotics": logos.favicon("bedrockrobotics.com")}
        sharp = fetch(
            board, {"https://jobs.ashbyhq.com/": page, "https://app.ashbyhq.com/": png(400)}
        )
        assert sharp == {
            "ashby/bedrock-robotics": "https://app.ashbyhq.com/api/images/org-theme-logo/b.png"
        }

    def test_an_unreadable_board_is_left_for_the_next_run(self) -> None:
        assert fetch(("lever", "gone", "Gone"), {}) == {}


class TestStore:
    def test_logos_survive_a_save_and_old_files_load(self, tmp_path: Path) -> None:
        run = store.Store(
            "2026-09-29T00:00:00+00:00", RunStats(), [], {}, {"ashby/a": "u", "lever/b": None}
        )
        path = tmp_path / "jobs.json"
        store.save(run, path)
        assert store.load(path).logos == {"ashby/a": "u", "lever/b": None}
        payload = json.loads(path.read_text(encoding="utf-8"))
        del payload["logos"]
        path.write_text(json.dumps(payload), encoding="utf-8")
        assert store.load(path).logos == {}

    def test_update_keeps_logos_already_read(self) -> None:
        previous = store.Store("2026-09-28T00:00:00+00:00", RunStats(), [], {}, {"ashby/a": "u"})
        now = "2026-09-29T00:00:00+00:00"
        assert store.update(previous, [], [], RunStats(), now).logos == {"ashby/a": "u"}
