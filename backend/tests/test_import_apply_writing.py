"""
Bringing a student's Apply writing into WorkIt (scripts/import_apply_profile.py):
their own essays and answers as writing samples, and Apply's style card as
theirs. Against this run's throwaway test database; every value here is made up.
"""

import pytest

from app.schemas.writing import MAX_SAMPLES, SAMPLE_MAX
from tests import test_import_apply_profile as base

pytestmark = pytest.mark.anyio

# The profile import's fixtures: the API running, a student, an Apply folder, LOCAL_FILES_DIR
running, applicant, apply_dir, local_files = base.running, base.applicant, base.apply_dir, base.local_files
_get, _import = base._get, base._import

STORY_BANK = """\
# Story bank: Riley Example

## How Riley writes
- A note about Riley's voice, not Riley's words.

## Riley's own essays
Answers Riley wrote, kept word for word.

Initech, "Why Initech?" (Oct 2026):
> I want to build ledgers because I once lost a receipt.
>
> Then I wrote a small app that kept them all.

A long class essay, "On Bridges" (Spring 2026):
> {long}

## In Riley's words
- Why CS: Riley likes taking clocks apart (a paraphrase).

## Riley's own answers, word for word
Written by Riley for the Hooli prescreen, kept exactly.

**How do you test your code?**

I write the test first and watch it fail.

**What is a recent project?**

A bus timetable that texts you when the bus is late.

## Education
- Springfield State, BS Computer Science.
"""


async def test_the_student_s_own_essays_and_answers_come_as_samples_and_nothing_else(
    running, applicant, database, apply_dir, local_files,
):
    long = " ".join(f"Bridge paragraph {n} stands on its piers." for n in range(400))
    (apply_dir / "story-bank.md").write_text(STORY_BANK.replace("{long}", long))

    report = await _import(database, applicant, apply_dir)

    samples = [s["text"] for s in (await _get(applicant, "/writing-samples")).json()["samples"]]
    joined = "\n".join(samples)
    assert report.samples == len(samples)
    assert 0 < len(samples) <= MAX_SAMPLES and all(len(s) <= SAMPLE_MAX for s in samples)
    for own in ("I want to build ledgers because I once lost a receipt.", "Then I wrote a small app that kept them all.",
                "Bridge paragraph 0 stands on its piers.", "I write the test first and watch it fail.",
                "A bus timetable that texts you when the bus is late."):
        assert own in joined
    for not_own in ("Why Initech?", "How do you test your code?", "paraphrase", "kept word for word", "kept exactly",
                    "not Riley's words", "Springfield State", ">"):
        assert not_own not in joined


VOICE = """\
<!-- How Riley writes, measured from Riley's essays (made up). -->

# Style card: Riley

**Sentence length:** short, then one long one --> like this.
"""


async def test_apply_s_style_card_is_the_student_s_card_beside_their_samples(
    running, applicant, database, apply_dir, local_files,
):
    (apply_dir / "story-bank.md").write_text(STORY_BANK.replace("{long}", "A short essay."))
    (apply_dir / "voice.md").write_text(VOICE)

    report = await _import(database, applicant, apply_dir)
    await _import(database, applicant, apply_dir)  # again: the samples are the same, so the card stays

    body = (await _get(applicant, "/writing-samples")).json()
    assert report.style_card is True
    assert body["samples"]
    assert body["style_card"] == "# Style card: Riley\n\n**Sentence length:** short, then one long one --> like this."

