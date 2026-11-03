"""A Posting whose own text places it only outside the US is Not eligible:
Lisul applies only to US roles. Requests and rehearsals skip the Feed's
location filter, so this is read from the Posting before its form opens."""

import json

import pytest

from apply import company
from apply.eligibility import not_eligible, outside_us
from apply.model import Posting


@pytest.mark.parametrize("text, abroad", [
    # Cloudflare (seen live): Greenhouse names the place only among its offices.
    ("Location: Lisboa, Lisboa, Portugal\nAvailable Terms", True),
    ("Location: London, UK; Toronto, ON, Canada", True),
    ("Locations: New York, NY; London, UK", False),  # one US office is enough
    ("Location: San Francisco, CA", False),
    ("Location: In-Office", False),  # no place named: the form decides
    ("Location: Remote", False),
    ("Location: Remote, Canada", True),
    ("Location: Dublin, CA", False),  # a US town named like a city abroad
    ("Location: London, Kentucky, United States", False),
    ("We have offices in Lisbon and New York.", False),  # only a Location line places the role
])
def test_a_posting_placed_only_abroad_is_ruled_out(text, abroad):
    assert bool(outside_us(text)) is abroad
    assert bool(not_eligible(text)) is abroad


def test_the_reason_names_the_place():
    assert "Lisboa, Lisboa, Portugal" in not_eligible("Location: Lisboa, Lisboa, Portugal")


def test_a_greenhouse_postings_text_names_its_offices():
    class Site:
        def fetch(self, url, body=None):
            assert url == "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs/8245197"
            return json.dumps({"location": {"name": "In-Office"}, "content": "&lt;p&gt;Interns build Workers.&lt;/p&gt;",
                               "offices": [{"name": "Lisbon, Portugal", "location": "Lisboa, Lisboa, Portugal"}]}).encode()

    text = company.description(Posting("c", "Cloudflare", "Intern", "https://job-boards.greenhouse.io/cloudflare/jobs/8245197"),
                               Site())

    assert text == "Location: Lisboa, Lisboa, Portugal\nInterns build Workers."
