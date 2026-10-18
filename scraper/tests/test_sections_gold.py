"""The section parser scored against a gold test set (KAN-229, 2026-10-17).

`fixtures/sections_gold.json` holds real postings, one per company, each line
labeled with the section it belongs to by what it says, in two groups scored apart:

- **Boards** (50, `ats` greenhouse, ashby or lever): 46 drawn at random from the
  2026-10-16 feed; Tenstorrent, Perpay, TensorWave and Neuralink were added
  because a review found them misparsed. Drafted blind (without seeing the
  parser's answer) by five model-assisted labelers and spot-checked by hand.
- **Workday** (30, `ats` workday, 2026-10-17): drawn at random, one per company,
  from the jobs stored that day. Workday is 74% of the stored jobs and had no
  posting here, so the boards' score said nothing about most of the feed. Each
  line was labeled blind by two model-assisted labelers; a third settled the
  lines they disagreed on, and a sample was checked by hand.

Every label follows one guide (`docs/sections-gold-guide.md`). Treat a
disagreement as a question about the label as well as the parser.

`roles` is each line's role in the posting's HTML, as the scraper reads it
(`providers.plain_lines`), so the parser is scored on what it sees in production:
re-read from each provider on 2026-10-17, matched line by line where a posting
had changed, and null for Ashby (which the scraper reads as plain text) and for
postings that had closed.

Two scores, each group with its own floors:

- **Where each line shows** (`labels`): under which fixed heading, in the
  unlabeled intro, or left out. Every other section test checks one case; this one
  says how often the parser is right across real postings, so a change that fixes
  one posting and breaks five others shows here.
- **Job text hidden** (`kept`): the share of the lines that say what the job is
  (gold Overview, Responsibilities, Requirements, Preferred Qualifications) that
  the stored text leaves out. The first score misses what a student loses: it never
  sees a posting kept whole, and it scores SharkNinja's duties filed with its
  company pitch, every one gone from the page, like any stray line.

The floors are the scores when each was set: raise a floor and lower a ceiling
when the parser improves, never the reverse to let a change through. One trade is
recorded: on 2026-10-17 the boards' placement floor and Responsibilities ceiling
gave way so less job text is hidden (`docs/sections.md`, "Hiding less job text").

For the full report, from `scraper/`:
`uv run --no-project --python 3.12 --with pytest python -m tests.test_sections_gold`.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from workit_scraper.sections import INTRO, _walk, kept, labels

GOLD = Path(__file__).parent / "fixtures" / "sections_gold.json"

#: Where a section's lines show on the job page.
SHOWN = {
    "role": "Overview",
    "responsibilities": "Responsibilities",
    "requirements": "Requirements",
    "preferred": "Preferred Qualifications",
    "pay": "Pay",
    "logistics": "Details",
    INTRO: "intro",
}
#: The sections the job page never shows.
LEFT_OUT = {"company", "benefits", "legal", "apply"}
#: Where the job page says what the job is.
JOB = {"Overview", "Responsibilities", "Requirements", "Preferred Qualifications"}


def place(section: str) -> str:
    return SHOWN.get(section, "left out")


def fits(predicted: str, gold: str) -> bool:
    """A line is in the right place when it shows where its gold section shows. The
    intro has no heading and claims nothing, so a company or role line there is not
    misfiled, only unlabeled."""
    if predicted == gold:
        return True
    return predicted == "intro" and gold in ("intro", "Overview", "left out")


def _bare(line: str) -> str:
    """A line as the stored text holds it, to compare by: no list bullet, single spaces."""
    return " ".join(line.strip().lstrip("•").split())


def hidden(posting: dict, roles: tuple[str | None, ...] | None) -> tuple[int, int]:
    """(job lines the stored text leaves out, job lines) in one posting. A job line
    is one its gold label shows under `JOB`; a line the parser reads as a heading is
    not stored text, so it is not counted. An inline label's line is stored as its
    text alone, so a longer stored line it ends with counts as it."""
    stored = {_bare(line) for line in (kept(posting["text"], roles) or "").split("\n")}
    headings = {line.index for line in _walk(posting["text"], roles) if line.opens}
    missing = total = 0
    lines = zip(posting["text"].split("\n"), posting["labels"], strict=True)
    for index, (line, gold) in enumerate(lines):
        if gold is None or index in headings or place(gold) not in JOB:
            continue
        total += 1
        bare = _bare(line)
        missing += bare not in stored and not any(bare.endswith(s) and len(s) > 15 for s in stored)
    return missing, total


def postings(group: str) -> list[dict]:
    """The gold postings of one group: "workday", or "boards" for every other."""
    every = json.loads(GOLD.read_text())
    return [p for p in every if (p["ats"] == "workday") == (group == "workday")]


def score(group: str = "boards") -> dict:
    right = total = missing = job_lines = 0
    shown_as: Counter[tuple[str, str]] = Counter()  # (predicted place, gold place)
    for posting in postings(group):
        roles = tuple(posting["roles"]) if posting.get("roles") else None
        found = labels(posting["text"], roles)
        for index, gold in enumerate(posting["labels"]):
            if gold is None or found[index] is None:
                continue
            predicted, truth = place(found[index]), place(gold)
            total += 1
            right += fits(predicted, truth)
            shown_as[(predicted, truth)] += 1
        gone, lines = hidden(posting, roles)
        missing += gone
        job_lines += lines
    headings = [h for h in SHOWN.values() if h != "intro"]
    per_heading = {}
    for h in headings:
        shown = sum(n for (p, _), n in shown_as.items() if p == h)
        wrong = sum(n for (p, g), n in shown_as.items() if p == h and g != h)
        belongs = sum(n for (_, g), n in shown_as.items() if g == h)
        missed = sum(n for (p, g), n in shown_as.items() if g == h and p != h)
        per_heading[h] = {
            "shown": shown,
            "wrong": wrong / shown if shown else 0.0,
            "belongs": belongs,
            "missed": missed / belongs if belongs else 0.0,
        }
    return {
        "lines": total,
        "accuracy": right / total,
        "hidden": missing / job_lines,
        "per_heading": per_heading,
        "pairs": shown_as,
    }


@pytest.fixture(scope="module")
def result() -> dict:
    return score("boards")


@pytest.fixture(scope="module")
def workday() -> dict:
    return score("workday")


def test_every_gold_posting_is_labeled_whole() -> None:
    for posting in json.loads(GOLD.read_text()):
        lines = posting["text"].split("\n")
        assert len(posting["labels"]) == len(lines), posting["apply_url"]
        for line, gold in zip(lines, posting["labels"], strict=True):
            assert (gold is None) == (not line.strip()), (posting["apply_url"], line)
        if posting.get("roles") is not None:
            assert len(posting["roles"]) == len(lines), posting["apply_url"]


def test_line_accuracy_holds(result: dict) -> None:
    assert result["accuracy"] >= ACCURACY_FLOOR


@pytest.mark.parametrize("heading", ["Responsibilities", "Requirements", "Pay"])
def test_wrong_content_under_a_core_heading_stays_rare(result: dict, heading: str) -> None:
    assert result["per_heading"][heading]["wrong"] <= WRONG_CEILING[heading]


def test_workday_line_accuracy_holds(workday: dict) -> None:
    assert workday["accuracy"] >= WORKDAY_ACCURACY_FLOOR


@pytest.mark.parametrize("heading", ["Responsibilities", "Requirements", "Pay"])
def test_workday_wrong_content_under_a_core_heading_stays_rare(workday: dict, heading: str) -> None:
    assert workday["per_heading"][heading]["wrong"] <= WORKDAY_WRONG_CEILING[heading]


def test_job_text_stays_stored(result: dict) -> None:
    assert result["hidden"] <= HIDDEN_CEILING


def test_workday_job_text_stays_stored(workday: dict) -> None:
    assert workday["hidden"] <= WORKDAY_HIDDEN_CEILING


#: The scores, raised as the parser improved (see the module docstring), 2026-10-17.
#: Boards: 80.3% of 1,724 lines shown where they belong when written; of the lines
#: shown under Responsibilities, Requirements and Pay, 18.4%, 10.9% and 20.0% belonged
#: elsewhere. Workday, when added: 66.6% of 1,346 lines; 13.8%, 33.7% and 41.7%.
#: With the HTML's structure and the Workday audit's headings (`docs/sections.md`):
#: boards 82.0%; 16.0%, 10.2% and 13.0%. Workday 70.1%; 10.7%, 22.1% and 41.7%.
#: With what a line says (fix 4): boards 82.5%; 15.5%, 8.7% and 13.0%. Workday
#: 72.0%; 6.2%, 19.0% and 41.7%.
#: Hiding less job text (the module docstring's trade): boards 81.7%, with 3.7% of
#: job lines hidden (6.9% before); 18.7%, 8.7% and 13.0%. Workday 72.6%, with 5.2%
#: hidden (9.0% before); 6.2%, 19.0% and 41.7%.
ACCURACY_FLOOR = 0.815
WRONG_CEILING = {"Responsibilities": 0.19, "Requirements": 0.09, "Pay": 0.135}
HIDDEN_CEILING = 0.04
WORKDAY_ACCURACY_FLOOR = 0.725
WORKDAY_WRONG_CEILING = {"Responsibilities": 0.065, "Requirements": 0.195, "Pay": 0.42}
WORKDAY_HIDDEN_CEILING = 0.055


def report() -> None:
    for group in ("boards", "workday"):
        r = score(group)
        print(f"{group}: {r['lines']} lines, {r['accuracy']:.1%} shown where they belong")
        print(f"{r['hidden']:.1%} of the job lines left out of the stored text\n")
        print(f"{'heading':26} {'shown':>6} {'wrong':>7} {'belongs':>8} {'missed':>7}")
        for h, s in r["per_heading"].items():
            print(f"{h:26} {s['shown']:6} {s['wrong']:7.1%} {s['belongs']:8} {s['missed']:7.1%}")
        print("\nmost common misplacements (shown as <- belongs in):")
        for (p, g), n in r["pairs"].most_common():
            if not fits(p, g):
                print(f"  {n:4}  {p:26} <- {g}")
        print()


if __name__ == "__main__":
    report()
