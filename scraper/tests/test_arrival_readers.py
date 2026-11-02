"""Bounded discovery must not turn a broken page into a successful prefix."""

from importlib import import_module
from unittest.mock import Mock

import pytest

from workit_scraper.providers import PROVIDERS, fetch
from workit_scraper.providers.model import BoardNotFound, Incomplete, Job, Provider, TooLarge


@pytest.fixture(params=["workday", "oracle", "jibe"])
def reader(request, monkeypatch):
    name = request.param
    module = import_module(f"workit_scraper.providers.systems.{name}")
    monkeypatch.setattr(module, f"{name.upper()}_PAGE", 2)
    token = {"workday": "example.wd5/jobs", "oracle": "example/CX", "jibe": "example.com"}[name]

    def payload(total, ids):
        if name == "workday":
            return {
                "total": total,
                "jobPostings": [{"externalPath": f"/job/{i}", "title": "Intern"} for i in ids],
            }
        if name == "oracle":
            return {
                "items": [
                    {
                        "TotalJobsCount": total,
                        "requisitionList": [{"Id": str(i), "Title": "Intern"} for i in ids],
                    }
                ]
            }
        return {
            "totalCount": total,
            "jobs": [
                {"data": {"slug": str(i), "title": "Intern", "ats_code": "icims"}} for i in ids
            ],
        }

    def setup(pages):
        events = []
        answers = iter(pages)

        def request_page(*args):
            events.append(("request", args))
            answer = next(answers)
            if isinstance(answer, Exception):
                raise answer
            return answer

        monkeypatch.setattr(fetch, "_post_json" if name == "workday" else "_get_json", request_page)

        def pace(url):
            events.append(("pace", url))

        return events, pace

    return name, module, token, payload, setup


def test_registered_prefix_bypasses_max_and_paces(reader):
    name, module, token, payload, setup = reader
    total = getattr(module, f"{name.upper()}_MAX") + 1
    events, pace = setup([payload(total, [1, 2]), payload(total, [3, 4])])
    jobs = PROVIDERS[name].arrival(token, "Example", pace=pace)
    assert len(jobs) == 4
    assert [event[0] for event in events] == ["request", "pace", "request"]
    if name == "workday":
        bodies = [event[1][1] for event in events if event[0] == "request"]
        assert [body["offset"] for body in bodies] == [0, 2]
        assert all(body["appliedFacets"] == {} for body in bodies)
    else:
        urls = [event[1][0] for event in events if event[0] == "request"]
        assert ("offset=2" if name == "oracle" else "page=2") in urls[1]


def test_full_reader_still_rejects_over_max(reader):
    name, module, token, payload, setup = reader
    events, pace = setup([payload(getattr(module, f"{name.upper()}_MAX") + 1, [1, 2])])
    with pytest.raises(TooLarge):
        PROVIDERS[name].read(token, "Example", pace=pace)
    assert len(events) == 1


@pytest.mark.parametrize("limit", [1, 3])
def test_custom_limit(reader, limit):
    name, _, token, payload, setup = reader
    events, pace = setup([payload(20, [i * 2 + 1, i * 2 + 2]) for i in range(limit)])
    assert len(PROVIDERS[name].read(token, "Example", pace=pace, page_limit=limit)) == limit * 2
    assert len(events) == limit * 2 - 1


@pytest.mark.parametrize("total,ids", [(0, []), (1, [1]), (2, [1, 2])])
def test_natural_end_before_limit(reader, total, ids):
    name, _, token, payload, setup = reader
    events, pace = setup([payload(total, ids)])
    assert len(PROVIDERS[name].arrival(token, "Example", pace=pace)) == total
    assert len(events) == 1


@pytest.mark.parametrize("bad_ids", [[], [3]])
@pytest.mark.parametrize("bad_page", [1, 2])
def test_incomplete_pages_fail_even_at_limit(reader, bad_ids, bad_page):
    name, _, token, payload, setup = reader
    pages = [payload(10, [1, 2])] * (bad_page - 1) + [payload(10, bad_ids)]
    _, pace = setup(pages)
    with pytest.raises(Incomplete):
        PROVIDERS[name].arrival(token, "Example", pace=pace)


@pytest.mark.parametrize("bad_page", [1, 2])
def test_malformed_pages_fail(reader, bad_page):
    name, _, token, payload, setup = reader
    _, pace = setup([payload(10, [1, 2])] * (bad_page - 1) + [{}])
    with pytest.raises(Incomplete):
        PROVIDERS[name].arrival(token, "Example", pace=pace)


def test_request_failure_is_not_a_prefix(reader):
    name, _, token, payload, setup = reader
    events, pace = setup([payload(10, [1, 2]), TimeoutError("unavailable")])
    with pytest.raises(TimeoutError):
        PROVIDERS[name].arrival(token, "Example", pace=pace)
    assert [event[0] for event in events] == ["request", "pace", "request"]


@pytest.mark.parametrize("limit", [0, -1])
def test_invalid_limit_makes_no_requests(reader, limit):
    name, _, token, _, setup = reader
    events, pace = setup([])
    with pytest.raises(ValueError):
        PROVIDERS[name].read(token, "Example", pace=pace, page_limit=limit)
    assert events == []


@pytest.mark.parametrize("malformed", [{"items": {}}, {"items": [{"TotalJobsCount": None}]}])
def test_oracle_malformed_empty_response_is_not_an_empty_board(monkeypatch, malformed):
    monkeypatch.setattr(fetch, "_get_json", lambda url: malformed)
    with pytest.raises(Incomplete):
        PROVIDERS["oracle"].arrival("example/CX", "Example")


def test_overlapping_pages_fail_for_distinct_count_readers(reader):
    name, _, token, payload, setup = reader
    if name == "jibe":
        pytest.skip("Jibe deliberately counts served rows, including duplicates")
    _, pace = setup([payload(10, [1, 2]), payload(10, [1, 2])])
    with pytest.raises(Incomplete):
        PROVIDERS[name].arrival(token, "Example", pace=pace)


def test_full_read_still_checks_completeness(reader):
    name, _, token, payload, setup = reader
    _, pace = setup([payload(6, [1, 2]), payload(6, [])])
    with pytest.raises(Incomplete):
        PROVIDERS[name].read(token, "Example", pace=pace)


def test_workday_prefix_bypasses_cap_and_slices(monkeypatch):
    module = import_module("workit_scraper.providers.systems.workday")
    monkeypatch.setattr(module, "WORKDAY_PAGE", 1)
    slices = Mock(side_effect=AssertionError("must not slice an arrival read"))
    monkeypatch.setattr(module, "_workday_slices", slices)
    post = Mock(
        side_effect=[
            {"total": module.WORKDAY_CAP, "jobPostings": [{"externalPath": "/job/1"}]},
            {"total": 0, "jobPostings": [{"externalPath": "/job/2"}]},
        ]
    )
    monkeypatch.setattr(fetch, "_post_json", post)
    assert len(module.PROVIDER.arrival("example.wd5/jobs", "Example")) == 2
    slices.assert_not_called()


def test_provider_metadata():
    assert PROVIDERS["oracle"].newest_first is True
    assert "POSTING_DATES_DESC" in PROVIDERS["oracle"].listing_url
    assert not PROVIDERS["workday"].newest_first
    assert not PROVIDERS["jibe"].newest_first
    provider = Provider("url", lambda: [], PROVIDERS["jibe"].apply_link)
    assert provider.arrival is None
    assert not provider.newest_first


@pytest.mark.parametrize("name", ["workday", "oracle"])
@pytest.mark.parametrize("tags", [(), ("new_grad",)])
def test_detail_classification_uses_full_text(monkeypatch, name, tags):
    from workit_scraper import shortlist

    full = "Requirements: " + "Experience. " * 1000 + "Requires 1 year of experience."
    classify = Mock(return_value=tags)
    monkeypatch.setattr(shortlist, "classify_with_description", classify)
    payload = (
        {"jobPostingInfo": {"jobDescription": full}}
        if name == "workday"
        else {"items": [{"ExternalDescriptionStr": full}]}
    )
    monkeypatch.setattr(fetch, "_get_json", lambda url: payload)
    token = "example.wd5/jobs" if name == "workday" else "example/CX"
    job = Job(name, token, "Example", "123", "Engineer", "https://example.com/job")
    result = PROVIDERS[name].describe(job)
    assert result.shortlist_tags == tags
    assert result.page is not None
    assert classify.call_args.args[0] == job.title
    assert classify.call_args.args[1].endswith("Requires 1 year of experience.")
    assert len(classify.call_args.args[1]) > len(result.description)


def test_missing_later_page_is_not_a_missing_board(reader):
    name, _, token, payload, setup = reader
    _, pace = setup([payload(10, [1, 2]), BoardNotFound("page two")])
    with pytest.raises(Incomplete):
        PROVIDERS[name].arrival(token, "Example", pace=pace)
