import json
from copy import deepcopy
from pathlib import Path

import pytest

from workit_scraper.catalog import load_boards
from workit_scraper.discovery_review import ReviewUpdate, reconcile, render_review, validate_catalog
from workit_scraper.providers import Board

AT = "2026-10-28T12:00:00+00:00"
ACME = Board("lever", "acme", "Acme")
BASE = Board("lever", "existing", "Existing")


def candidate(token="acme", company="Acme", **overrides):
    return {
        "ats": "lever",
        "token": token,
        "companies": [company],
        "status": "validated",
        "postings": 4,
        "evidence": [
            {
                "url": f"https://jobs.lever.co/{token}",
                "company": company,
                "source": "https://news.ycombinator.com/item?id=1",
            }
        ],
        **overrides,
    }


def report(*rows):
    return {"generated_at": AT, "candidates": list(rows)}


def proposed(**overrides):
    return {**candidate(), "decision": "proposed", "validated_at": AT, **overrides}


def test_first_proposal_preserves_catalog_and_records_provenance():
    result = reconcile([BASE], [BASE], {}, report(candidate()))
    assert result.boards == [ACME, BASE]
    assert result.added == 1
    assert result.ledger == {ACME.key: proposed()}


def test_repeat_run_is_idempotent_and_preserves_history():
    first = reconcile([BASE], [BASE], {}, report(candidate()))
    second = reconcile(
        [BASE],
        first.boards,
        first.ledger,
        {"generated_at": "later", "candidates": [candidate(postings=40)]},
    )
    assert second.boards == first.boards
    assert second.ledger == first.ledger
    assert second.added == 0


def test_removed_row_is_rejected_and_never_restored():
    ledger = {ACME.key: proposed()}
    result = reconcile([BASE], [BASE], ledger, report(candidate()))
    assert result.boards == [BASE]
    assert result.ledger[ACME.key]["decision"] == "rejected"
    again = reconcile([BASE], [BASE], result.ledger, report(candidate()))
    assert again == result
    assert ledger[ACME.key]["decision"] == "proposed"


def test_removal_merged_before_next_run_is_still_rejected():
    # Main contains the ledger but the reviewer deleted the proposed CSV row.
    result = reconcile([BASE], [BASE], {ACME.key: proposed()}, report(candidate()))
    assert result.ledger[ACME.key]["decision"] == "rejected"
    assert result.boards == [BASE]


def test_explicit_rejection_removes_pending_row_but_keeps_reason():
    ledger = {ACME.key: proposed(decision="rejected", reason="Wrong Acme")}
    result = reconcile([BASE], [BASE, ACME], ledger, report(candidate()))
    assert result.boards == [BASE]
    assert result.ledger == ledger


def test_main_is_authoritative_even_if_ledger_says_rejected():
    corrected = Board("lever", "acme", "Acme Incorporated")
    result = reconcile(
        [corrected], [ACME], {ACME.key: proposed(decision="rejected")}, report(candidate())
    )
    assert result.boards == [corrected]
    assert result.added == 0


def test_ledger_only_rejection_cannot_pass_catalog_validation_before_merge():
    with pytest.raises(ValueError, match="Remove rejected CSV rows before merge.*lever/acme"):
        validate_catalog([BASE, ACME], {ACME.key: proposed(decision="rejected")})


def test_rejected_board_merged_without_reconciliation_is_not_safe_to_scrape():
    ledger = {ACME.key: proposed(decision="rejected")}
    result = reconcile([BASE, ACME], [BASE, ACME], ledger, report())
    # Reconciliation preserves main; the scrape/publication boundary must refuse it.
    assert ACME in result.boards
    with pytest.raises(ValueError, match="lever/acme"):
        validate_catalog(result.boards, result.ledger)


def test_removed_rejected_rows_and_proposed_rows_pass_catalog_validation():
    validate_catalog(iter([BASE]), {ACME.key: proposed(decision="rejected")})
    validate_catalog(iter([BASE, ACME]), {ACME.key: proposed()})
    validate_catalog([], {})


@pytest.mark.parametrize(
    "ledger",
    [
        [],
        {"/acme": {"decision": "rejected"}},
        {"lever/": {"decision": "rejected"}},
        {"lever/acme": {"decision": []}},
        {"lever/acme": {"decision": {}}},
        {"lever/acme": None},
        {"lever/acme": {"decision": "approved"}},
    ],
)
def test_catalog_validation_rejects_malformed_ledger(ledger):
    with pytest.raises(ValueError, match="review ledger"):
        validate_catalog([], ledger)


def test_repository_catalog_contains_no_rejected_boards():
    # This intentionally checks committed review data, not a synthetic fixture:
    # a discovery PR that leaves a rejected row in its CSV must fail scraper CI.
    scraper = Path(__file__).resolve().parents[1]
    ledger_path = scraper / "discovery-review.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {}
    validate_catalog(load_boards(scraper / "boards.csv"), ledger)


def test_main_rows_deleted_from_proposal_are_restored():
    result = reconcile([BASE], [], {}, report())
    assert result.boards == [BASE]


def test_developer_company_edit_and_ledger_notes_survive():
    corrected = Board("lever", "acme", "Acme Incorporated")
    ledger = {ACME.key: proposed(notes="Checked official site")}
    result = reconcile([BASE], [BASE, corrected], ledger, report(candidate()))
    assert corrected in result.boards
    assert ACME not in result.boards
    assert result.ledger == ledger
    rendered = render_review(result, [BASE])
    assert "Acme Incorporated" in rendered


@pytest.mark.parametrize(
    "change",
    [
        {"status": "not_found"},
        {"status": "unread:timeout"},
        {"status": "needs_company", "companies": []},
        {"status": "conflicting_companies", "companies": ["Acme", "Other"]},
        {"companies": ["  "]},
        {"companies": "Acme"},
        {"evidence": []},
        {"postings": None},
        {"postings": -1},
        {"postings": True},
        {"evidence": [{"url": "https://jobs.lever.co/other", "company": "Acme", "source": "HN"}]},
        {
            "evidence": [
                {"url": "https://eviljobs.lever.co/acme", "company": "Acme", "source": "HN"}
            ]
        },
        {"evidence": [{"url": "https://jobs.lever.co/acme", "company": "Other", "source": "HN"}]},
        {"evidence": [{"url": "https://jobs.lever.co/acme", "company": "Acme", "source": ""}]},
    ],
)
def test_unreviewable_candidates_are_not_proposed(change):
    result = reconcile([BASE], [BASE], {}, report(candidate(**change)))
    assert result.boards == [BASE]
    assert result.ledger == {}


def test_empty_complete_board_is_reviewable():
    result = reconcile([], [], {}, report(candidate(postings=0)))
    assert result.boards == [ACME]


def test_duplicate_candidate_rows_do_not_add_twice():
    result = reconcile([], [], {}, report(candidate(), candidate()))
    assert result.added == 1
    assert result.boards == [ACME]


def test_duplicate_candidate_rows_with_conflicting_names_are_not_proposed():
    result = reconcile([], [], {}, report(candidate(), candidate(company="Other")))
    assert result.boards == []


@pytest.mark.parametrize(
    "ledger",
    [
        [],
        {"lever/acme": {}},
        {"lever/acme": None},
        {"bad-key": {"decision": "proposed"}},
        {"lever/acme": {"decision": "approved"}},
    ],
)
def test_bad_ledger_fails_closed(ledger):
    with pytest.raises(ValueError, match="ledger"):
        reconcile([], [], ledger, report(candidate()))


@pytest.mark.parametrize(
    "payload", [None, [], {}, {"candidates": []}, {"candidates": {}, "generated_at": AT}]
)
def test_bad_report_fails_closed(payload):
    with pytest.raises(ValueError, match="report"):
        reconcile([], [], {}, payload)


def test_reconcile_does_not_mutate_input_report_or_ledger():
    payload = report(candidate())
    before = deepcopy(payload)
    result = reconcile([], [], {}, payload)
    result.ledger[ACME.key]["evidence"][0]["company"] = "modified"
    assert payload == before


def test_render_has_read_date_posting_count_and_unconfirmed_ownership():
    result = reconcile([BASE], [BASE], {}, report(candidate()))
    rendered = render_review(result, [BASE])
    assert AT in rendered
    assert "Postings: <code>4</code>" in rendered
    assert "https://jobs.lever.co/acme" in rendered
    assert "https://news.ycombinator.com/item?id=1" in rendered
    assert "Unconfirmed; developer review required" in rendered
    assert "lever/existing" not in rendered


def test_render_escapes_source_provided_markdown_html_and_urls():
    company = '<img src=x onerror="alert(1)"> | [approve](https://evil.example) @everyone'
    row = candidate(company=company)
    row["evidence"][0]["source"] = 'https://example.com/"><script>alert(1)</script>'
    result = reconcile([], [], {}, report(row))
    rendered = render_review(result, [])
    assert "<img" not in rendered
    assert "<script>" not in rendered
    assert "&lt;img" in rendered
    assert "<code>&lt;img" in rendered
    assert 'href="https://example.com/"' not in rendered


def test_render_does_not_link_non_http_source():
    result = ReviewUpdate(
        [ACME],
        {
            ACME.key: proposed(
                evidence=[
                    {
                        "url": "javascript:alert(1)",
                        "source": "data:text/html,bad",
                        "company": "Acme",
                    },
                ]
            )
        },
        0,
    )
    rendered = render_review(result, [])
    assert "href=" not in rendered
    assert "<code>javascript:alert(1)</code>" in rendered
