"""The keywords and Tailor read only a posting's job sections (embeddings.job_part):
the extras the scraper keeps after them (Benefits, How to Apply, About the Company)
never steer what a resume is matched or tailored against. No database."""

import pytest

from app.models.jobs import Job_Post
from app.schemas.keywords import KeywordReading
from app.services import keywords, tailor
from app.services.matching.embeddings import job_part, job_text

pytestmark = pytest.mark.anyio


def test_qualification_labels_survive_section_filtering() -> None:
    description = (
        "Requirements\nPython\nPreferred Qualifications\nRust\nBenefits\nFree lunch"
    )
    assert job_part(description, keep_headings=True) == (
        "Requirements\nPython\nPreferred Qualifications\nRust"
    )
    assert job_text("Intern", description) == "Intern\n\nPython\nRust"


def test_empty_sections_do_not_replace_the_intro_with_headings() -> None:
    description = "Build robots.\nRequirements\n\nBenefits\nFree lunch"
    assert job_part(description, keep_headings=True) == "Build robots."

STORED = (
    "Overview\nJoin the firmware team.\nRequirements\nC and Rust.\n"
    "Benefits\nA 401(k) match and catered lunch.\n"
    "About the Company\nFigure builds humanoid robots."
)


class Recording:
    """An LLM that records the prompt it was sent and answers no keywords."""

    def __init__(self) -> None:
        self.sent = None

    async def complete_json(self, messages, schema, identity=None):
        self.sent = messages
        return KeywordReading(keywords=[])


async def test_the_keywords_read_the_job_sections_only() -> None:
    llm = Recording()
    await keywords.extract(Job_Post(title="Firmware Intern", description=STORED), llm)

    posting = llm.sent[-1]["content"]
    assert "C and Rust." in posting
    assert "401(k)" not in posting
    assert "humanoid" not in posting


def test_tailor_ranks_against_the_job_sections_only() -> None:
    text = tailor.posting_text(Job_Post(title="Firmware Intern", description=STORED), [])

    assert "C and Rust." in text
    assert "401(k)" not in text
    assert "humanoid" not in text
