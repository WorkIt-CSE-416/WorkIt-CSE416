"""Label the description headings no rule names, with a model, once each.

    GROQ_API_KEY=... python3 label_headings.py                   # gold set and feed snapshot
    GROQ_API_KEY=... python3 label_headings.py path/to/jobs.json # or any postings' JSON
    python3 label_headings.py --dry-run                          # list them, ask nothing

`workit_scraper/sections.py` names a section by its heading's words. A heading no
pattern names ("Role Purpose", "About the Work") is read as content, and its text
stays in the section before it: under a left-out one, it leaves the page. This
asks a model which section each such heading opens, or that it opens none, and
writes the answers to `workit_scraper/learned_headings.json`, which the parser
reads after its patterns. Review the diff before committing it: a list item
labeled as a heading splits its list.

Only headings with no answer yet are asked, so a run after the first asks about
new ones alone. The file is in git rather than asked for during the scrape: Groq
answers about 30 requests a minute, a scrape reads thousands of pages, and each
page is stored once, so a label that missed the run would miss that posting for
good.

Groq's OpenAI-style API, `openai/gpt-oss-20b` by default (`HEADINGS_MODEL`): a
production model, run with low reasoning effort. Groq's model page lists
`llama-3.1-8b-instant`, but a new free account had no access to it (2026-10-18).
Use a key of its own, not one Scout's chain uses, so a first run never spends
Scout's daily quota.
The standard library only, as the rest of this folder.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from workit_scraper import sections

HERE = Path(__file__).parent
DEFAULT_SOURCES = (
    HERE / "tests" / "fixtures" / "sections_gold.json",
    HERE.parent / "backend" / "data" / "feed.json",
)
ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-oss-20b"
BATCH = 50
# Groq's free tier allows about 30 requests a minute.
PAUSE_S = 2.5
# A 429 is the per-minute token limit (8,000 on gpt-oss-20b, about three batches):
# wait as Groq's retry-after says, this many times, before stopping the run.
RETRIES = 6

#: What each label means, as the model is told. The keys are `sections.SECTIONS`'.
MEANINGS = {
    "role": "what the role or team is: an overview or summary of the job",
    "responsibilities": "the duties: what the person will do",
    "requirements": "what the person must have: qualifications, skills, education, eligibility",
    "preferred": "what is nice to have: preferred or bonus qualifications",
    "pay": "the salary, wage or pay range",
    "logistics": "location, schedule, dates, duration, work arrangement",
    "company": "the company itself: its mission, story, values, culture",
    "benefits": "perks and benefits",
    "legal": "legal notices: equal opportunity, privacy, accommodations, fraud warnings",
    "apply": "how to apply and the interview process",
    sections.NOT_A_HEADING: (
        "not a section heading: a list item, a sentence, a skill, a job title or a value"
    ),
}

PROMPT = """You label the headings of job postings. Each line below is a short line \
from a job description that might be the heading of a section. For each, answer the \
one label that says which section it opens:

{meanings}

Answer "none" whenever the line is not clearly the title of a section, for example \
"Python", "Onsite gym", "Backend: Golang" or "Software Engineer". A wrong heading \
splits a section, so when unsure, answer "none".

Reply with JSON only: {{"labels": {{"<line exactly as given>": "<label>", ...}}}}

Lines:
{lines}"""


def postings(path: Path) -> list[tuple[str, tuple[str | None, ...] | None]]:
    """Each posting's description and, where the file has them, its lines' roles.
    Reads the gold set (a list), feed.json (a list or {"jobs"}) and jobs.json
    (jobs with a `page`)."""
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data.get("jobs", [])
    found = []
    for row in rows:
        page = row.get("page") or {}
        text = row.get("text") or row.get("description") or page.get("description")
        if text:
            roles = row.get("roles")
            found.append((text, tuple(roles) if roles else None))
    return found


def candidates(paths: list[Path]) -> Counter[str]:
    """Every heading no pattern or learned label names, with how many postings say it."""
    counts: Counter[str] = Counter()
    for path in paths:
        for text, roles in postings(path):
            counts.update(set(sections.unknown_headings(text, roles)))
    return counts


def ask(names: list[str], key: str, model: str) -> dict[str, str]:
    """One batch's labels from the model; a label it invents or a line it renames is
    dropped, so the batch's rest is asked again on the next run."""
    meanings = "\n".join(f"- {label}: {meaning}" for label, meaning in MEANINGS.items())
    body = {
        "model": model,
        "temperature": 0,
        "reasoning_effort": "low",
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "user",
                "content": PROMPT.format(meanings=meanings, lines="\n".join(names)),
            }
        ],
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "workit-scraper",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        reply = json.load(response)
    labels = json.loads(reply["choices"][0]["message"]["content"]).get("labels", {})
    asked = set(names)
    return {
        name: label
        for name, label in labels.items()
        if name in asked and label in sections.LEARNED_LABELS
    }


def _patiently(names: list[str], key: str, model: str) -> dict[str, str]:
    """`ask`, waiting out Groq's per-minute limit rather than stopping at it."""
    for attempt in range(RETRIES + 1):
        try:
            return ask(names, key, model)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == RETRIES:
                raise
            wait = float(error.headers.get("retry-after") or 30)
            print(f"  rate limited; waiting {wait:.0f}s")
            time.sleep(wait)
    raise AssertionError("unreachable")


def save(labels: dict[str, str], path: Path) -> None:
    """The learned labels, sorted, so a new run's diff shows only what it added."""
    payload = {
        "_about": "Written by scraper/label_headings.py; read by sections.py after its "
        "patterns. Review each label before committing (docs/sections.md, Learned headings).",
        "labels": dict(sorted(labels.items(), key=lambda item: item[0].casefold())),
    }
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def existing(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    return dict(json.loads(path.read_text(encoding="utf-8")).get("labels", {}))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("sources", nargs="*", type=Path, default=list(DEFAULT_SOURCES))
    parser.add_argument("--dry-run", action="store_true", help="list the headings, ask nothing")
    parser.add_argument("--limit", type=int, default=None, help="ask about this many at most")
    args = parser.parse_args(argv)

    counts = candidates([path for path in args.sources if path.exists()])
    names = [name for name, _ in counts.most_common(args.limit)]
    print(f"{len(counts)} headings no rule names; asking about {len(names)}")
    if args.dry_run:
        for name, count in counts.most_common(args.limit):
            print(f"{count:5}  {name}")
        return 0
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        print("Set GROQ_API_KEY.", file=sys.stderr)
        return 1
    model = os.environ.get("HEADINGS_MODEL", DEFAULT_MODEL)

    labels = existing(sections.LEARNED_PATH)
    for start in range(0, len(names), BATCH):
        batch = names[start : start + BATCH]
        try:
            answered = _patiently(batch, key, model)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as error:
            # Keep what came back: a run that stops at its quota resumes where it left.
            print(f"stopped after {start} of {len(names)}: {error}", file=sys.stderr)
            break
        labels.update(answered)
        save(labels, sections.LEARNED_PATH)
        print(f"  {start + len(batch)}/{len(names)}: {len(answered)} labeled")
        time.sleep(PAUSE_S)
    print(f"{len(labels)} learned headings in {sections.LEARNED_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
