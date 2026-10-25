"""
Bringing a student's Apply writing into WorkIt (scripts/import_apply_profile.py):
their own essays and answers as writing samples, Apply's style card as
theirs, and Apply's company briefs through WorkIt's own page check. Against
this run's throwaway test database; every value here is made up.
"""

import pytest

from app.auto_apply import briefs
from app.schemas.writing import MAX_SAMPLES, SAMPLE_MAX
from app.services.page_fetch import Unreadable
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


BRIEF = """\
# Initrode Labs
Essays use each fact below as it is: edit or delete any of them.

## Company
Researched 2026-10-20

- **Stapler Cloud** (2026-09): Stapler Cloud keeps 40 offices' staplers in sync. https://initrodelabs.example/blog/stapler
- **Memo Search**: Memo Search finds any memo by what it says. https://initrodelabs.example/memo
- **TPS Engine** (2026-08): TPS Engine files reports on its own. https://initrodelabs.example/tps
- **Fax Bridge**: Fax Bridge sends faxes to email. https://initrodelabs.example/fax
- **Ghost Product**: Ghost Product does what no page says. https://initrodelabs.example/memo
- **Big Round** (2026-10, press: Daily Wire): Initrode raised 12 million dollars. https://techcrunch.com/initrode
- **Elsewhere**: Elsewhere is on a site Initrode doesn't own. https://blogs.example.org/initrode

## Team: ""
- **Nothing**: a section for no team is left out. https://initrodelabs.example/memo
"""

PAGES = {
    "https://initrodelabs.example/blog/stapler": "Stapler news. Today Stapler Cloud keeps staplers in 40 offices in sync across the world.",
    "https://initrodelabs.example/memo": "Meet Memo Search: it finds any memo you wrote by what it says inside.",
    "https://initrodelabs.example/tps": "Reports. TPS Engine files every TPS report on its own, with the new cover sheet. 2026",
}


async def test_company_briefs_come_only_with_facts_that_pass_workit_s_own_check(
    running, applicant, database, apply_dir, local_files, monkeypatch,
):
    async def fetch(url: str, allowed) -> str:
        if not allowed(url.split("/")[2]) or url not in PAGES:
            raise Unreadable("404")
        return PAGES[url]

    monkeypatch.setattr(briefs, "fetch_page", fetch)
    (apply_dir / "company-briefs").mkdir()
    (apply_dir / "company-briefs" / "initrode-labs.md").write_text(BRIEF)

    report = await _import(database, applicant, apply_dir)

    async with database() as session:
        kept = await briefs.brief_for(session, "Initrode Labs, Inc.")
    assert {f["fact"] for f in kept} == {
        "Stapler Cloud keeps 40 offices' staplers in sync.",
        "Memo Search finds any memo by what it says.",
        "TPS Engine files reports on its own.",
    }
    assert {f["published"] for f in kept} == {None, "2026-08"}  # a month counts only when its page shows the year
    assert all(f["url"].startswith("https://initrodelabs.example/") for f in kept)
    assert report.briefs == [{"company": "Initrode Labs", "team": None, "kept": 3, "dropped": 4, "saved": True,
                             "listed": False}]
