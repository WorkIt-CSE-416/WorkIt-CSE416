'''
resolves location text to the ISO codes stored in countries / states, and back

Built from the rows of those two tables, never from pycountry directly, so every
code it returns is one the job_postings foreign keys will accept. Load it once
and reuse it; every lookup after that is a dict hit.
'''
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.locations import Country, State

# Names people write that are not the name stored in countries.name. Only add
# what the table cannot produce itself; the code and stored name already match.
COUNTRY_ALIASES = {
    "usa": "US",
    "united states of america": "US",
    "america": "US",
    "uk": "GB",
    "great britain": "GB",
    "britain": "GB",
    "england": "GB",
    "scotland": "GB",
    "wales": "GB",
    "northern ireland": "GB",
    "uae": "AE",
    "russia": "RU",
    "turkey": "TR",
    "czech republic": "CZ",
    "korea": "KR",
    "holland": "NL",
    "ivory coast": "CI",
    "brunei": "BN",
    "burma": "MM",
    "cape verde": "CV",
    "swaziland": "SZ",
    "macedonia": "MK",
}

STATE_ALIASES = {
    "washington dc": "US-DC",
}


@dataclass(frozen=True)
class ResolvedLocation:
    country_code: str
    state_code: str | None = None


def normalize(text: str) -> str:
    '''
    lowercase, strip accents and periods, collapse whitespace, so "U.S.",
    "us" and " US " are one key and "Türkiye" matches "turkiye"
    '''
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.casefold().replace(".", "")
    return re.sub(r"\s+", " ", text).strip()


class LocationResolver:
    '''
    two-way lookup between location text and ISO codes

        country_code("United States") -> "US"     country_name("US") -> "United States"
        state_code("NY") -> "US-NY"               state_name("US-NY") -> "New York"
        resolve("Austin, TX") -> ResolvedLocation("US", "US-TX")
    '''

    def __init__(
        self,
        countries: Iterable[tuple[str, str]],
        states: Iterable[tuple[str, str, str]],
    ) -> None:
        '''
        countries: (code, name) rows. states: (code, country_code, name) rows
        '''
        self._country_names: dict[str, str] = {}
        self._country_by_key: dict[str, str] = {}
        for code, name in countries:
            self._country_names[code] = name
            self._country_by_key[normalize(code)] = code
            self._country_by_key[normalize(name)] = code
        for alias, code in COUNTRY_ALIASES.items():
            if code in self._country_names:
                self._country_by_key[alias] = code

        self._state_names: dict[str, str] = {}
        self._state_country: dict[str, str] = {}
        # keyed per country, because abbreviations repeat across countries:
        # "WA" is Washington in the US and Western Australia in AU
        self._state_by_key: dict[str, dict[str, str]] = {}
        for code, country_code, name in states:
            self._state_names[code] = name
            self._state_country[code] = country_code
            keys = self._state_by_key.setdefault(country_code, {})
            keys[normalize(name)] = code
            keys[normalize(code)] = code                   # "us-ny"
            keys[normalize(code.split("-", 1)[1])] = code  # "ny"
        for alias, code in STATE_ALIASES.items():
            if code in self._state_names:
                self._state_by_key[self._state_country[code]][alias] = code

    @classmethod
    async def load(cls, session: AsyncSession) -> "LocationResolver":
        '''
        build from the database. Two small queries; call once per process
        '''
        countries = await session.execute(select(Country.code, Country.name))
        states = await session.execute(select(State.code, State.country_code, State.name))
        return cls(countries.tuples(), states.tuples())

    # --- code -> name ------------------------------------------------------

    def country_name(self, code: str) -> str | None:
        return self._country_names.get(code.upper())

    def state_name(self, code: str) -> str | None:
        return self._state_names.get(code.upper())

    # --- name -> code ------------------------------------------------------

    def country_code(self, text: str) -> str | None:
        '''
        "United States", "USA", "us", "U.S." -> "US"
        '''
        return self._country_by_key.get(normalize(text))

    def state_code(self, text: str, country_code: str | None = None) -> str | None:
        '''
        "New York", "NY", "US-NY" -> "US-NY"

        Without a country, a name or abbreviation found in several countries
        resolves to the US one if there is one and to nothing otherwise. Pass
        the country whenever it is known.
        '''
        key = normalize(text)
        if country_code is not None:
            return self._state_by_key.get(country_code.upper(), {}).get(key)

        matches = [keys[key] for keys in self._state_by_key.values() if key in keys]
        if len(matches) == 1:
            return matches[0]
        return next((m for m in matches if m.startswith("US-")), None)

    # --- free text -> codes ------------------------------------------------

    def resolve(self, text: str) -> ResolvedLocation | None:
        '''
        comma-separated posting text, read from the right:

            "New York, NY"               -> US, US-NY
            "Austin, Texas, USA"         -> US, US-TX
            "Toronto, ON, Canada"        -> CA, CA-ON (or CA alone until CA states are seeded)
            "Germany"                    -> DE
            "San Francisco"              -> None; a city alone needs city data

        The last part is tried as a state before a country. Two-letter codes
        collide constantly ("CA" California/Canada, "IN" Indiana/India, "DE"
        Delaware/Germany), and in "City, XX" postings XX is overwhelmingly a US
        state. The cost: "Berlin, DE" resolves to Delaware. "Berlin, Germany"
        resolves correctly.
        '''
        parts = [p for p in (part.strip() for part in text.split(",")) if p]
        if not parts:
            return None
        last = parts[-1]

        state = self.state_code(last)
        if state is not None:
            return ResolvedLocation(self._state_country[state], state)

        country = self.country_code(last)
        if country is None:
            return None
        if len(parts) >= 2:
            state = self.state_code(parts[-2], country)
        return ResolvedLocation(country, state)
