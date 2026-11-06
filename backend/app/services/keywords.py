"""
A job posting's keywords and a built resume's keyword match (KAN-215).

The model extracts at most `MAX_KEYWORDS` keywords from a posting, each
required or preferred, once: they are cached on the posting
(`job_postings.keywords`) with the SHA-256 of the text the model read
(`keywords_hash`): the title and the description's job part (`job_part`),
not its perks or the company's pitch. A cache whose hash differs is stale
and extracted again, so a company's edit to the job or its title is caught
too, an edit to Benefits alone costs no call, and a change to `job_part`'s
rules refreshes every cache it touches. The feed import still clears both when it changes a
description at all.

Extraction runs ahead of any student where it can: the feed import fills
scraped postings with no keywords after it commits, and a company job is
read in the background once it is saved as published. `ensure` is the
fallback for a posting neither has reached yet.

The match is pure: a keyword matches when it appears, ignoring case, as a
whole word or phrase in the text the built resume shows (the view) or in its
shown skills.
"""

import hashlib
import re

from workit_scout.identity import Identity
from workit_scout.llm import LLM

from app.models.jobs import Job_Post
from app.schemas.keywords import Keyword, KeywordReading
from app.services.matching.embeddings import job_part
from app.services.resume_view import ResumeView

MAX_KEYWORDS = 20
_MAX_LENGTH = 60
# The model sees at most this much of a description.
MAX_DESCRIPTION_CHARS = 12_000

# One frozen string, so providers can cache it as a prefix; the posting goes
# in a message after it.
PROMPT = """\
You read a job posting and list the keywords a resume for it should show: \
skills, tools, languages, coding languages, coding frameworks, and qualifications. Answer \
with JSON only: {"keywords": [{"keyword": ..., "kind": "required" | \
"preferred"}]}.

- At most 20 keywords, choose the most important ones.
- kind is "required" when the posting asks for it such as in the Requirements section, "preferred" when \
it says nice to have, a plus, preferred or bonus, usually written under Preferred Qualifications section
- Use the posting's own words, short, capitalized as a resume's skills list \
writes them: "Python", "REST APIs", "SQL", "User Research". No \
soft skills ("team player"),no degree names, no benefits, no company names, and exclude conference names if the job is asking for publications in those. \
"""

# How a resume writes what a posting often leaves in lower case. The prompt
# asks the model for this too, but thousands of postings were read before it,
# and their keywords stay cached.
# ponytail: a list, so an acronym it lacks reads "Xyz"; the model's own casing
# covers every posting read from now on.
_CASED = {word.lower(): word for word in (
    ".NET", "2D", "3D", "AI", "API", "APIs", "AR", "AWS", "B2B", "B2C", "BI", "CAD", "CD", "CI", "CMS", "CRM", "CSS",
    "DevOps", "ERP", "ETL", "FastAPI", "GCP", "GitHub", "GitLab", "GraphQL", "HTML", "HTTP", "IoT", "JSON", "JUnit",
    "JavaScript", "KPI", "KPIs", "LLM", "LLMs", "ML", "MongoDB", "MySQL", "NLP", "NoSQL", "OOP", "PHP", "PostgreSQL",
    "PowerPoint", "PyTorch", "QA", "R&D", "REST", "SAP", "SDK", "SEO", "SQL", "SaaS", "TensorFlow", "TypeScript", "UI",
    "UML", "UX", "VR", "XML", "YAML", "iOS", "macOS",
)}
_SMALL = frozenset({"a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"})
_WORD = re.compile(r"[^\s/,()-]+")


def resume_case(keyword: str) -> str:
    """A keyword as a resume prints it: "user research" to "User Research",
    "sql" to "SQL". Only a word wholly in lower case changes, so a posting's
    own "iOS" stays. The match ignores case, so it never changes what matches,
    and a picked keyword joins the resume's skills as this."""
    def cased(match: re.Match[str]) -> str:
        word = match[0]
        if word != word.lower():
            return word
        if word in _SMALL and match.start() > 0:
            return word
        return _CASED.get(word, word[0].upper() + word[1:])

    return _WORD.sub(cased, keyword)


def _text(title: str, description: str | None) -> str:
    """What the model reads of a posting: its title and its job part, cut to size."""
    part = job_part(description, keep_headings=True)[:MAX_DESCRIPTION_CHARS]
    return f"{title}\n\n{part}".strip()


def posting_text_hash(title: str, description: str | None) -> str:
    """The cache's hash: of the text the model reads. The feed import stores
    it on Core rows and `cached` checks it on a posting, so the two always
    agree; an import that hashed the description alone left every cache it
    filled stale to Tailor."""
    return hashlib.sha256(_text(title, description).encode()).hexdigest()


def posting_hash(job: Job_Post) -> str:
    return posting_text_hash(job.title, job.description)


def cached(job: Job_Post) -> list[Keyword] | None:
    """The posting's cached keywords, or None when there are none or they
    came from another title or description."""
    if job.keywords is None or job.keywords_hash != posting_hash(job):
        return None
    return [Keyword.model_validate({**k, "keyword": resume_case(k["keyword"])}) for k in job.keywords]


def _cleaned(reading: KeywordReading) -> list[Keyword]:
    seen: set[str] = set()
    out: list[Keyword] = []
    for item in reading.keywords:
        word = resume_case(" ".join(item.keyword.split())[:_MAX_LENGTH].strip())
        if not word or word.casefold() in seen:
            continue
        seen.add(word.casefold())
        out.append(Keyword(keyword=word, kind=item.kind))
    return out[:MAX_KEYWORDS]


async def read(title: str, description: str | None, llm: LLM) -> list[Keyword]:
    """The model's keywords for a posting with this title and description.
    A posting with no description is read from its title. Raises
    `ScoutUnavailable` (or `InvalidReply`) when no model answers or the
    answer fails the schema. The posting is no student's text, so the seam
    gets an empty Identity, which still removes any email, URL or phone. It
    reads the job's own sections (`job_part`), not the perks or the
    company's pitch kept after them. Takes plain values, so the feed import
    can call it on Core rows."""
    prompt = [{"role": "system", "content": PROMPT}, {"role": "user", "content": _text(title, description)}]
    return _cleaned(await llm.complete_json(prompt, KeywordReading, identity=Identity()))


async def extract(job: Job_Post, llm: LLM) -> list[Keyword]:
    """The model's keywords for the posting. Raises like `read`."""
    return await read(job.title, job.description, llm)


def store(job: Job_Post, keywords: list[Keyword]) -> None:
    job.keywords = [k.model_dump() for k in keywords]
    job.keywords_hash = posting_hash(job)


async def ensure(job: Job_Post, llm: LLM) -> tuple[list[Keyword], bool]:
    """The posting's keywords and whether they were just extracted: the
    cache, else the model's, stored on the posting (the caller commits it).
    The keyword match and Tailor both read keywords through this; which
    use an extraction spends stays theirs. Raises like `extract`."""
    found = cached(job)
    if found is not None:
        return found, False
    found = await extract(job, llm)
    store(job, found)
    return found, True


def _shown_text(view: ResumeView) -> str:
    parts: list[str] = []
    for section in view.sections:
        for e in section.entries:
            parts += [e.title, e.organization, e.location, e.degree, e.field_of_study,
                      e.honors, e.issuer, *e.coursework, *(b.text for b in e.bullets)]
    parts += [s.name for s in view.skills]
    return "\n".join(p for p in parts if p)


def _shows(text: str, keyword: str) -> bool:
    # Whole words only, so "Go" is not found in "Django"; the lookarounds,
    # not \b, so a keyword ending in a symbol ("C++", "C#") still matches.
    words = r"\s+".join(re.escape(w) for w in keyword.split())
    return re.search(rf"(?<!\w){words}(?!\w)", text, re.IGNORECASE) is not None


def match(view: ResumeView, keywords: list[Keyword]) -> tuple[list[Keyword], list[Keyword]]:
    """(matched, missing), each with the required keywords first."""
    text = _shown_text(view)
    ordered = sorted(keywords, key=lambda k: k.kind != "required")
    matched = [k for k in ordered if _shows(text, k.keyword)]
    missing = [k for k in ordered if not _shows(text, k.keyword)]
    return matched, missing


def in_experiences(everything: ResumeView, missing: list[Keyword]) -> list[str]:
    """The missing keywords the student's whole bank already shows: in an
    entry, a bullet or a skill of their Experiences, though not on the resume
    being tailored (KAN-587). `everything` is the bank with every item shown
    (`resume_view.all_chosen`), read by the same whole-word rule as `match`.

    Tailor's keyword step groups these first, as skills the student has
    shown, so picking one claims nothing new. Nothing picks them in bulk: a
    pick is still the student's own click (frontend/docs/screens.md)."""
    text = _shown_text(everything)
    return [k.keyword for k in missing if _shows(text, k.keyword)]
