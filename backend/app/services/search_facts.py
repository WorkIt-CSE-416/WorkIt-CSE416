"""
The facts a search's words name that have columns (query_facts): "intern" is
the student level (every internship, KAN-233), "remote" the work style, "summer 2027" the start term.
queries/jobs/search.py reads ?q= with it, and docs/search.md has the design.
Pure: no database.
"""

import difflib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.models import dto
from app.services.role_resolver import ALIASES, raw_word_spans, raw_words
from app.services.start_terms import MONTHS, SEASONS, season_of

# Words in a search that name a fact a column holds, read as that column's
# filter rather than looked for in the text (query_facts). Each phrase is in
# words as raw_words splits them: "co-op" is "co op", "on-site" "on site".
_LEVEL_WORDS = {
    ("intern",): "student", ("interns",): "student",
    ("internship",): "student", ("internships",): "student",
    ("co", "op"): "student", ("coop",): "student", ("co", "ops"): "student",
    ("new", "grad"): "new_grad", ("new", "grads"): "new_grad", ("newgrad",): "new_grad",
    ("new", "graduate"): "new_grad", ("new", "graduates"): "new_grad",
    ("early", "career"): "new_grad", ("entry", "level"): "new_grad",
}
_WORK_STYLE_WORDS = {
    ("remote",): dto.work_style.remote, ("hybrid",): dto.work_style.hybrid,
    ("onsite",): dto.work_style.onsite, ("on", "site"): dto.work_style.onsite,
    ("in", "person"): dto.work_style.onsite, ("in", "office"): dto.work_style.onsite,
}
_YEAR = re.compile(r"^20[2-3][0-9]$")
# A misspelt month or season beside a year ("summe 2027", "janury 2027") is
# read as the one it is close to, by the rule role and company typos follow:
# difflib, ratio 0.8 or more, five letters or more (at four and under, "fal"
# and "jun" are close to too much).
_SEASON_WORD_CUTOFF = 0.8
_OWN_WORDS = frozenset(
    {w for key in (*_LEVEL_WORDS, *_WORK_STYLE_WORDS) for w in key}
    | {w for phrases in ALIASES.values() for phrase in phrases for w in raw_words(phrase)}
)
_SEASON_WORD_MIN_LENGTH = 5


def season_word(word: str) -> str:
    '''
    the month or season a word is a typo of, or the word itself: only ever
    used beside a year, so a lone "summe" or an ordinary word is never read
    as a season (query_facts)
    '''
    names = (*SEASONS, "autumn", *MONTHS)
    # A search's own words (a fact's, a role alias's) are never a typo of a
    # season: "intern" and "writer" are each 0.8 or more from "winter", and
    # "intern 2027" is internships starting in 2027.
    if word in names or word in _OWN_WORDS or len(word) < _SEASON_WORD_MIN_LENGTH:
        return word
    close = difflib.get_close_matches(word, names, n=1, cutoff=_SEASON_WORD_CUTOFF)
    return close[0] if close else word


@dataclass(frozen=True)
class QueryFacts:
    '''the facts a search's words name, and the positions those words take'''
    levels: tuple[str, ...] = ()
    work_styles: tuple[dto.work_style, ...] = ()
    # Start Date keys: "summer-2027", or for a bare year every season of it
    # and the year itself ("2027": a posting naming the year alone).
    seasons: tuple[str, ...] = ()
    # The words as typed that named a season or year, and "remote", for the
    # title match beside the column (in_title).
    season_phrases: tuple[str, ...] = ()
    remote_phrases: tuple[str, ...] = ()
    used: frozenset[int] = frozenset()
    # Each fact with the words that named it, for the search page to show
    # and let the seeker drop (GET /jobs/search-facts).
    found: tuple["FoundFact", ...] = ()


@dataclass(frozen=True)
class FoundFact:
    '''one fact a search named: its filter, the value, and its words' positions'''
    # The filter row's name for it: "level" (experience), "work_style" or
    # "start_term".
    facet: str
    # The value as that filter's own key: "student", "remote", "summer-2027",
    # or a bare year ("2027") for any start that year.
    value: str
    at: tuple[int, ...]


def query_facts(words: Sequence[str]) -> QueryFacts:
    '''
    the experience levels, work styles and start seasons these words name,
    longest phrase first: "summer 2027" is one season, and "2027" alone is
    any start in that year. A season with no year ("summer") is no season,
    as season_of reads one, and stays a word
    '''
    levels: list[str] = []
    styles: list[dto.work_style] = []
    seasons: list[str] = []
    season_phrases: list[str] = []
    remote_phrases: list[str] = []
    used: set[int] = set()
    found: list[FoundFact] = []

    def take(phrase: tuple[str, ...], at: range) -> bool:
        typed = " ".join(phrase)
        # A pair as its month or season would be spelt: "summe 2027" is
        # "summer 2027". As corrected for the title match too.
        spelled = " ".join(map(season_word, phrase))
        if phrase in _LEVEL_WORDS:
            levels.append(_LEVEL_WORDS[phrase])
            found.append(FoundFact("level", _LEVEL_WORDS[phrase], tuple(at)))
        elif phrase in _WORK_STYLE_WORDS:
            styles.append(_WORK_STYLE_WORDS[phrase])
            found.append(FoundFact("work_style", _WORK_STYLE_WORDS[phrase].value, tuple(at)))
            if _WORK_STYLE_WORDS[phrase] == dto.work_style.remote:
                remote_phrases.append(typed)
        elif len(phrase) == 2 and "-" in (season_of(spelled) or ""):
            seasons.append(season_of(spelled))
            season_phrases.append(spelled)
            found.append(FoundFact("start_term", season_of(spelled), tuple(at)))
        elif len(phrase) == 1 and _YEAR.match(phrase[0]):
            seasons.extend([*(f"{season}-{phrase[0]}" for season in SEASONS), phrase[0]])
            season_phrases.append(typed)
            found.append(FoundFact("start_term", phrase[0], tuple(at)))
        else:
            return False
        return True

    i = 0
    while i < len(words):
        span = next((n for n in (2, 1) if i + n <= len(words) and take(tuple(words[i:i + n]), range(i, i + n))), 0)
        used.update(range(i, i + span))
        i += span or 1
    return QueryFacts(
        tuple(dict.fromkeys(levels)), tuple(dict.fromkeys(styles)),
        tuple(dict.fromkeys(seasons)), tuple(dict.fromkeys(season_phrases)),
        tuple(dict.fromkeys(remote_phrases)), frozenset(used), tuple(found),
    )


def without_words(text: str, at: Iterable[int]) -> str:
    '''
    text with the words at these positions (as raw_words counts them) taken
    out, the rest as typed: "Remote C++ intern" without 0 is "C++ intern".
    What a fact's × on /search leaves of the search (GET /jobs/search-facts)
    '''
    spans = raw_word_spans(text)
    cut = sorted(spans[i] for i in set(at) if i < len(spans))
    left, start = [], 0
    for begin, end in cut:
        left.append(text[start:begin])
        start = end
    left.append(text[start:])
    return " ".join("".join(left).split())
