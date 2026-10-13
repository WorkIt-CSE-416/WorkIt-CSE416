"""Tests for the company resolver: the companies a search names.

The names are real ones from the scraped feed. As with the role resolver, the
rules interact (a longer name beats a shorter one inside it, a one-word name
that is a search's own word is skipped, a typo needs one name close), so when
a search reads a company wrong, add it here before touching
app/services/company_resolver.py.
"""
import pytest

from app.services.company_resolver import CompanyResolver
from app.services.role_resolver import raw_words

NAMES = [
    "Stripe", "Strada", "SpaceX", "Palantir", "Waymo", "Jump Trading", "Bedrock Robotics",
    "Scale AI", "TribalScale", "Datadog", "Databricks", "Chicago Trading Company",
    "Squarepoint Capital", "Brightstar.AI", "Cloudflare",
]


@pytest.fixture(scope="module")
def companies():
    return CompanyResolver(NAMES)


def read(resolver, text):
    found = resolver.read(raw_words(text))
    return set(found.companies), list(found.rest)


@pytest.mark.parametrize(("text", "names", "rest"), [
    ("stripe", {"Stripe"}, []),
    ("Jump Trading quant intern", {"Jump Trading"}, ["quant", "intern"]),
    # whole words in a row, never a substring: "data" is not Datadog
    ("data engineer", set(), ["data", "engineer"]),
    # the longest name wins where two could start
    ("scale ai intern", {"Scale AI"}, ["intern"]),
    # a name's words are its own, ahead of any role ("robotics")
    ("bedrock robotics", {"Bedrock Robotics"}, []),
    # punctuation is gone, as in a title: "Brightstar.AI" is "brightstar ai"
    ("brightstar.ai", {"Brightstar.AI"}, []),
    ("Brightstar AI", {"Brightstar.AI"}, []),
    # two companies: either, since a job has one
    ("stripe or palantir", {"Stripe", "Palantir"}, ["or"]),
    # part of a name is not the name: left for the text and the name's words
    ("squarepoint", set(), ["squarepoint"]),
    ("chicago", set(), ["chicago"]),
])
def test_read(companies, text, names, rest):
    assert read(companies, text) == (names, rest)


@pytest.mark.parametrize(("words", "names", "rest"), [
    (["strpe"], {"Stripe"}, []),          # Stripe 0.91, Strada 0.55: one is close
    (["stipe"], {"Stripe"}, []),
    (["spacx"], {"SpaceX"}, []),
    (["palntir"], {"Palantir"}, []),
    (["waimo"], {"Waymo"}, []),
    (["jump", "tradng"], {"Jump Trading"}, []),   # a pair, as one name
    # ordinary words are close to no whole name
    (["data"], set(), ["data"]),
    (["cloud"], set(), ["cloud"]),
    (["react"], set(), ["react"]),
    (["security"], set(), ["security"]),
    # under five letters nothing is corrected
    (["strp"], set(), ["strp"]),
])
def test_correct(companies, words, names, rest):
    fixed = companies.correct(words)
    assert (set(fixed.companies), list(fixed.rest)) == (names, rest)


def test_a_typo_close_to_two_names_is_left_alone():
    # "brexs" is 0.89 from Brex and 0.8 from Brexx: guessing would pick a
    # company at random.
    resolver = CompanyResolver(["Brex", "Brexx"])
    fixed = resolver.correct(["brexs"])
    assert fixed.companies == frozenset() and fixed.rest == ("brexs",)


def test_a_one_word_name_that_is_a_search_word_is_skipped():
    # A company called "Remote" mustn't turn every remote search into it.
    reserved = {("remote",), ("intern",)}
    resolver = CompanyResolver(["Remote", "Intern", "Stripe", "Remote Labs"], lambda key: key in reserved)
    assert read(resolver, "remote intern") == (set(), ["remote", "intern"])
    # a longer name holding the word is still a name
    assert read(resolver, "remote labs") == ({"Remote Labs"}, [])
    assert read(resolver, "stripe") == ({"Stripe"}, [])


def test_two_names_that_split_alike_are_both_the_company():
    resolver = CompanyResolver(["Scale AI", "Scale.ai"])
    assert read(resolver, "scale ai") == ({"Scale AI", "Scale.ai"}, [])


def test_no_names_finds_nothing():
    resolver = CompanyResolver([])
    assert read(resolver, "stripe intern") == (set(), ["stripe", "intern"])
    assert resolver.correct(["strpe"]).companies == frozenset()
