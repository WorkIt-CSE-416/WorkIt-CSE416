"""Company material: what the employer publishes about itself and the role,
read with plain fetches (no browser): the Posting's own text from its job
system's API (company.description), and when an Application has essays, the
pages its questions link to and the company's own site (company.gather)."""

import json
import threading
import time

import pytest

from apply import company
from apply.model import Posting, Question

WHY = Question("q1", "Why do you want to join Inversion?", "textarea", required=True)


class Site:
    """Job servers and company sites as a map of URL to body. Any other URL fails, as a dead link does."""

    def __init__(self, pages: dict[str, bytes | str]):
        self.pages = {url: body.encode() if isinstance(body, str) else body for url, body in pages.items()}
        self.fetched: list[str] = []

    def fetch(self, url, body=None):
        self.fetched.append(url)
        if url not in self.pages:
            raise OSError(f"no page at {url}")
        return self.pages[url]


GREENHOUSE = Posting("gh", "Inversion", "Software Intern", "https://job-boards.greenhouse.io/inversionspace/jobs/4744391005")
GREENHOUSE_JOB = "https://boards-api.greenhouse.io/v1/boards/inversionspace/jobs/4744391005"


def test_a_greenhouse_postings_own_text_is_read_from_the_job_board_api():
    content = "&lt;p&gt;Interns build &lt;strong&gt;Arc&lt;/strong&gt;, our reentry vehicle&amp;rsquo;s flight software.&lt;/p&gt;"
    site = Site({GREENHOUSE_JOB: json.dumps({"title": "Software Intern", "content": content})})

    material = company.description(GREENHOUSE, site)

    assert material == "Interns build Arc, our reentry vehicle’s flight software."


def test_an_embedded_greenhouse_forms_text_is_read_from_its_board_too():
    embed = Posting("gh", "Inversion", "Software Intern",
                    "https://job-boards.greenhouse.io/embed/job_app?for=inversionspace&token=4744391005")
    site = Site({GREENHOUSE_JOB: json.dumps({"content": "&lt;p&gt;Interns build Arc.&lt;/p&gt;"}),
                 "https://boards-api.greenhouse.io/v1/boards/inversionspace": json.dumps({"content": "<p>Inversion builds Arc.</p>"})})

    assert company.description(embed, site) == "Interns build Arc."
    assert "Inversion builds Arc." in company.gather(embed, [WHY], site)


ASHBY = Posting("ab", "Ramp", "Software Engineer Intern", "https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245")


class AshbySite(Site):
    """Ashby answers its posting query (a POST) with the posting's description."""

    def __init__(self, description_html: str, pages=None):
        super().__init__(pages or {})
        self.description_html = description_html

    def fetch(self, url, body=None):
        if body and json.loads(body)["operationName"] == "ApiJobPosting":
            self.fetched.append(url)
            return json.dumps({"data": {"jobPosting": {"id": "x", "descriptionHtml": self.description_html}}}).encode()
        return super().fetch(url, body)


def test_an_ashby_postings_own_text_is_read_from_its_posting_query():
    site = AshbySite("<h1>About Ramp</h1><p>Ramp automates spend for 70,000+ companies.</p>")

    material = company.description(ASHBY, site)

    assert "About Ramp\nRamp automates spend for 70,000+ companies." in material


LEVER = Posting("lv", "Immuta", "Software Engineering Intern", "https://jobs.lever.co/immuta/19d612f7-5256-46e4-90ba-aa27c07a369d/apply")


def test_a_lever_postings_own_text_is_read_from_the_postings_api():
    site = Site({"https://api.lever.co/v0/postings/immuta/19d612f7-5256-46e4-90ba-aa27c07a369d": json.dumps({
        "description": "<div>Immuta is the Data Authorization Company.</div>",
        "lists": [{"text": "What you'll do", "content": "<li>Build policy enforcement in Go</li>"}],
        "additional": "<div>Interns present a project at the end of summer.</div>",
    })})

    material = company.description(LEVER, site)

    assert "Immuta is the Data Authorization Company." in material
    assert "What you'll do\nBuild policy enforcement in Go" in material
    assert "Interns present a project at the end of summer." in material


@pytest.mark.parametrize("url, api", [
    ("https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/Los-Angeles-California/XMLNAME-2027-Generative-Media-Researc_R0047179",
     "https://wd1.myworkdaysite.com/wday/cxs/snapchat/snap/job/Los-Angeles-California/XMLNAME-2027-Generative-Media-Researc_R0047179"),
    ("https://tmobile.wd1.myworkdayjobs.com/External/job/Bellevue-Washington/Summer-2027-Software-Engineering-Intern_REQ368322",
     "https://tmobile.wd1.myworkdayjobs.com/wday/cxs/tmobile/External/job/Bellevue-Washington/Summer-2027-Software-Engineering-Intern_REQ368322"),
    ("https://axiomspace.wd5.myworkdayjobs.com/en-US/External_Career_Site/job/Houston/Software-Engineering-Intern--Summer-2027-_JR100767/apply",
     "https://axiomspace.wd5.myworkdayjobs.com/wday/cxs/axiomspace/External_Career_Site/job/Houston/Software-Engineering-Intern--Summer-2027-_JR100767"),
])
def test_a_workday_postings_own_text_is_read_from_the_json_its_job_page_loads(url, api):
    site = Site({api: json.dumps({"jobPostingInfo": {
        "title": "Software Engineering Intern",
        "jobDescription": "<p><b>Minimum Qualifications:</b></p><ul><li>Currently pursuing a BS in Computer Science</li></ul>",
    }})})

    material = company.description(Posting("wd", "Snap", "Intern", url), site)

    assert "Minimum Qualifications:\nCurrently pursuing a BS in Computer Science" in material


def test_a_posting_on_any_other_job_system_has_no_api_text():
    posting = Posting("tl", "Peraton", "Software Intern", "https://peraton.taleo.net/careersection/ext/jobdetail.ftl?job=172061")

    assert company.description(posting, Site({})) == ""


def test_the_postings_own_text_is_no_company_material_every_call_has_it_already():
    site = Site({GREENHOUSE_JOB: json.dumps({"content": "&lt;p&gt;The role.&lt;/p&gt;"})})

    assert "The role." not in company.gather(GREENHOUSE, [WHY], site)
    assert GREENHOUSE_JOB not in site.fetched


def test_a_long_page_is_cut_to_its_cap():
    post = "https://example.com/post"
    site = Site({post: "word " * 5_000})

    material = company.gather(GREENHOUSE, [Question("q2", f"Read {post}", "textarea", True)], site)

    assert 5_000 < len(material) < company.SOURCE_CHARS + 200


def test_a_page_the_question_description_links_to_is_read():
    post = "https://example.com/post"
    site = Site({post: "Our post on multiplayer editing."})
    linked = Question("q2", "What did you think of our post?", "textarea", True, description=f"Read our post ({post}).")

    assert "multiplayer editing" in company.gather(GREENHOUSE, [linked], site)


def test_nothing_read_is_no_material_at_all():
    assert company.gather(GREENHOUSE, [WHY], Site({})) == ""


def test_a_page_an_essay_question_links_to_is_read():
    post = "https://sep.com/blog/a-million-lines-of-markdown-and-no-code/"
    question = Question("q2", f"Read our AI lead's post ({post}). What would you do differently?", "textarea", True)
    site = Site({post: "<article><p>The system is grading its own homework at every level.</p></article>"})

    material = company.gather(GREENHOUSE, [WHY, question], site)

    assert f'<source from="{post}">\nThe system is grading its own homework at every level.\n</source>' in material


def test_a_greenhouse_companys_board_introduction_is_read_as_its_about_page():
    site = Site({
        GREENHOUSE_JOB: json.dumps({"content": "&lt;p&gt;The role.&lt;/p&gt;"}),
        "https://boards-api.greenhouse.io/v1/boards/inversionspace": json.dumps(
            {"name": "Inversion", "content": "<h2>Turning Space into a Transportation Layer for Earth</h2>"}),
    })

    material = company.gather(GREENHOUSE, [WHY], site)

    assert '<source from="the company\'s own site">\nTurning Space into a Transportation Layer for Earth' in material


def test_an_ashby_companys_homepage_is_read_from_the_website_ashby_names():
    site = AshbySite("<p>The role.</p>", {"https://ramp.com": "<main><h1>Save time and money with Ramp</h1></main>"})
    real = site.fetch

    def fetch(url, body=None):
        if body and json.loads(body)["operationName"] == "ApiOrganizationFromHostedJobsPageName":
            return json.dumps({"data": {"organization": {"name": "Ramp", "publicWebsite": "https://ramp.com"}}}).encode()
        return real(url, body)
    site.fetch = fetch

    material = company.gather(ASHBY, [WHY], site)

    assert "Save time and money with Ramp" in material


def test_all_sources_together_are_cut_to_the_total_cap():
    links = [f"https://example.com/post-{n}" for n in range(6)]
    question = Question("q2", "Pick one: " + " ".join(links), "textarea", True)
    site = Site({link: "word " * 2_000 for link in links})

    material = company.gather(GREENHOUSE, [question], site)

    assert len(material) <= company.TOTAL_CHARS + 500
    assert links[0] in material and links[-1] not in material


def test_a_source_that_does_not_answer_in_time_is_left_out(monkeypatch):
    monkeypatch.setattr(company, "DEADLINE", 0.2)
    slow = "https://slow.example.com/blog"
    released = threading.Event()

    class SlowSite(Site):
        def fetch(self, url, body=None):
            if url == slow:
                released.wait(5)
            return super().fetch(url, body)

    fast = "https://fast.example.com/blog"
    site = SlowSite({fast: "In time.", slow: "Too late."})
    question = Question("q2", f"See {fast} and {slow}", "textarea", True)
    started = time.monotonic()

    material = company.gather(GREENHOUSE, [question], site)

    released.set()
    assert time.monotonic() - started < 2
    assert "In time." in material and "Too late." not in material


WORKABLE = Posting("wk", "Scout Clean Energy", "Geospatial Intern", "https://apply.workable.com/scout-clean-energy/j/7BF0CEDF9F/apply")
WORKABLE_JOB = "https://apply.workable.com/api/v2/accounts/scout-clean-energy/jobs/7BF0CEDF9F"
WORKABLE_ACCOUNT = "https://apply.workable.com/api/v1/accounts/scout-clean-energy?full=true"


def test_a_workable_postings_own_text_is_read_from_its_job_api():
    site = Site({WORKABLE_JOB: json.dumps({
        "title": "Geospatial Intern", "description": "<p>Scout develops wind and solar projects.</p>",
        "requirements": "<ul><li>ArcGIS Pro</li></ul>", "benefits": "<p>Paid internship.</p>"})})

    material = company.description(WORKABLE, site)

    assert "Scout develops wind and solar projects.\nArcGIS Pro\nPaid internship." in material


def test_a_workable_companys_homepage_is_read_from_the_website_workable_names():
    site = Site({
        WORKABLE_JOB: json.dumps({"title": "Geospatial Intern", "description": "<p>The role.</p>"}),
        WORKABLE_ACCOUNT: json.dumps({"name": "Scout Clean Energy", "url": "https://scoutcleanenergy.com"}),
        "https://scoutcleanenergy.com": "<main><h1>Clean energy for the next century</h1></main>",
    })

    material = company.gather(WORKABLE, [WHY], site)

    assert "Clean energy for the next century" in material
