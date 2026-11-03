"""
Label the resume headings no rule names, with a model, once each:

    uv run python -m app.scripts.label_resume_headings            # data/resume_heading_candidates.txt
    uv run python -m app.scripts.label_resume_headings --dry-run  # list them, ask nothing

`app/utils/resume_parser.py` names a section by its heading's words. A heading
no rule names is no section, and its text joins the section above it. This asks
a model which section each candidate opens, or that it opens none, and writes
the answers to `app/utils/learned_headings.json`, which the parser reads after
its rules. Review the diff before committing it: a body line labeled as a
heading splits a section, and a wrong "other" drops its section's text.

The candidates are a word list (`data/resume_heading_candidates.txt`), never a
student's resume: the job pages' labeler (`../scraper/label_headings.py`) reads
public postings, but a heading-shaped line on a resume can be the student's
name, school or employer, and ADR 0003 keeps the model off a resume the
student has not asked it to read. Only candidates with no answer yet are asked.

Groq's OpenAI-style API, `openai/gpt-oss-20b` by default (`HEADINGS_MODEL`), as
the scraper's labeler, with `GROQ_API_KEY` from the environment or the root
`.env`: the scraper's key, never one Scout's chain uses, so a run never spends
Scout's daily quota.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

from app.config import ENV_FILE
from app.utils import resume_parser
from app.utils.resume_parser import (
    LEARNED_LABELS,
    LEARNED_PATH,
    heading_form,
    learned_key,
    section_of,
)

CANDIDATES = Path(__file__).resolve().parents[2] / "data" / "resume_heading_candidates.txt"
ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-oss-20b"
BATCH = 50
# Groq's free tier allows about 30 requests a minute.
PAUSE_S = 2.5

#: What each label means, as the model is told. The keys are `LEARNED_LABELS`.
MEANINGS = {
    "education": "schools, degrees, courses and training",
    "experience": "jobs, internships, co-ops, lab and research roles, military service",
    "leadership": "clubs, student organizations, activities, sports, volunteering and service",
    "awards": "awards, honors, scholarships, grants and achievements",
    "skills": "skills, tools, languages and technologies",
    "projects": "projects, portfolios and open-source work",
    "certifications": "certifications, licenses and credentials",
    "publications": "papers, talks, presentations and patents",
    "other": "a real section none of the above holds: a summary, interests, contact details",
    "none": "not a section heading: a job title, a skill, a sentence or a value",
}

PROMPT = """You label the section headings of student resumes. Each line below is a \
heading a resume might use. For each, answer the one label that says which section \
it opens:

{meanings}

Answer "none" whenever the line is not clearly the title of a resume section. A \
wrong heading splits a section, so when unsure, answer "none".

Reply with JSON only: {{"labels": {{"<line exactly as given>": "<label>", ...}}}}

Lines:
{lines}"""


def candidates(path: Path = CANDIDATES) -> list[str]:
    """The list's headings that neither the rules nor a learned label name yet,
    in their heading form, each once."""
    found: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            continue
        heading = heading_form(line)
        key = learned_key(heading)
        if heading and section_of(heading) is None and key not in resume_parser.LEARNED:
            found.setdefault(key, heading)
    return list(found.values())


def keep(labels: dict[str, str], asked: list[str]) -> dict[str, str]:
    """A reply's labels for the lines asked; a label the model invents or a line
    it renames is dropped, so that line is asked again on the next run."""
    names = set(asked)
    return {name: label for name, label in labels.items() if name in names and label in LEARNED_LABELS}


def ask(names: list[str], key: str, model: str) -> dict[str, str]:
    meanings = "\n".join(f"- {label}: {meaning}" for label, meaning in MEANINGS.items())
    response = httpx.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "temperature": 0,
            "reasoning_effort": "low",
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": PROMPT.format(meanings=meanings, lines="\n".join(names))}],
        },
        timeout=60,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return keep(json.loads(content).get("labels", {}), names)


def existing() -> dict[str, str]:
    if not LEARNED_PATH.exists():
        return {}
    return dict(json.loads(LEARNED_PATH.read_text(encoding="utf-8")).get("labels", {}))


def save(labels: dict[str, str]) -> None:
    """The learned labels, sorted, so a new run's diff shows only what it added."""
    payload = {
        "_about": "Written by app/scripts/label_resume_headings.py; read by resume_parser.py after "
        "its rules. Review each label before committing (app/utils/CLAUDE.md, Learned headings).",
        "labels": dict(sorted(labels.items(), key=lambda item: item[0].casefold())),
    }
    LEARNED_PATH.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def groq_key() -> str | None:
    """GROQ_API_KEY from the environment, else from the root .env, which the
    app's settings do not read for this name."""
    if key := os.environ.get("GROQ_API_KEY"):
        return key
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "GROQ_API_KEY":
                return value.strip().strip("'\"") or None
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="list the headings, ask nothing")
    args = parser.parse_args(argv)

    names = candidates()
    print(f"{len(names)} headings no rule or learned label names")
    if args.dry_run:
        print("\n".join(f"  {name}" for name in names))
        return 0
    key = groq_key()
    if not key:
        print("Set GROQ_API_KEY.", file=sys.stderr)
        return 1
    model = os.environ.get("HEADINGS_MODEL", DEFAULT_MODEL)

    labels = existing()
    for start in range(0, len(names), BATCH):
        batch = names[start : start + BATCH]
        try:
            answered = ask(batch, key, model)
        except (httpx.HTTPError, ValueError, KeyError) as error:
            # Keep what came back: a run that stops at its quota resumes where it left.
            print(f"stopped after {start} of {len(names)}: {error}", file=sys.stderr)
            break
        labels.update(answered)
        save(labels)
        print(f"  {start + len(batch)}/{len(names)}: {len(answered)} labeled")
        time.sleep(PAUSE_S)
    print(f"{len(labels)} learned headings in {LEARNED_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
