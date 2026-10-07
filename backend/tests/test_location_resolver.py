"""Regression tests for the location resolver.

Most cases are real strings from scraped job boards, each in a shape that
needs a rule of its own; the rest are shapes the feed doesn't hold yet but
plainly will. The rules interact — a fix for one shape has broken another
while this was written — so when a new string resolves wrong, add it here with
what it should give before touching app/services/location_resolver.py.
"""
import importlib.util
from pathlib import Path

import pytest

from app.services.location_resolver import LocationResolver, Place

# The states the database holds, read from the migration that seeds them, so
# these tests follow the seed rather than a copy of it.
_SEED = Path(__file__).parents[1] / "alembic" / "versions" / "6b5bd2831d18_seed_us_states.py"
_spec = importlib.util.spec_from_file_location("seed_us_states", _SEED)
_seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_seed)
US_STATES = dict(_seed.US_STATES)


@pytest.fixture(scope="module")
def resolver():
    return LocationResolver({"US", "ZZ"}, US_STATES)


def codes(resolver, text):
    return [p.state or p.country for p in resolver.resolve(text).places]


CASES = [
    # city, state / city, state, country — in codes and in full
    ("San Francisco, CA", ["US-CA"]),
    ("Champaign, Illinois", ["US-IL"]),
    ("Mountain View, California, United States", ["US-CA"]),
    ("Boston, MA, USA", ["US-MA"]),
    ("Cambridge, MA USA", ["US-MA"]),
    # a city that is also a state's name, then its state
    ("New York, NY", ["US-NY"]),
    ("New York, New York, United States", ["US-NY"]),
    ("Washington, D.C.", ["US-DC"]),
    # several places in one comma list, and with separators
    ("Cambridge, MA, Arlington, VA, Seattle, WA", ["US-MA", "US-VA", "US-WA"]),
    ("Seattle, San Francisco", ["US-WA", "US-CA"]),
    ("New York, Seattle, South San Francisco HQ", ["US-NY", "US-WA", "US-CA"]),
    ("San Francisco, CA • New York, NY", ["US-CA", "US-NY"]),
    ("Addison, TX; Montpelier, VT", ["US-TX", "US-VT"]),
    ("Denver, CO or Long Beach, CA.", ["US-CO", "US-CA"]),
    ("San Francisco, CA and New York City, NY", ["US-CA", "US-NY"]),
    ("London, England, New York, New York", ["ZZ", "US-NY"]),
    # a name that could qualify the one before but doesn't fit it
    ("Austin, New York", ["US-TX", "US-NY"]),
    # "OR" is Oregon; only a lowercase " or " between names is a list
    ("Portland, OR", ["US-OR"]),
    ("Beijing OR Shanghai", ["ZZ"]),
    # two letters: a US state before a country, unless the city says otherwise
    ("Indianapolis, IN", ["US-IN"]),
    ("Berlin, DE", ["ZZ"]),
    ("Amsterdam, NL", ["ZZ"]),
    ("Perth, WA", ["ZZ"]),
    # a city too small for the data, or not the one the data knows by that name
    ("Montpelier, VT", ["US-VT"]),
    ("Springfield, VT", ["US-VT"]),
    # outside the US is the catch-all, however it is written
    ("London, England, United Kingdom", ["ZZ"]),
    ("Montréal, Quebec, Canada", ["ZZ"]),
    ("Toronto, ON", ["ZZ"]),
    ("Surrey, BC", ["ZZ"]),
    ("Bengaluru, Karnataka, India", ["ZZ"]),
    ("Türkiye, Remote", ["ZZ"]),
    ("Europe", ["ZZ"]),
    # a city alone: the biggest of the name, a US one of comparable size first
    ("Austin", ["US-TX"]),
    ("Cambridge", ["US-MA"]),
    ("London", ["ZZ"]),
    ("Paris", ["ZZ"]),
    # a name alone that is several things
    ("Georgia", ["US-GA"]),
    ("New York", ["US-NY"]),
    ("Ontario", ["ZZ"]),
    ("Singapore", ["ZZ"]),
    ("San Jose", ["US-CA"]),
    ("St. Louis", ["US-MO"]),
    # US territories are US states in the seed
    ("San Juan, PR", ["US-PR"]),
    # country only
    ("United States", ["US"]),
    ("Remote - US", ["US"]),
    ("United States (Remote)", ["US"]),
    # names run together without commas
    ("US-WA-Bellevue", ["US-WA"]),
    ("MN-Lakeville", ["US-MN"]),
    ("Long Beach CA", ["US-CA"]),
    ("Toronto Canada", ["ZZ"]),
    ("Remote in the UK", ["ZZ"]),
    ("Lafayette IN", ["US-IN"]),
    # filler around the place
    ("HQ: San Francisco", ["US-CA"]),
    ("Mountain View, California (HQ)", ["US-CA"]),
    ("London Office", ["ZZ"]),
    ("Hybrid - New York, NY", ["US-NY"]),
    ("Greater Boston Area", ["US-MA"]),
    # nicknames and regions the data knows, or the aliases cover
    ("NYC", ["US-NY"]),
    ("sf", ["US-CA"]),
    ("Bay Area", ["US-CA"]),
    # "and" in a name is not a list
    ("Newfoundland and Labrador", ["ZZ"]),
    ("Seattle and Austin", ["US-WA", "US-TX"]),
    # a misspelt state
    ("Middletown, Pennslyvania", ["US-PA"]),
    # a street address
    ("Avenida das Nações Unidas, 12901,11° andar São Paulo", ["ZZ"]),
    # neighbourhoods GeoNames lists as cities don't take over a real one
    ("Mount Pleasant, SC", ["US-SC"]),
]


@pytest.mark.parametrize(("text", "expected"), CASES)
def test_resolves(resolver, text, expected):
    assert codes(resolver, text) == expected


@pytest.mark.parametrize("text", [
    None, "", "Remote", "Hybrid", "In-Office", "Multiple Locations", "Home based - Worldwide",
    "Any Location", "N/A",
])
def test_no_place_named(resolver, text):
    result = resolver.resolve(text)
    assert result.places == ()
    # Nothing to log: these name no place, rather than one the data lacks.
    assert result.unresolved == ()


def test_unknown_place_is_reported(resolver):
    result = resolver.resolve("RWC HQ")
    assert result.places == ()
    assert result.unresolved == ("RWC HQ",)


def test_duplicates_collapse(resolver):
    text = "Mountain View, CA, USA; San Francisco, CA, USA"
    assert resolver.resolve(text).places == (Place("US", "US-CA"),)


def test_new_seed_needs_no_code_change():
    # Seeding the UK with England as a state: the same strings now resolve to
    # it, because codes are checked against what the resolver is given.
    resolver = LocationResolver({"US", "GB", "ZZ"}, {**US_STATES, "GB-ENG": "England"})
    assert resolver.resolve("London, England, United Kingdom").places == (Place("GB", "GB-ENG"),)
    assert resolver.resolve("Edinburgh, Scotland").places == (Place("GB"),)
    assert resolver.resolve("Toronto, ON").places == (Place("ZZ"),)


def test_without_catch_all_unseeded_places_are_dropped():
    resolver = LocationResolver({"US"}, US_STATES)
    assert resolver.resolve("London; Austin").places == (Place("US", "US-TX"),)
