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

Scored where a student sees each line: under which fixed heading, in the
unlabeled intro, or left out. Every other section test checks one case; this one
says how often the parser is right across real postings, so a change that fixes
one posting and breaks five others shows here. The floors are the scores when
this test was written; raise them when the parser improves, never lower them to
let a change through.

For the full report, from `scraper/`:
`uv run --no-project --python 3.12 --with pytest python -m tests.test_sections_gold`.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from workit_scraper.sections import INTRO, labels

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


def place(section: str) -> str:
    return SHOWN.get(section, "left out")


def fits(predicted: str, gold: str) -> bool:
    """A line is in the right place when it shows where its gold section shows. The
    intro has no heading and claims nothing, so a company or role line there is not
    misfiled, only unlabeled."""
    if predicted == gold:
        return True
    return predicted == "intro" and gold in ("intro", "Overview", "left out")


def postings(group: str) -> list[dict]:
    """The gold postings of one group: "workday", or "boards" for every other."""
    every = json.loads(GOLD.read_text())
    return [p for p in every if (p["ats"] == "workday") == (group == "workday")]


def score(group: str = "boards") -> dict:
    right = total = 0
    shown_as: Counter[tuple[str, str]] = Counter()  # (predicted place, gold place)
    for posting in postings(group):
        roles = posting.get("roles")
        found = labels(posting["text"], tuple(roles) if roles else None)
        for index, gold in enumerate(posting["labels"]):
            if gold is None or found[index] is None:
                continue
            predicted, truth = place(found[index]), place(gold)
            total += 1
            right += fits(predicted, truth)
            shown_as[(predicted, truth)] += 1
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
def test_workday_wrong_content_under_a_core_heading_stays_rare(
    workday: dict, heading: str
) -> None:
    assert workday["per_heading"][heading]["wrong"] <= WORKDAY_WRONG_CEILING[heading]


#: The scores, raised as the parser improved (see the module docstring), 2026-10-17.
#: Boards: 80.3% of 1,724 lines shown where they belong when written; of the lines
#: shown under Responsibilities, Requirements and Pay, 18.4%, 10.9% and 20.0% belonged
#: elsewhere. Workday, when added: 66.6% of 1,346 lines; 13.8%, 33.7% and 41.7%.
#: With the HTML's structure and the Workday audit's headings (`docs/sections.md`):
#: boards 82.0%; 16.0%, 10.2% and 13.0%. Workday 70.1%; 10.7%, 22.1% and 41.7%.
ACCURACY_FLOOR = 0.82
WRONG_CEILING = {"Responsibilities": 0.165, "Requirements": 0.105, "Pay": 0.135}
WORKDAY_ACCURACY_FLOOR = 0.70
WORKDAY_WRONG_CEILING = {"Responsibilities": 0.11, "Requirements": 0.225, "Pay": 0.42}


def report() -> None:
    for group in ("boards", "workday"):
        r = score(group)
        print(f"{group}: {r['lines']} lines, {r['accuracy']:.1%} shown where they belong\n")
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
