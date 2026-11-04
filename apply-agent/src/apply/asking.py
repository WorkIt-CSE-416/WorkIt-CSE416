"""What Apply checks before it asks Lisul a question.

`known` finds what Apply already holds for a question (the Applicant
profile, the Answer bank, the Story bank, the resume's links), so a question
he has answered somewhere is answered from it and never reaches him."""

import re
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from apply import home as data_folder
from apply.answer_bank import AnswerBank, key
from apply.model import one_line
from apply.profile import ANSWERED, ApplicantProfile

# --- What Apply already knows --------------------------------------------------

# A question that asks for links, and the kinds of link it names.
LINK_ASK = re.compile(r"\b(?:urls?|links?|github|linked\s?in|portfolio|website|repo\w*|source code)\b", re.IGNORECASE)
KINDS = {"github": re.compile(r"github", re.IGNORECASE), "linkedin": re.compile(r"linked\s?in", re.IGNORECASE),
         "site": re.compile(r"portfolio|website|personal site", re.IGNORECASE),
         "repo": re.compile(r"\brepo\w*|source code|project|firmware|demo", re.IGNORECASE)}
# Which known link holds each kind: "github" is a profile, not a repo.
HOLDS = {"github": re.compile(r"github\.com/[^/\s]+/?(?:\s|$)", re.IGNORECASE), "linkedin": re.compile(r"linkedin\.com/", re.IGNORECASE),
         "site": re.compile(r"^(?:Portfolio|Website):", re.IGNORECASE),
         "repo": re.compile(r"(?:github|gitlab|bitbucket)\.(?:com|org)/[^/\s]+/[^/\s)]+", re.IGNORECASE)}
URL = re.compile(r"https?://[^\s)<>\]]+")
# The profile's link fields by their name in a line ("GitHub: https://...").
LINK_NAMES = {"github_url": "GitHub", "linkedin_url": "LinkedIn", "portfolio_url": "Portfolio",
              "google_scholar_url": "Google Scholar", "x_twitter_url": "X", "showcase_project_url": "Project"}


def links(profile: ApplicantProfile) -> tuple[str, ...]:
    """Every link of the applicant's Apply holds, one "what: url" line each:
    the profile's `links`, each Story bank line with a URL in it, and each
    link on the resume PDF with the words it is on. A URL two of them give
    is listed once, from the Story bank or the resume, whose words say what it is."""
    own = [f"{LINK_NAMES.get(name, name.removesuffix('_url').replace('_', ' ').title())}: {url}"
           for name, url in (profile.get("links") or {}).items() if isinstance(url, str) and url.strip()]
    bank = data_folder.STORY_BANK.read_text() if data_folder.STORY_BANK.is_file() else ""
    stories = [one_line(line).lstrip("-* ") for line in bank.splitlines() if URL.search(line)]
    pdf = profile.get("files.resume_pdf")
    on_resume = [f"{words} (on the resume): {url}" for words, url in
                 (resume_links(pdf, pdf.stat().st_mtime) if isinstance(pdf, Path) and pdf.is_file() else ())]
    seen, kept = set(), []
    for line in stories + on_resume + own:  # one line a URL: the one that says what it is, when two give it
        urls = {re.sub(r"^https?://(?:www\.)?", "", url).rstrip("/").casefold() for url in URL.findall(line)}
        if urls - seen:
            kept.append(line)
        seen |= urls
    return tuple(kept)


@lru_cache(maxsize=4)
def resume_links(pdf: Path, mtime: float) -> tuple[tuple[str, str], ...]:
    """(the words a link is on, its URL) of each web link in the PDF; () when it can't be read."""
    from pypdf import PdfReader
    found = []
    try:
        for page in PdfReader(pdf).pages:
            runs = []
            page.extract_text(visitor_text=lambda text, cm, tm, *_: text.strip() and runs.append(
                (tm[4] * cm[0] + cm[4], tm[5] * cm[3] + cm[5], text)))
            for annot in page.get("/Annots") or []:
                annot = annot.get_object()
                url = str((annot.get("/A") or {}).get("/URI") or "")
                if not url.startswith(("http://", "https://")):
                    continue
                x0, y0, x1, y1 = (float(v) for v in annot["/Rect"])
                words = one_line("".join(t for x, y, t in runs if x0 - 2 <= x <= x1 and y0 - 2 <= y <= y1 + 2))
                found.append((words or url, url))
    except Exception:
        return ()
    return tuple(dict.fromkeys(found))


def known(asked: str, profile: ApplicantProfile, bank: AnswerBank | None = None) -> tuple[str, ...]:
    """What Apply already holds that answers `asked`, a line a fact; () when
    it holds nothing, and Lisul must be asked. An answer Lisul gave before
    (the profile's answered questions, the Answer bank, a Story bank line
    from an earlier Essay fact) answers the same question. A question for
    links is answered by the links Apply holds when each kind it names
    (GitHub, LinkedIn, a site, a repo) is among them: those of its kinds."""
    from apply.essays import ASK  # imported here: essays imports this module
    asked = one_line(asked.removeprefix(ASK))
    if not asked:
        return ()
    answered = {key(q): a for q, a in (profile.get(ANSWERED) or {}).items() if a not in (None, "", [])}
    if key(asked) in answered:
        return (_shown(answered[key(asked)]),)
    if bank and (entry := bank.get(asked)) and entry.answer:
        return (_shown(entry.answer),)
    story_bank = data_folder.STORY_BANK.read_text() if data_folder.STORY_BANK.is_file() else ""
    if line := next((one_line(line)[2:] for line in story_bank.splitlines()
                     if one_line(line).casefold().startswith(f"- {asked}".casefold())), ""):
        return (line,)
    if not LINK_ASK.search(asked):
        return ()
    held = links(profile)
    kinds = [kind for kind, named in KINDS.items() if named.search(asked)] or ["repo"]
    fit = {kind: [line for line in held if HOLDS[kind].search(line)] for kind in kinds}
    return tuple(dict.fromkeys(line for kind in kinds for line in fit[kind])) if all(fit.values()) else ()


def value(facts: Sequence[str]) -> str:
    """Known facts as a form field's answer: their URLs alone when they are links."""
    urls = [url for line in facts for url in URL.findall(line)]
    return " ".join(dict.fromkeys(urls)) if urls and len(urls) >= len(facts) else "\n".join(facts)


def _shown(answer: object) -> str:
    return ", ".join(map(str, answer)) if isinstance(answer, list) else str(answer)

