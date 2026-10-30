"""Logos: a wrong pattern shows another image, or none, and nothing errors.

Every snippet is copied from the live board page: 2026-09-29 unless a test says
another day.
"""

from __future__ import annotations

import json
import urllib.error
from dataclasses import replace
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

    def test_workday_home_page_gives_its_favicon(self) -> None:
        # NVIDIA's careers site, 2026-10-19: no square logo, a "Home" link to nvidia.com.
        page = (
            '"header":{"homePageURL":"https://www.nvidia.com/en-us/about-nvidia/careers/",'
            '"homeLinkText":"Home","logoUri":"/NVIDIAExternalCareerSite/assets/logo"}'
        )
        assert logos.extract("workday", page) == logos.favicon("www.nvidia.com")

    def test_a_workday_home_page_on_workday_itself_is_no_website(self) -> None:
        # Arlo's "Arlo Home" is its own careers site, whose icon is Workday's.
        page = '"header":{"homePageURL":"https://arlo.wd12.myworkdayjobs.com/External_Careers"}'
        assert logos.extract("workday", page) is None

    def test_lever_logo_on_the_older_dash_host(self) -> None:
        # Daniels Health, 2026-10-19: `s3-us-west-2`, not `s3.us-west-2`.
        page = (
            '<a href="https://jobs.lever.co/daniels-sharpsmart" class="main-header-logo">'
            '<img alt="Daniels Health logo" src="https://lever-client-logos.s3-us-west-2.'
            'amazonaws.com/54f80fd6-ad0a-43af-bca8-9b1c1cfe485d-1596756879445.png">'
        )
        assert logos.extract("lever", page) == (
            "https://lever-client-logos.s3-us-west-2.amazonaws.com/"
            "54f80fd6-ad0a-43af-bca8-9b1c1cfe485d-1596756879445.png"
        )

    def test_lever_without_a_logo_falls_back_to_its_home_page_link(self) -> None:
        # Zoox, 2026-10-19: an empty header, and the footer's "Zoox Home Page".
        page = (
            '<div class="main-header-content page-centered narrow-section page-full-width">'
            '</div>...<div class="main-footer-text"><p><a href="http://zoox.com">Zoox Home '
            "Page</a></p>"
        )
        assert logos.extract("lever", page) == logos.favicon("zoox.com")

    def test_bamboohr_header_logo_with_its_escaped_slashes(self) -> None:
        # Content Guru's careers page, 2026-10-19: a 306x120 PNG behind a .jpg name.
        page = (
            '"logo":{"alt":"Content Guru","url":"https:\\/\\/images4.bamboohr.com\\/390319'
            '\\/logos\\/cropped.jpg?v=52","width":null,"height":"60"}'
        )
        assert (
            logos.extract("bamboohr", page)
            == "https://images4.bamboohr.com/390319/logos/cropped.jpg?v=52"
        )

    def test_bamboohr_logo_on_the_companys_own_subdomain(self) -> None:
        # Armstrong Fluid Technology serves it from its board's own host.
        page = (
            '"logo":{"alt":"Armstrong Fluid Technology","url":"https:\\/\\/'
            'armstrongfluidtechnology.bamboohr.com\\/manage\\/logo\\/?v=38",'
            '"width":null,"height":"43"}'
        )
        assert (
            logos.extract("bamboohr", page)
            == "https://armstrongfluidtechnology.bamboohr.com/manage/logo/?v=38"
        )

    def test_bamboohr_with_no_logo_uploaded(self) -> None:
        # ConeTec Group: `false`, not a URL.
        page = '"logo":{"alt":"ConeTec Group","url":false,"width":null,"height":null}'
        assert logos.extract("bamboohr", page) is None

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

    def test_a_workday_site_with_no_home_page_falls_back_to_its_privacy_policy(self) -> None:
        # KBR's careers site, 2026-10-19: no "Home" link, a privacy notice on kbr.com.
        approot = (
            b'{"footer":{"socialLinksList":[{"label":"LinkedIn","uri":'
            b'"https://www.linkedin.com/company/kbr-inc/"}],"privacyPolicy":{"uri":'
            b'"https://www.kbr.com/document/8536"}},"header":{"homePageURL":null}}'
        )
        found = fetch(
            ("workday", "kbr.wd5/kbr_careers", "KBR"),
            {"https://kbr.wd5.myworkdayjobs.com/wday/cxs/kbr/kbr_careers/approot": approot},
        )
        assert found == {"workday/kbr.wd5/kbr_careers": logos.favicon("kbr.com")}

    def test_a_workday_privacy_policy_on_a_vendor_names_no_website(self) -> None:
        # Barclays' is a PDF on its careers-site vendor's CDN.
        approot = (
            b'{"footer":{"privacyPolicy":{"uri":"https://tbcdn.talentbrew.com/company/13015/'
            b'v1_0/pdf/Candidate_Privacy_Notice.pdf"}},"header":{"homePageURL":null}}'
        )
        # Barclays has a checked website since KAN-442, which would answer first.
        with mock.patch.dict(logos.CHECKED_WEBSITES, clear=True):
            found = fetch(
                ("workday", "barclays.wd3/external_career_site_barclays", "Barclays"),
                {"https://barclays.wd3.myworkdayjobs.com/": approot},
            )
        assert found == {"workday/barclays.wd3/external_career_site_barclays": None}

    def test_a_greenhouse_logo_link_names_the_site_with_no_logo_uploaded(self) -> None:
        # BGE's campus board, 2026-10-19: no image, but the logo links bgeinc.com.
        page = (
            b'"boardConfiguration":{"job_board_id":4006376008,"logo":{"href":'
            b'"https://www.bgeinc.com/careers/","url":null}'
        )
        found = fetch(
            ("greenhouse", "bgeinccampus", "BGE"),
            {
                "https://job-boards.greenhouse.io/": page,
                "https://boards-api.greenhouse.io/": greenhouse_jobs(),
            },
        )
        assert found == {"greenhouse/bgeinccampus": logos.favicon("bgeinc.com")}

    def test_a_greenhouse_logo_link_to_a_file_host_is_no_website(self) -> None:
        # OH.io's logo links a wallpaper on Slack, whose icon is Slack's.
        page = (
            b'"logo":{"href":"https://files.slack.com/files-pri/T09CDJ5E3JA-F09TY7WU2T0/'
            b'oh.io_2560_wallpaper.png","url":null}'
        )
        found = fetch(
            ("greenhouse", "ohio", "OH.io"),
            {
                "https://job-boards.greenhouse.io/": page,
                "https://boards-api.greenhouse.io/": greenhouse_jobs(),
            },
        )
        assert found == {"greenhouse/ohio": None}

    def test_a_hidden_lever_board_is_named_by_its_descriptions(self) -> None:
        # Aircall, 2026-10-19: every jobs.lever.co page is a 404, the API is public,
        # and each posting's closing lines link a page on aircall.io.
        posting = {
            "description": "<div>Aircall is a cloud-based phone system.</div>",
            "lists": [{"text": "About you", "content": "<li>Curious.</li>"}],
            "additional": (
                "<div>Want to know more about candidate privacy? Find our <a "
                'class="postings-link" href="https://aircall.io/candidate-privacy-notice/">'
                "Candidate Privacy Notice here.</a></div>"
            ),
        }
        found = fetch(
            ("lever", "aircall", "Aircall"),
            {"https://api.lever.co/": json.dumps([posting]).encode()},
        )
        assert found == {"lever/aircall": logos.favicon("aircall.io")}

    def test_bamboohr_reads_its_careers_page(self) -> None:
        page = (
            b'"logo":{"alt":"TGG Accounting","url":"https:\\/\\/images7.bamboohr.com\\/39282'
            b'\\/logos\\/cropped.jpg?v=24","width":null,"height":"60"}'
        )
        found = fetch(
            ("bamboohr", "tggaccounting", "TGG Accounting"),
            {"https://tggaccounting.bamboohr.com/careers": page},
        )
        assert found == {
            "bamboohr/tggaccounting": "https://images7.bamboohr.com/39282/logos/cropped.jpg?v=24"
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

    def test_a_newer_reader_reads_the_boards_that_had_no_logo_again(self, tmp_path: Path) -> None:
        old = store.Store(
            "2026-10-18T00:00:00+00:00", RunStats(), [], {}, {"a/x": "u", "b/y": None}
        )
        path = tmp_path / "jobs.json"
        store.save(old, path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        del payload["logos_version"]
        path.write_text(json.dumps(payload), encoding="utf-8")
        # A store from before the version existed counts as version 1.
        loaded = store.load(path)
        assert loaded.logos_version == 1
        newer = store.reread_missing_logos(loaded, 2)
        assert (newer.logos, newer.logos_version) == ({"a/x": "u"}, 2)
        # Once per version: a board read again and still bare stays recorded.
        again = replace(newer, logos={**newer.logos, "b/y": None})
        assert store.reread_missing_logos(again, 2) is again
        now = "2026-10-19T00:00:00+00:00"
        assert store.update(again, [], [], RunStats(), now).logos_version == 2


class TestCompanyDomain:
    """The website the Jobs page draws a logo from (KAN-442). The cases are the
    Brandfetch test of 2026-10-29: 98 of 100 companies drew a logo, and Micron,
    whose home page is on Eightfold, drew Eightfold's."""

    def test_the_favicons_website_cut_to_its_registered_domain(self) -> None:
        careers = logos.favicon("careers.gevernova.com")
        assert logos.company_domain("workday/gevernova.wd5/ge_vernova", careers) == "gevernova.com"
        assert logos.company_domain("workday/x", logos.favicon("www.careers.jnj.com")) == "jnj.com"

    def test_a_country_suffix_keeps_the_companys_own_label(self) -> None:
        assert logos.registered_domain("intel.co.uk") == "intel.co.uk"
        assert logos.registered_domain("www.example.com.au") == "example.com.au"

    def test_a_hiring_vendors_site_is_no_companys(self) -> None:
        assert logos.company_domain("workday/x", logos.favicon("micron.eightfold.ai")) is None

    def test_the_checked_website_wins_over_the_favicons(self) -> None:
        micron = logos.favicon("micron.eightfold.ai")
        assert logos.company_domain("workday/micron.wd1/external", micron) == "micron.com"
        uline = logos.favicon("www.uline.jobs")
        assert logos.company_domain("workday/uline.wd1/uline_careers", uline) == "uline.com"

    def test_a_board_with_no_logo_page_gets_its_checked_website(self) -> None:
        # iCIMS and Oracle boards are never read for a logo.
        assert logos.company_domain("icims/careers-kimley-horn", None) == "kimley-horn.com"
        assert logos.company_domain("oracle/hdpc.fa.us2/LateralHiring", None) == "goldmansachs.com"

    def test_an_uploaded_logo_or_none_gives_no_domain(self) -> None:
        upload = "https://app.ashbyhq.com/api/images/x.png"
        assert logos.company_domain("ashby/terranova", upload) is None
        assert logos.company_domain("lever/nologo", None) is None

    def test_every_checked_website_fits_the_columns_check(self) -> None:
        for key, site in logos.CHECKED_WEBSITES.items():
            assert logos.DOMAIN.fullmatch(logos.registered_domain(site)), key
