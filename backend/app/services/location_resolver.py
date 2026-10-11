"""
Turns a job board's free-text location ("San Francisco, CA • New York, NY")
into the ISO places job_locations stores: [Place("US", "US-CA"),
Place("US", "US-NY")]. Pure: no database, no network. The import builds one
LocationResolver with the codes the database holds, so every place it returns
passes job_locations' foreign keys.

Nothing here lists cities or spellings by hand. Names come from data/places.tsv
(GeoNames; scripts/build_geonames.py) and from the seeded states. The handful of
constants below are vocabulary — separators, filler words, a few country
nicknames — not places.

How a string is read, start to finish:

1. Split into segments on separators that only ever mean "another place":
   • ; | / newline, and a lowercase " or " / " and " between two names.
2. Split each segment on commas (and parentheses, and a spaced dash) into
   pieces, and strip filler words: "Mountain View, California (HQ)" gives
   "mountain view", "california".
3. Read each piece every way the data allows — as a city, a region (state,
   province), a country — since one name can be several: "New York" is a city
   and a state, "CA" is California and Canada, "Georgia" a state and a country.
4. Group pieces into places. A place is a name followed by broader qualifiers
   (city, then region, then country); a piece that can't qualify the one
   before starts a new place. So "Cambridge, MA, Arlington, VA" is two places
   and "Boston, MA, USA" is one.
5. Decide each place. A city is checked against its qualifiers ("Perth, WA"
   finds no Perth in Washington and turns to Perth, Australia); a city name
   alone picks the most populous match, preferring a US one of comparable size,
   since this is a US job board ("Cambridge" is Cambridge, MA).

app/models/CLAUDE.md has the reasoning and the known misses.
"""

import difflib
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

PLACES_FILE = Path(__file__).resolve().parents[2] / "data" / "places.tsv"

CITY, REGION, COUNTRY = 0, 1, 2

# GeoNames lists these as countries; ISO 3166-2 also lists them under the US,
# which is how the states seed holds them (US-PR, US-GU, ...).
_US_TERRITORIES = frozenset({"PR", "GU", "VI", "AS", "MP", "UM"})

# Country names job boards write that GeoNames' countryInfo spells another
# way. ISO2 and ISO3 codes ("US", "USA") and a leading "the" are handled
# generally; these are the rest.
_COUNTRY_ALIASES = {
    "america": "US", "united states of america": "US",
    "uk": "GB", "great britain": "GB", "britain": "GB",
    "uae": "AE", "korea": "KR", "republic of korea": "KR",
    "czech republic": "CZ", "holland": "NL", "turkiye": "TR",
    "cote d'ivoire": "CI", "macedonia": "MK", "mainland china": "CN", "prc": "CN",
    "deutschland": "DE", "espana": "ES", "italia": "IT", "brasil": "BR",
    "schweiz": "CH", "suisse": "CH", "osterreich": "AT", "nederland": "NL",
}

# Regions job posts name that are no city's name. Rewritten to a city the
# data knows, before anything else reads the piece.
_METRO_ALIASES = {
    "san francisco bay area": "san francisco", "sf bay area": "san francisco",
    "bay area": "san francisco", "silicon valley": "san jose",
}

# Words that describe the arrangement rather than the place ("Remote - US",
# "London Office", "South San Francisco HQ"). Removed wherever they appear;
# a piece left empty named no place at all. "North America" and "Americas"
# are here too: they take in the US, so they name no one place.
_FILLER = (
    "work from home", "multiple locations", "north america", "in office",
    "in person", "on site", "home based", "remote", "remotely", "hybrid",
    "onsite", "office", "offices", "hq", "headquarters", "headquarter", "campus",
    "site", "sites", "worldwide", "global", "anywhere", "any", "flexible", "home",
    "based", "wfh", "work", "first", "area", "greater", "metro", "metropolitan",
    "region", "only", "locations", "location", "various", "available", "hub",
    "americas",
)
_FILLER_RE = re.compile(r"\b(?:" + "|".join(re.escape(w) for w in _FILLER) + r")\b")

# Areas wider than a country but wholly outside the US: no single country,
# yet certainly not a US state, so they resolve to the catch-all country.
_ABROAD = frozenset({
    "europe", "emea", "eu", "apac", "asia", "asia pacific", "latin america",
    "latam", "south america", "central america", "africa", "middle east",
    "oceania", "nordics", "scandinavia",
})
# Stands in for "outside the US, no one country" among a piece's countries.
# Never a database code, so _to_place sends it to the catch-all.
_SOMEWHERE_ABROAD = "*"

# Short words a run of words without commas may hold between names ("Remote in
# the UK", "Beijing OR Shanghai"). Skipped there, but only before the last
# word: "Lafayette IN" is Indiana.
_STOPWORDS = frozenset({"in", "the", "of", "at", "near", "or", "and", "to", "for", "from", "all"})
# The longest name, in words, a run of words is searched for.
_LONGEST_NAME = 6

# A whole string meaning "no location given".
_NO_LOCATION = frozenset({"n/a", "na", "tbd", "tba", "none", "unknown", "-"})

# Same token, two spellings; applied to the data and the input alike.
_TOKEN_CANON = {"saint": "st", "sainte": "ste", "fort": "ft", "mount": "mt"}

# • ; | / and newlines always separate places. " or " is matched lowercase
# only, between two names: "Portland, OR" is Oregon. " and " is split later,
# unless the segment holds a name containing it ("Newfoundland and Labrador").
_SEGMENT_SPLIT = re.compile(r"\s*[•·;|/\n]\s*|(?<=\S) or (?=\S)")
_AND_SPLIT = re.compile(r"\s+(?:and|&)\s+", re.IGNORECASE)
# Within a segment: commas, brackets, and a dash with spaces round it ("Remote
# - US"). An unspaced hyphen is part of a name ("Winston-Salem").
_PIECE_SPLIT = re.compile(r"[,()\[\]]|\s+[-–—]\s+")

# A city this size, with no US namesake, beats a qualifier it doesn't fit:
# "Perth, WA" is Australia. Below it, the qualifier wins: "Springfield, VT" is
# a Vermont town too small for the data, not Springfield, Missouri.
_MAJOR_CITY = 1_000_000
# A US city at least this share of the largest same-named city wins.
_US_PREFERENCE = 0.5
# A name standing alone that is both a region abroad and a US city this big is
# the city: "San Jose" (not the Costa Rican province), "St. Louis". Below it,
# the region: "Ontario" is the province, not Ontario, California (175k).
_BIG_US_CITY = 250_000
# How close a misspelt region or country name must be to count
# ("Pennslyvania"), by difflib's ratio, and the shortest piece tried.
_TYPO_CUTOFF = 0.88
_TYPO_MIN_LENGTH = 5


def normalize(text: str) -> str:
    '''
    the form every name is compared in: accents and case folded, periods
    dropped, hyphens as spaces, a leading "the" dropped
    '''
    folded = unicodedata.normalize("NFKD", text)
    folded = "".join(c for c in folded if not unicodedata.combining(c)).casefold()
    folded = folded.replace("’", "'").replace(".", "").replace("&", " and ")
    # Any other punctuation separates words: "HQ: San Francisco", "US-WA".
    folded = re.sub(r"[^\w' ]|_", " ", folded)
    tokens = [_TOKEN_CANON.get(t, t) for t in folded.split()]
    if tokens and tokens[0] == "the":
        tokens = tokens[1:]
    return " ".join(tokens)


# Compared after normalizing, which turns "N/A" into "n a" and "-" into "".
_NO_LOCATION_NORMALIZED = frozenset(normalize(s) for s in _NO_LOCATION) | {""}


@dataclass(frozen=True)
class Place:
    country: str
    state: str | None = None


@dataclass(frozen=True)
class Resolution:
    places: tuple[Place, ...]
    # Pieces that named something the data doesn't know, from places that
    # resolved to nothing. Empty when the string named no place at all
    # ("Remote"), so a caller can log only real misses.
    unresolved: tuple[str, ...]
    # The text as a card should print it, or None when nothing in it was
    # worth rewriting (see label_of). Display only: nothing filters on it.
    label: str | None = None


# (country, region, city name): a decided place, the city when one decided it.
_Found = tuple[str, str | None, str | None]


def _no_city(found: tuple[str, str | None] | None) -> _Found | None:
    return (*found, None) if found else None


# How the job is done rather than where: a segment naming one keeps its own
# words in the label, since "Remote - San Francisco" printed as "San
# Francisco, CA" would hide that it's remote. Office and HQ are left out on
# purpose: "San Francisco Office" is San Francisco.
_ARRANGEMENT_RE = re.compile(
    r"\b(?:remote|remotely|hybrid|work from home|wfh|home based|anywhere|worldwide|flexible)\b"
)


# GeoNames names that job listings don't use, to the name they do.
_DISPLAY_NAME = {"New York City": "New York"}


def _city_label(found: _Found, place: Place | None) -> str | None:
    '''
    "San Francisco, CA" for a place decided by a US city with a state, else
    None: abroad, a state or country alone, and anything unplaced keep the
    posting's own words, so the label never says less than the posting did
    '''
    city = found[2]
    if city is None or place is None or place.country != "US" or place.state is None:
        return None
    return f"{_DISPLAY_NAME.get(city, city)}, {place.state.removeprefix('US-')}"


@dataclass(frozen=True)
class _City:
    country: str
    admin1: str
    population: int
    # GeoNames' own spelling, for the display label: "San Francisco".
    name: str


@dataclass
class _Gazetteer:
    # name -> cities, split by how the name matched: their own name first,
    # an alternate second. "Frisco" is Frisco, Texas before it is a nickname
    # for San Francisco.
    cities: dict[str, tuple[list[_City], list[_City]]]
    regions: dict[str, set[tuple[str, str]]]
    countries: dict[str, set[str]]


@lru_cache
def load_gazetteer(path: Path = PLACES_FILE) -> _Gazetteer:
    '''
    parse data/places.tsv once per process
    '''
    cities: dict[str, tuple[list[_City], list[_City]]] = defaultdict(lambda: ([], []))
    regions: dict[str, set[tuple[str, str]]] = defaultdict(set)
    countries: dict[str, set[str]] = defaultdict(set)

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        cols = line.split("\t")
        if cols[0] == "country":
            _kind, iso2, iso3, name = cols
            for key in {normalize(name), iso2.casefold(), iso3.casefold()}:
                countries[key].add(iso2)
        elif cols[0] == "region":
            _kind, country, admin1, name, ascii_name = cols
            for key in {normalize(name), normalize(ascii_name)}:
                regions[key].add((country, admin1))
        elif cols[0] == "city":
            _kind, country, admin1, population, name, ascii_name, alternates = cols
            city = _City(country, admin1, int(population), name)
            own = {normalize(name), normalize(ascii_name)}
            for key in own:
                if key:
                    cities[key][0].append(city)
            for alt in alternates.split("|") if alternates else ():
                key = normalize(alt)
                # An alternate of only punctuation normalizes to "", which
                # would then match every unknown word.
                if key and key not in own:
                    cities[key][1].append(city)

    for alias, iso2 in _COUNTRY_ALIASES.items():
        countries[normalize(alias)].add(iso2)
    return _Gazetteer(dict(cities), dict(regions), dict(countries))


@dataclass
class _Piece:
    raw: str
    norm: str
    cities: tuple[list[_City], list[_City]]
    regions: set[tuple[str, str]]
    countries: set[str]

    @classmethod
    def unknown(cls, raw: str) -> "_Piece":
        return cls(raw, "", ([], []), set(), set())

    @property
    def ranks(self) -> set[int]:
        out = set()
        # Two letters that are a state or country code are that code, not a
        # city: "Perth, WA" is Washington or nothing, never Wa, Ghana.
        is_code = len(self.norm) <= 2 and bool(self.regions or self.countries)
        if (self.cities[0] or self.cities[1]) and not is_code:
            out.add(CITY)
        if self.regions:
            out.add(REGION)
        if self.countries:
            out.add(COUNTRY)
        return out

    @property
    def all_cities(self) -> list[_City]:
        return self.cities[0] + self.cities[1]


@dataclass
class _Group:
    head: _Piece | None
    rank: int
    qualifiers: list[_Piece] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)


class LocationResolver:
    '''
    countries: the ISO2 codes the database holds. states: its state codes
    ("US-CA") mapped to their names. A place outside them becomes
    `other_country` ("ZZ", the seed's catch-all) when that is among
    `countries`, and is dropped otherwise.
    '''

    def __init__(
        self,
        countries: Iterable[str],
        states: Mapping[str, str],
        gazetteer: _Gazetteer | None = None,
        other_country: str = "ZZ",
    ):
        self._gaz = gazetteer or load_gazetteer()
        self._countries = frozenset(countries)
        self._states = frozenset(states)
        self._other = other_country if other_country in self._countries else None

        # The seeded states are regions too, by name and by the part of the
        # code after the dash ("US-CA" is "ca"). A numeric part ("JP-13") is
        # skipped: a bare number in a posting names nothing.
        self._state_regions: dict[str, set[tuple[str, str]]] = defaultdict(set)
        for code, name in states.items():
            country, _, sub = code.partition("-")
            self._state_regions[normalize(name)].add((country, sub))
            if not sub.isdigit():
                self._state_regions[sub.casefold()].add((country, sub))

        # Region and country names a misspelling is compared against. Cities
        # are left out: there are too many, and too many differ by a letter.
        self._typo_names = sorted(
            name for name in (*self._gaz.regions, *self._gaz.countries, *self._state_regions)
            if len(name) >= _TYPO_MIN_LENGTH
        )

        # Names with "and" in them, so " and " inside one isn't read as a list.
        self._and_names = frozenset(
            name for name in (*self._gaz.regions, *self._gaz.countries, *self._gaz.cities)
            if " and " in name
        )

    def resolve(self, text: str | None) -> Resolution:
        if text is None or normalize(text) in _NO_LOCATION_NORMALIZED:
            return Resolution((), ())

        places: list[Place] = []
        unresolved: list[str] = []
        # Each segment's words for the label: "City, ST" for each place in
        # it when every one is a US city, else the segment as written.
        labels: list[str] = []
        rewritten = False
        for segment in self._segments(text):
            pieces = [p for raw in _PIECE_SPLIT.split(segment) for p in self._read(raw)]
            cities: list[str] | None = [] if not _ARRANGEMENT_RE.search(normalize(segment)) else None
            for group in self._group(pieces):
                found = self._decide(group)
                place = self._to_place(found[0], found[1]) if found else None
                if place is not None:
                    if place not in places:
                        places.append(place)
                else:
                    unresolved.extend(group.unknown)
                    if group.head is not None and found is None:
                        unresolved.append(group.head.raw)
                city = _city_label(found, place) if found and not group.unknown else None
                if cities is not None and city is not None:
                    cities.append(city)
                else:
                    cities = None
            if cities:
                labels.extend(cities)
                rewritten = True
            else:
                labels.append(" ".join(segment.split()))
        label = "; ".join(dict.fromkeys(labels)) if rewritten else None
        return Resolution(tuple(places), tuple(dict.fromkeys(unresolved)), label)

    def _segments(self, text: str) -> list[str]:
        out = []
        for segment in _SEGMENT_SPLIT.split(text):
            if not segment.strip():
                continue
            norm = normalize(segment)
            if any(name in norm for name in self._and_names):
                out.append(segment)
            else:
                out.extend(s for s in _AND_SPLIT.split(segment) if s.strip())
        return out

    def _read(self, raw: str) -> list[_Piece]:
        '''
        every reading the data has for one comma-separated piece. Usually one
        piece; several when it is a run of names with no commas between them
        ("US-WA-Bellevue", "Long Beach CA"); none when only filler was left
        '''
        norm = normalize(raw)
        for metro, city in _METRO_ALIASES.items():
            norm = re.sub(rf"\b{re.escape(metro)}\b", city, norm)
        norm = " ".join(_FILLER_RE.sub(" ", norm).split())
        if not norm:
            return []
        piece = self._piece(norm, raw.strip())
        if piece.ranks:
            return [piece]
        if len(norm) >= _TYPO_MIN_LENGTH:
            close = difflib.get_close_matches(norm, self._typo_names, n=1, cutoff=_TYPO_CUTOFF)
            if close:
                return [self._piece(close[0], raw.strip())]
        if " " not in norm:
            return [piece]
        return self._split_run(norm)

    def _piece(self, norm: str, raw: str, *, own_names_only: bool = False) -> _Piece:
        own, alternate = self._gaz.cities.get(norm, ([], []))
        countries = set(self._gaz.countries.get(norm, ()))
        if norm in _ABROAD:
            countries.add(_SOMEWHERE_ABROAD)
        return _Piece(
            raw=raw,
            norm=norm,
            # Alternate names are skipped inside a run of words: GeoNames keeps
            # enough odd ones that a stray word would turn into a city.
            cities=(own, [] if own_names_only else alternate),
            regions=self._gaz.regions.get(norm, set()) | self._state_regions.get(norm, set()),
            countries=countries,
        )

    def _known(self, key: str) -> bool:
        own, _alternate = self._gaz.cities.get(key, ([], []))
        return bool(own) or key in self._gaz.regions or key in self._state_regions or (
            key in self._gaz.countries or key in _ABROAD
        )

    def _split_run(self, norm: str) -> list[_Piece]:
        '''
        the longest known names in a run of words, narrowest first, so they
        group like comma-separated pieces: "us wa bellevue" reads as
        "bellevue", "wa", "us". Words matching nothing are kept as unknown
        pieces, after the names.
        '''
        tokens = norm.split()
        found: list[_Piece] = []
        unknown: list[str] = []
        i = 0
        while i < len(tokens):
            for j in range(min(len(tokens), i + _LONGEST_NAME), i, -1):
                key = " ".join(tokens[i:j])
                is_skippable = j == i + 1 and tokens[i] in _STOPWORDS and j < len(tokens)
                if not is_skippable and self._known(key):
                    found.append(self._piece(key, key, own_names_only=True))
                    i = j
                    break
            else:
                unknown.append(tokens[i])
                i += 1
        found.sort(key=lambda p: min(p.ranks))
        if unknown:
            found.append(_Piece.unknown(" ".join(unknown)))
        return found

    def _group(self, pieces: list[_Piece]) -> list[_Group]:
        groups: list[_Group] = []
        for piece in pieces:
            ranks = piece.ranks
            current = groups[-1] if groups else None
            if not ranks:
                # Unknown words qualify nothing but don't break a place either:
                # "Toronto, ON" stays one place even though "ON" isn't in the data.
                if current is not None:
                    current.unknown.append(piece.raw)
                else:
                    groups.append(_Group(head=None, rank=-1, unknown=[piece.raw]))
                continue
            if current is not None and current.head is None:
                # Unknown words came first ("Foo, CA"): this piece is the place.
                current.head, current.rank = piece, min(ranks)
                continue
            broader = {r for r in ranks if r > (current.rank if current else 99)}
            if current is not None and broader and self._may_qualify(current, piece):
                current.qualifiers.append(piece)
                current.rank = min(broader)
            else:
                groups.append(_Group(head=piece, rank=min(ranks)))
        return groups

    def _may_qualify(self, group: _Group, piece: _Piece) -> bool:
        '''
        a piece that could also be a city of its own ("Austin, New York") only
        qualifies the place before it if that place's city fits it
        '''
        if CITY not in piece.ranks or group.head is None or not group.head.all_cities:
            return True
        return any(self._fits(c, piece) for c in group.head.all_cities)

    @staticmethod
    def _fits(city: _City, qualifier: _Piece) -> bool:
        return (city.country, city.admin1) in qualifier.regions or city.country in qualifier.countries

    def _decide(self, group: _Group) -> _Found | None:
        '''
        (country, region, city name) for one place; the city only when a
        city is what decided it
        '''
        head, quals = group.head, group.qualifiers
        if head is None:
            return _no_city(self._from_qualifiers(quals))

        if not quals:
            # A name standing alone: a US state, then a country, then another
            # region, then a city. "New York" is the state, "Ontario" the
            # province, "Singapore" the country.
            us_regions = [r for r in head.regions if r[0] == "US"]
            if us_regions:
                return (*min(us_regions), None)
            if head.countries:
                return (min(head.countries), None, None)
            big_us_city = any(
                self._is_us(c.country) and c.population >= _BIG_US_CITY for c in head.cities[0]
            )
            if head.regions and not big_us_city:
                return (*min(head.regions), None)
            # Its own name first, as the gazetteer orders them: "Waterloo" is a
            # Waterloo before it is Austin's old name, and "Frisco" is Frisco,
            # TX before it is a nickname for San Francisco. Only a name that is
            # no city's own ("SF", "NYC") falls back to its alternates.
            return self._pick_city(head.cities[0] or head.cities[1])

        if head.all_cities:
            for tier in head.cities:
                fitting = [c for c in tier if all(self._fits(c, q) for q in quals)]
                if fitting:
                    return self._pick_city(fitting)
            biggest = max(head.all_cities, key=lambda c: c.population)
            # By own name only: Perth Amboy, NJ listing "Perth" as a nickname
            # doesn't make "Perth, WA" a US place.
            has_us_namesake = any(self._is_us(c.country) for c in head.cities[0])
            if biggest.population >= _MAJOR_CITY and not has_us_namesake:
                return (biggest.country, biggest.admin1, biggest.name)
            return _no_city(self._from_qualifiers(quals))

        # The head is itself a region or country: "Ontario, Canada".
        return _no_city(self._from_qualifiers([head, *quals]))

    def _from_qualifiers(self, quals: list[_Piece]) -> tuple[str, str | None] | None:
        '''
        the most specific place every qualifier agrees with, preferring a US one
        '''
        candidates: list[tuple[str, str | None]] = []
        for q in quals:
            candidates.extend(sorted(q.regions))
            candidates.extend((c, None) for c in sorted(q.countries))

        def agrees(cand: tuple[str, str | None], q: _Piece) -> bool:
            country, admin1 = cand
            if admin1 is not None:
                return cand in q.regions or country in q.countries
            return country in q.countries or any(r[0] == country for r in q.regions)

        fitting = [c for c in candidates if all(agrees(c, q) for q in quals)]
        if not fitting:
            return None
        fitting.sort(key=lambda c: (c[1] is None, not self._is_us(c[0])))
        return fitting[0]

    def _pick_city(self, cities: list[_City]) -> _Found | None:
        if not cities:
            return None
        biggest = max(cities, key=lambda c: c.population)
        us = [c for c in cities if self._is_us(c.country)]
        if us:
            best_us = max(us, key=lambda c: c.population)
            if best_us.population >= _US_PREFERENCE * biggest.population:
                return (best_us.country, best_us.admin1, best_us.name)
        return (biggest.country, biggest.admin1, biggest.name)

    @staticmethod
    def _is_us(country: str) -> bool:
        return country == "US" or country in _US_TERRITORIES

    def _to_place(self, country: str, admin1: str | None) -> Place | None:
        '''
        a GeoNames country and region as codes the database holds
        '''
        if country in _US_TERRITORIES and f"US-{country}" in self._states:
            return Place("US", f"US-{country}")
        if country in self._countries:
            state = f"{country}-{admin1}" if admin1 else None
            return Place(country, state if state in self._states else None)
        if self._other is not None:
            return Place(self._other)
        return None
