'''
Finds the companies a search names: "jump trading quant intern" names Jump
Trading. Pure: no database, no network. The API builds one CompanyResolver
from the company names the listed jobs hold (routers/jobs.py,
company_resolver) and refreshes it every few minutes, since an import every
three hours adds and drops companies; there is no list to keep by hand and no
table, as each job already has its company_name. docs/search.md has the
design.

How a search's words are read, the way role_resolver.py reads a title:

1. Every name is split into words as a query is (role_resolver.raw_words), so
   "Brightstar.AI" is `brightstar ai` and matches however it is typed.
2. Walk the words left to right, trying the longest name that could start at
   each word, then shorter ones: whole words in a row, never substrings, so
   "data engineer" is not Datadog. A name found uses up its words. This runs
   before the roles, so Bedrock Robotics keeps "robotics" from the Robotics
   Engineer role.
3. A one-word name that is also a search's own vocabulary (a role's word,
   "intern", "remote") is not read as the company: `reserved` says which.
4. After the roles and facts have taken theirs, a typo in what is left is
   corrected to the one name close to it ("strpe" is Stripe, "spacx" SpaceX):
   difflib against whole names, as read_query corrects a role's word, and
   only when exactly one name is close. An ordinary word ("data", "cloud")
   is close to no whole name, so it is left for the job's text.

There are no short forms ("squarepoint" for Squarepoint Capital): stripping a
name's generic words would make "Chicago Trading Company" the key "chicago",
and a search's place name a company filter. A partial name is still found
word by word, as the job text or the company's name containing it.
'''
import difflib
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from app.services.role_resolver import raw_words

# How close a typo must be to a whole name to be corrected, and the shortest
# word or pair tried: read_query's own (role_resolver.FUZZY_*). At four letters
# and under, nearly everything is close to some name.
FUZZY_CUTOFF = 0.8
FUZZY_MIN_LENGTH = 5


@dataclass(frozen=True)
class CompanyRead:
    # The company names found, as job_postings holds them ("Jump Trading").
    companies: frozenset[str]
    # The words no name used, in order, for the roles and the job's text.
    rest: tuple[str, ...]


class CompanyResolver:
    '''
    names: the company names the listed jobs hold. reserved: true for a word
    tuple a search reads as its own (a role's alias, "intern"), which a
    one-word name never takes
    '''

    def __init__(self, names: Iterable[str], reserved: Callable[[tuple[str, ...]], bool] = lambda key: False):
        # words -> the names that split into them: "Scale AI" and "Scale.ai"
        # are one key, and either is the company meant.
        self._names: dict[tuple[str, ...], set[str]] = {}
        for name in names:
            key = tuple(raw_words(name))
            if not key or (len(key) == 1 and reserved(key)):
                continue
            self._names.setdefault(key, set()).add(name)
        self._longest = max(map(len, self._names), default=0)
        self._spelled = {" ".join(key): key for key in self._names}

    def read(self, words: Iterable[str]) -> CompanyRead:
        '''
        the names spelled out in these words, longest first, and the words
        left over
        '''
        ws = list(words)
        found: set[str] = set()
        rest: list[str] = []
        i = 0
        while i < len(ws):
            for n in range(min(self._longest, len(ws) - i), 0, -1):
                names = self._names.get(tuple(ws[i:i + n]))
                if names:
                    found.update(names)
                    i += n
                    break
            else:
                rest.append(ws[i])
                i += 1
        return CompanyRead(frozenset(found), tuple(rest))

    def _close(self, typed: str) -> tuple[str, ...] | None:
        '''the one name close to typed, or None when none is or several are'''
        if len(typed.replace(" ", "")) < FUZZY_MIN_LENGTH:
            return None
        close = difflib.get_close_matches(typed, self._spelled, n=2, cutoff=FUZZY_CUTOFF)
        return self._spelled[close[0]] if len(close) == 1 else None

    def correct(self, words: Iterable[str]) -> CompanyRead:
        '''
        typos in what a search left: each pair of words, then each word, as
        the one name close to it ("jump tradng", "strpe"). A word no name is
        close to stays, for the job's text
        '''
        ws = list(words)
        found: set[str] = set()
        rest: list[str] = []
        i = 0
        while i < len(ws):
            for n in (2, 1):
                key = self._close(" ".join(ws[i:i + n])) if i + n <= len(ws) else None
                if key:
                    found.update(self._names[key])
                    i += n
                    break
            else:
                rest.append(ws[i])
                i += 1
        return CompanyRead(frozenset(found), tuple(rest))
