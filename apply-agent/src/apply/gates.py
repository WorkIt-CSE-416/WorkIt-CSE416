"""Code gates: the checks every essay must pass before it ships, in code,
deterministic and free (research/sources/answer-types/g-quality.md, 2.1).

Each gate gives a list of failures, as plain strings shown to Lisul at a
Hold; an empty list passes. answer() runs the gates on one answer:
  (a) length, in the form's own unit;
  (b) every number and name traced to the sources;
  (c) no other company named;
  (d) the swap test's code half, on company-facing types;
  (f) no 6-word run of the resume (the profile's resume PDF) in a not-on-resume answer;
  (g) the opener: no date, no restated question.
form() runs those across one form's answers: (e) the same project with
different numbers, and (h) two answers opening the same way.

Every gate leans toward passing when unsure: a false fail only holds an
Application for Lisul, but a gate that fails good answers gets ignored.
"""

import re
from collections.abc import Mapping
from functools import cache
from pathlib import Path

from pypdf import PdfReader

from apply import answering, brief, home, sameness, writing
from apply.essays import unsupported_numbers
from apply.model import Question, is_company

BRIEFS = brief.BRIEFS

UNDER = 0.6  # an answer under this share of its lower bound is too short
SINGLE_LINE = 255  # characters a single-line field takes (Greenhouse input_text)
SHORT_FIELD = 300  # a character cap at or under this is a short field: no lower bound
NO_FLOOR = {"anything-else", "cover-letter"}  # types with no lower bound (a letter keeps its template's shape)
RESUME_RUN = 6  # words in a row shared with the resume that count as copying it
RESTATED = 0.6  # share of the first sentence's words taken from the question that counts as restating it

COUNTS = {"one": 1, "a single": 1, "two": 2, "a couple of": 2, "three": 3, "four": 4, "five": 5, "a few": 3}
_NUM = r"(\d[\d,]*|one|two|three|four|five|a single|a couple of|a few)"
# "[\s-]*": a hyphenated limit counts too (Twitch's "(500-word limit)").
RANGE = re.compile(rf"\b{_NUM}\s*(?:-|–|to|or)\s*{_NUM}[\s-]*(?:short\s+)?(words?|sentences?|characters?|chars)\b", re.IGNORECASE)
SINGLE = re.compile(rf"\b{_NUM}[\s-]*(?:short\s+)?(words?|sentences?|characters?|chars)\b", re.IGNORECASE)
# The unit before the number: "Word limit: 260", "maximum character count of 1,500".
LIMIT = re.compile(r"\b(words?|characters?|chars)\s+(?:limit|maximum|max|count)\b\s*(?:is\s+|of\s+)?[:-]?\s*(\d[\d,]*)",
                   re.IGNORECASE)

WORD = re.compile(r"[A-Za-z0-9][\w'’-]*")
# A run of capitalized words: a name of two or more words ("Hitachi Rail", "Google Cloud Run").
NAME_RUN = re.compile(r"\b[A-Z][\w&+'’-]*(?:\s+(?:of\s+|&\s+)?[A-Z][\w&+'’-]*)+")
# One word with a capital inside it: a product or tool name ("PyTorch", "WorkIt").
CAMEL = re.compile(r"\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b")
# Words that open a sentence or a clause with a capital and are no part of a name.
OPENERS = {"a", "an", "the", "in", "at", "on", "for", "with", "during", "after", "before", "when", "while", "since",
           "because", "as", "my", "our", "his", "this", "that", "these", "then", "there", "it", "we", "i", "if", "so",
           "but", "and", "also", "from", "by", "to", "of", "both", "each", "every", "one", "what", "why", "how",
           "dear", "sincerely", "best", "thanks", "thank", "yes", "no"}
DATE = re.compile(r"\b(?:spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|"
                  r"september|october|november|december|(?:19|20)\d\d)\b", re.IGNORECASE)
STOP = OPENERS | {"you", "your", "me", "is", "are", "was", "were", "be", "been", "do", "did", "does", "have", "has",
                  "had", "would", "will", "can", "could", "like", "about", "tell", "us", "why", "which", "who", "am",
                  "not", "than", "into", "out", "up"}


# (a) Length.

def bounds(q: Question, kind: str) -> tuple[int, int, str]:
    """The length `q` asks for as (low, high, unit), the unit words, sentences
    or characters: a range or limit its label or description states, else its
    character cap (fill 80-100%), else a single-line field's 255 characters,
    else its Question type's default words. A stated word limit is filled
    75-100%; "a few sentences" means 3-4."""
    text = f"{q.label} {q.description}"
    if m := RANGE.search(text):
        low, high = sorted((_count(m.group(1)), _count(m.group(2))))
        return low, high, _unit(m.group(3))
    if m := SINGLE.search(text):
        n, unit = _count(m.group(1)), _unit(m.group(2))
        if m.group(1).lower() == "a few":
            return 3, 4, unit
        return (n, n, unit) if unit == "sentences" else (round(n * (0.75 if unit == "words" else 0.8)), n, unit)
    if m := LIMIT.search(text):
        n, unit = _count(m.group(2)), _unit(m.group(1))
        return round(n * (0.75 if unit == "words" else 0.8)), n, unit
    if q.max_length:
        return round(q.max_length * 0.8), q.max_length, "characters"
    if q.kind == "text":
        return 0, SINGLE_LINE, "characters"
    low, high = answering.load()[kind].length
    return low, high, "words"


TOO_LONG = "too long: "  # opens the length gate's failure for an answer over its form's limit


def caps(q: Question) -> list[tuple[int, str]]:
    """Every word or character cap `q` states, as (most, unit): each range's
    top and each limit given in digits, in its label or description, and the
    field's character cap. bounds reads only the first length stated, so a
    label asking "2-3 sentences" and "(max 260 words)" has both."""
    text = f"{q.label} {q.description}"
    found = [(_count(m.group(2)), _unit(m.group(3))) for m in RANGE.finditer(text)]
    found += [(_count(m.group(1)), _unit(m.group(2))) for m in SINGLE.finditer(text) if m.group(1)[0].isdigit()]
    found += [(_count(m.group(2)), _unit(m.group(1))) for m in LIMIT.finditer(text)]
    found += [(q.max_length, "characters")] if q.max_length else []
    return [(n, unit) for n, unit in found if unit != "sentences"]


def over_cap(text: str, q: Question) -> list[str]:
    """The first cap `q` states (caps) that `text` is over, as a length failure; none when it fits."""
    for most, unit in caps(q):
        if (n := _measure(text, unit)) > most:
            return [f"{TOO_LONG}{n} {unit}, the most is {most}"]
    return []


def length(text: str, q: Question, kind: str) -> list[str]:
    """Too long for `q` (bounds), or under UNDER of its lower bound; types in
    NO_FLOOR and short fields have no lower bound. Every cap the form
    states (caps) always holds too: an answer over one never goes on the
    form (worker)."""
    low, high, unit = bounds(q, kind)
    n = _measure(text, unit)
    if n > high:
        return [f"{TOO_LONG}{n} {unit}, the most is {high}"]
    if over := over_cap(text, q):
        return over
    short = q.kind == "text" or (q.max_length or SHORT_FIELD + 1) <= SHORT_FIELD
    if kind not in NO_FLOOR and not short and n < (floor := -(-low * UNDER // 1)):
        return [f"too short: {n} {unit}, at least {floor:.0f} ({UNDER:.0%} of {low})"]
    return []


def _count(word: str) -> int:
    return COUNTS.get(word.lower()) or int(word.replace(",", ""))


def _unit(word: str) -> str:
    word = word.lower()
    return "characters" if word.startswith("char") else "sentences" if word.startswith("sentence") else "words"


def _measure(text: str, unit: str) -> int:
    if unit == "characters":
        return len(text)
    if unit == "sentences":
        return max(len(_sentences(text)), len([line for line in text.splitlines() if line.strip()]))  # or bullets
    return len(text.split())


# (b) Numbers and names traced.

UNTRACED_NUMBER = "a number no source holds: "  # opens the gate's failure for each such number
UNTRACED_NAME = "a name no source holds: "  # opens the gate's failure for each such name

def traced(text: str, sources: str, company: str) -> list[str]:
    """Numbers in `text` no source states, and names no source holds: each
    run of two or more capitalized words (its sentence-opening words dropped)
    and each word with a capital inside it ("PyTorch"). The company's own
    name always passes; single capitalized words and acronyms are never
    checked, so a sentence opener or "AI" never fails. A run that joins
    names the sources hold passes too (held)."""
    found = [f"{UNTRACED_NUMBER}{n}" for n in unsupported_numbers(text, sources)]
    return found + [f"{UNTRACED_NAME}{name}" for name in names(text) if not held(name, f"{sources}\n{company}")]


def held(name: str, sources: str) -> bool:
    """Whether `sources` hold `name`, whole or as names side by side: an
    essay joins them into one capitalized run ("MongoDB Intelligent Workload
    Management", "IEEE Stony Brook Micromouse", "Hitachi Rail's CTO", its
    "'s" dropped by names). Each piece of two or more words must be in the
    sources, in any case; a one-word piece only as that capitalized word."""
    plain, words = _plain(sources), name.split()
    piece = lambda part: (_plain(" ".join(part)) in plain if len(part) > 1
                          else re.search(rf"(?<!\w){re.escape(part[0])}(?!\w)", sources) is not None)
    split = [True] + [False] * len(words)  # split[j]: words[:j] cut into held pieces
    for j in range(1, len(words) + 1):
        split[j] = any(split[i] and piece(words[i:j]) for i in range(j))
    return split[-1]


def names(text: str) -> list[str]:
    """The names `text` gives (traced): capitalized runs and camel-case words, each once."""
    found = []
    for m in NAME_RUN.finditer(text):
        words = re.sub(r"['’]s\b", "", m.group()).split()
        while words and words[0].lower() in OPENERS:
            words.pop(0)
        while words and words[-1].lower() in OPENERS:
            words.pop()
        if len(words) > 1 and not all(w.isupper() for w in words):
            found.append(" ".join(words))
    found += [m.group() for m in CAMEL.finditer(text) if not any(m.group() in name for name in found)]
    return list(dict.fromkeys(found))


def _plain(text: str) -> str:
    return " ".join(text.replace("’", "'").casefold().split())


# (c) No other company named.

@cache
def companies() -> tuple[str, ...]:
    """Every company a brief in company-briefs/ is about, by its brief's first heading."""
    return tuple(line[2:].strip() for path in sorted(BRIEFS.glob("*.md"))
                 if (line := path.read_text().partition("\n")[0]).startswith("# "))


def other_companies(text: str, company: str, bank: str | None = None) -> list[str]:
    """Known companies `text` names that aren't `company`: a name left over
    from another Application. A name his own facts in the Story bank use
    (`bank`, outside his past answers to other companies) is his, and passes."""
    own = _own_facts(home.STORY_BANK.read_text() if bank is None else bank)
    return [f"names another company: {name}" for name in companies()
            if re.search(rf"\b{re.escape(name)}\b", text) and not is_company(company, name)
            and not is_company(name, company) and not re.search(rf"\b{re.escape(name)}\b", own)]


def _own_facts(bank: str) -> str:
    """The Story bank without his own essays and answers, which name the companies they were for."""
    return re.sub(rf"{writing.OWN}.*?(?=^## )", "", bank, flags=re.MULTILINE | re.DOTALL)


# (d) The swap test's code half.

def swap(text: str, kind: str, company: str, brief: str) -> list[str]:
    """On a company-facing type, sentences naming `company` with no specific
    fact (sameness.swap_survivors): no brief fact's name, number or other
    proper noun, so they would read true of a competitor."""
    if kind not in sameness.COMPANY_FACING or not company:
        return []
    facts = re.findall(r"^- \*\*(.+?)\*\*", brief, re.MULTILINE)
    return [f'would read true of another company: "{s}"' for s, _ in sameness.swap_survivors(text, company, [], facts)]


# (f) Not on the resume.

def resume_words(pdf: Path | None) -> tuple[str, ...]:
    """The resume PDF's words, lowercased; none when there is no PDF (the gate is off) or it doesn't read."""
    if pdf is None or not pdf.is_file():
        return ()
    return _pdf_words(pdf, pdf.stat().st_mtime)


@cache
def _pdf_words(pdf: Path, mtime: float) -> tuple[str, ...]:
    try:
        return tuple(_words(" ".join(page.extract_text() or "" for page in PdfReader(pdf).pages)))
    except Exception:  # a PDF that doesn't read leaves the gate off, as the gates lean toward passing
        return ()


def on_resume(text: str, kind: str, resume: Path | None = None) -> list[str]:
    """In a not-on-resume answer, a run of RESUME_RUN words copied from the resume PDF."""
    if kind != "not-on-resume":
        return []
    have = _runs(list(resume_words(resume)))
    words = _words(text)
    return [f'copies the resume: "{run}"' for run in dict.fromkeys(
        " ".join(words[i:i + RESUME_RUN]) for i in range(len(words) - RESUME_RUN + 1)) if run in have][:1]


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))


def _runs(words: list[str]) -> set[str]:
    return {" ".join(words[i:i + RESUME_RUN]) for i in range(len(words) - RESUME_RUN + 1)}


# (g) The opener.

def opener(text: str, q: Question) -> list[str]:
    """A first sentence that opens on a date ("In summer 2026,"), or takes
    more than RESTATED of its words from the question."""
    sentences = _sentences(text)
    if not sentences:
        return []
    first, found = sentences[0], []
    clause = first.split(",", 1)[0]
    if "," in first and len(clause.split()) <= 6 and DATE.search(clause):
        found.append(f'opens on a date: "{clause},"')
    own = [w for w in _words(first) if len(w) > 2 and w not in STOP]
    asked = set(_words(f"{q.label} {q.description}"))
    if own and sum(w in asked for w in own) / len(own) > RESTATED:
        found.append(f'restates the question: "{first}"')
    return found


def answer(text: str, q: Question, kind: str, sources: str, company: str, brief: str = "",
           letter: bool = False, resume: Path | None = None) -> list[str]:
    """Every gate on one answer, in order: (a) length, (b) numbers and names,
    (c) other companies, (d) swap, (f) resume, (g) opener. A cover letter's
    salutation and sign-off (its first and last two lines, set by Apply) are
    left out of the name and opener checks."""
    body = "\n".join(text.splitlines()[1:-2]) if letter else text
    return [*length(text, q, kind), *traced(body, f"{sources}\n{q.label}\n{q.description}", company),
            *other_companies(body, company), *swap(body, kind, company, brief),
            *on_resume(body, kind, resume), *([] if letter else opener(body, q))]


# (e) and (h): across one form.

def form(texts: Mapping[str, str]) -> dict[str, list[str]]:
    """Failures across one form's answers, by key: the same name given
    different numbers of the same thing in two answers ("13 interns" at
    Hitachi Rail here, "12 interns" there), and two answers opening the same
    way (sameness.same_openings)."""
    found: dict[str, list[str]] = {}
    facts = {key: _facts(text) for key, text in texts.items()}
    for key, mine in facts.items():
        for other, theirs in facts.items():
            if other == key:
                continue
            for (name, unit), value in mine.items():
                if (seen := theirs.get((name, unit))) is not None and seen != value:
                    found.setdefault(key, []).append(f"{name} has {value} {unit} here and {seen} {unit} in {other}")
    for a, b, reason in sameness.same_openings({k: t for k, t in texts.items() if t}):
        found.setdefault(a, []).append(f"opens like {b}: {reason}")
        found.setdefault(b, []).append(f"opens like {a}: {reason}")
    return found


def _facts(text: str) -> dict[tuple[str, str], str]:
    """(name, thing counted) -> number, for each sentence naming one thing and giving a count of something."""
    found = {}
    for sentence in _sentences(text):
        named = names(sentence)
        for m in re.finditer(r"\b(\d[\d,.]*)(%|\s+[a-z]+)", sentence):
            if re.fullmatch(r"(?:19|20)\d\d", m.group(1)):
                continue
            unit = m.group(2).strip()
            for name in named:
                found[(name, unit)] = m.group(1).rstrip(".,")
    return found


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.replace("\n", " ").strip()) if s.strip()]
