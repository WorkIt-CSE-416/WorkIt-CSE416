"""The Top 500, Not open yet and Quant tabs, written from a research results
file, as Lisul reads them in the Sheet."""

import json
import re

from trackers import FakeSpreadsheet

from apply import rankings
from apply.rankings import RANKED_HEADERS, write_rankings
from apply.sheet import APPLICATIONS, TABS


def company(rank: int, name: str | None = None, **fields) -> dict:
    return {
        "rank": rank, "company": name or f"Company {rank}", "tier": 1 + rank // 200,
        "pay_hourly": 50, "innovation": 7, "quant": False, "open": True,
        "role": "Software Engineer Intern", "url": f"https://jobs.example.com/{rank}",
        "location": "New York, NY", "verified": "loaded", "note": "", "checked": "2026-10-26",
        **fields,
    }


def results(tmp_path, companies: list[dict]):
    path = tmp_path / "results.json"
    path.write_text(json.dumps(companies))
    return path


def test_rankings_top_500_holds_the_first_500_open_non_quant_companies_in_rank_order(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    # Out of order in the file, with closed companies and Quant firms mixed in.
    companies = [company(rank) for rank in range(600, 0, -1)]
    companies[10]["open"] = False  # rank 590, past the cutoff anyway
    companies[-3] = company(3, "Jane Street", quant=True)
    companies[-5] = company(5, "Shut Inc", open=False)

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    header, *rows = spreadsheet.worksheet("Top 500").get_all_values()
    assert header == RANKED_HEADERS
    assert [row[0] for row in rows] == [str(n) for n in range(1, 501)]
    assert [row[1] for row in rows[:4]] == ["Company 1", "Company 2", "Company 4", "Company 6"]
    assert rows[-1][1] == "Company 502"
    assert rows[0][2:4] == ["1", "Software Engineer Intern"]
    assert rows[0][5] == "New York, NY"
    assert rows[0][7] == "2026-10-26"


def test_rankings_rerun_replaces_the_rows_and_leaves_applications_alone(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS, blank_rows=3)
    applications = spreadsheet.worksheet(APPLICATIONS)
    applications.append_row(["a1", "DoorDash USA", "Intern", "https://doordash.com/1", "greenhouse",
                             "submitted", "2026-10-20"] + [""] * 11)
    before = applications.load()
    lock = tmp_path / "tracker.lock"

    def companies(last: int) -> list[dict]:
        return [company(rank, quant=rank % 3 == 0, open=rank % 4 != 0) for rank in range(1, last + 1)]

    tabs = ["Top 500", "Not open yet", "Quant"]
    write_rankings(spreadsheet, results(tmp_path, companies(12)), lock=lock)
    first = [spreadsheet.worksheet(tab).load() for tab in tabs]
    write_rankings(spreadsheet, results(tmp_path, companies(12)), lock=lock)
    assert [spreadsheet.worksheet(tab).load() for tab in tabs] == first
    # A smaller file on the rerun leaves no stale rows behind.
    write_rankings(spreadsheet, results(tmp_path, companies(3)), lock=lock)
    assert [len(spreadsheet.worksheet(tab).get_all_values()) for tab in tabs] == [3, 1, 2]

    assert applications.load() == before


def test_rankings_link_each_posting_as_apply_and_show_applied_from_submitted_applications(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    companies = [company(1, "Google"), company(2, "DoorDash", url='https://careers.doordash.com/?q="intern"')]

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    _, google, doordash = spreadsheet.worksheet("Top 500").get_all_values()
    assert google[4] == '=HYPERLINK("https://jobs.example.com/1","Apply")'
    assert doordash[4] == '=HYPERLINK("https://careers.doordash.com/?q=""intern""","Apply")'
    # Applications: Company in B, Status in F, Date applied in G. Only
    # submitted rows count, and the latest Date applied shows beside the tick,
    # as an ISO date even when Lisul typed it by hand.
    pattern = re.escape(r'"(^|[^a-z0-9])doordash($|[^a-z0-9])"')
    assert re.fullmatch(
        r'=IFERROR\("✓ "&INDEX\(SORT\(FILTER\(TEXT\(\'Applications\'!\$G\$2:\$G,"yyyy-mm-dd"\),'
        r'REGEXMATCH\(LOWER\(\'Applications\'!\$B\$2:\$B\),' + pattern + r'\),'
        r'\'Applications\'!\$F\$2:\$F="submitted"\),1,FALSE\),1\),""\)',
        doordash[6],
    )


def company_pattern(formula: str) -> str:
    """The regex an Applied formula matches the Applications tab's Company
    against (lowercased), as Sheets' RE2 reads it."""
    return re.search(r'REGEXMATCH\(LOWER\([^)]*\),"((?:[^"]|"")*)"\)', formula).group(1).replace('""', '"')


def test_rankings_applied_matches_the_company_as_a_whole_word(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    names = ["Meta", "Arc", "Box", "DoorDash", "Point72", "Palantir", "C3.ai", "AT&T"]
    write_rankings(spreadsheet, results(tmp_path, [company(n, name) for n, name in enumerate(names, 1)]),
                   lock=tmp_path / "tracker.lock")
    rows = spreadsheet.worksheet("Top 500").get_all_values()[1:]
    patterns = {row[1]: company_pattern(row[6]) for row in rows}

    def matches(name: str, applications_company: str) -> bool:
        return re.search(patterns[name], applications_company.lower()) is not None

    assert matches("DoorDash", "DoorDash USA")
    assert matches("Point72", "Point72 ")
    assert matches("Palantir", "Palantir Technologies")
    assert matches("Meta", "meta")
    assert matches("C3.ai", "C3.ai Inc")
    assert matches("AT&T", "AT&T")
    assert not matches("Meta", "Metamorphic")
    assert not matches("Arc", "Arcesium")
    assert not matches("Box", "Dropbox")
    assert not matches("C3.ai", "C3xai")


def test_rankings_not_open_yet_lists_closed_companies_ranked_above_the_cutoff(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    companies = [company(rank) for rank in range(1, 601)]
    companies[4] = company(5, "Shut Inc", open=False, note="Summer 2027 not posted yet")
    companies[9] = company(10, "Quiet Co", open=False, note="Hiring paused", role="", url="", location="")
    companies[249] = company(250, "Jane Street", quant=True, open=False, note="Closed")
    companies[589] = company(590, "Late Inc", open=False, note="Closed")  # below the cutoff (rank 503)

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    assert spreadsheet.worksheet("Not open yet").get_all_values() == [
        ["Rank", "Company", "Tier", "Why not open", "Checked"],
        ["5", "Shut Inc", "1", "Summer 2027 not posted yet", "2026-10-26"],
        ["10", "Quiet Co", "1", "Hiring paused", "2026-10-26"],
    ]


def test_rankings_quant_holds_open_quant_firms_only_and_they_stay_off_the_top_500(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    companies = [
        company(1, "Google"),
        company(2, "Jane Street", quant=True, url="https://janestreet.com/1"),
        company(3, "Capital One"),
        company(4, "Stripe"),
        company(5, "Citadel", quant=True, open=False, role="", url="", location="", note="Closed"),
        company(6, "Two Sigma", quant=True, location="Houston, TX"),
    ]

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    top = spreadsheet.worksheet("Top 500").get_all_values()
    assert [row[1] for row in top[1:]] == ["Google", "Capital One", "Stripe"]
    header, *quant = spreadsheet.worksheet("Quant").get_all_values()
    assert header == RANKED_HEADERS
    assert [row[:2] for row in quant] == [["1", "Jane Street"], ["2", "Two Sigma"]]
    assert quant[0][4] == '=HYPERLINK("https://janestreet.com/1","Apply")'
    assert quant[1][5] == "Houston, TX"
    assert "two sigma" in company_pattern(quant[1][6])
    assert [row[1] for row in spreadsheet.worksheet("Not open yet").get_all_values()[1:]] == []


def rules(spreadsheet) -> list[dict]:
    return spreadsheet.fetch_sheet_metadata()["sheets"][0]["conditionalFormats"]


def test_rankings_band_each_tier_and_a_rerun_does_not_stack_the_bands(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    lisuls = {"ranges": [{"sheetId": 0, "startColumnIndex": 1, "endColumnIndex": 2}],
              "booleanRule": {"condition": {"type": "TEXT_CONTAINS", "values": [{"userEnteredValue": "Acme"}]}}}
    spreadsheet.batch_update({"requests": [{"addConditionalFormatRule": {"index": 0, "rule": lisuls}}]})
    path, lock = results(tmp_path, [company(rank) for rank in range(1, 10)]), tmp_path / "tracker.lock"

    write_rankings(spreadsheet, path, lock=lock)
    once = rules(spreadsheet)
    write_rankings(spreadsheet, path, lock=lock)

    assert rules(spreadsheet) == once
    # The fake keeps every tab's rules in one list: one band per tier, plus Lisul's own rule.
    bands = [rule["booleanRule"]["condition"]["values"][0]["userEnteredValue"] for rule in once if rule != lisuls]
    assert sorted(bands) == [f"=$C2={tier}" for tier in range(1, 6)]
    assert lisuls in once


def test_rankings_freeze_a_bold_header_with_a_filter_fitted_widths_and_the_method_note(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    companies = [company(1, "Google"), company(2, "Shut Inc", open=False, note="Closed"),
                 company(3, "Jane Street", quant=True)]

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    def each(kind: str) -> list[dict]:
        return [request[kind] for request in spreadsheet.requests if kind in request]

    # One of each per tab: Top 500, Not open yet and Quant.
    assert [r["properties"]["gridProperties"] for r in each("updateSheetProperties")] == [{"frozenRowCount": 1}] * 3
    assert len(each("setBasicFilter")) == 3
    bold = [r for r in each("repeatCell") if r["cell"]["userEnteredFormat"]["textFormat"]["bold"]]
    assert [r["range"]["endRowIndex"] for r in bold] == [1] * 3
    # A note on Rank: the ranking method on the Top 500 (written first), what
    # Quant holds on Quant (second), and none on Not open yet.
    notes = [r for r in each("updateCells") if "note" in r["rows"][0]["values"][0]]
    assert [(r["range"]["startRowIndex"], r["range"]["startColumnIndex"]) for r in notes] == [(0, 0)] * 2
    top, quant = (r["rows"][0]["values"][0]["note"] for r in notes)
    for part in ["tier", "0.6", "innovation", "0.4", "intern pay", "Google", "#1", "Checked"]:
        assert part in top
    for part in ["Open Quant firms only", "tier", "innovation", "intern pay", "Checked"]:
        assert part in quant
    assert "Google" not in quant

    # Every column fits its content (Google's own sizing), as the Sheet shows it.
    fitted = [(r["dimensions"]["startIndex"], r["dimensions"]["endIndex"]) for r in each("autoResizeDimensions")]
    assert (RANKED_HEADERS.index("Apply"), RANKED_HEADERS.index("Apply") + 1) in fitted
    assert not each("updateDimensionProperties")  # short Roles and notes: nothing to cap


def test_rankings_cap_a_long_role_and_why_not_open_and_fit_the_rest(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    long = "Software Engineering Intern, Machine Learning Infrastructure and Developer Productivity (Summer 2027)"
    companies = [company(1, "Google", role=long), company(2, "Shut Inc", open=False, note=long)]

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    capped = [(r["range"]["sheetId"], r["range"]["startIndex"], r["properties"]["pixelSize"])
              for r in (request["updateDimensionProperties"] for request in spreadsheet.requests
                        if "updateDimensionProperties" in request)]
    # Top 500's Role and Not open yet's Why not open; Quant is empty.
    assert [(index, 250 <= size <= 400) for _, index, size in capped] == [(3, True), (3, True)]
    fitted = [request["autoResizeDimensions"]["dimensions"]["startIndex"] for request in spreadsheet.requests
              if "autoResizeDimensions" in request]
    assert fitted.count(3) == 1  # only the empty Quant tab's Role fits; the other two are capped
    assert fitted.count(1) == 3  # each tab's Company fits its names

def test_rankings_ignore_keys_the_results_file_adds(tmp_path):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    companies = [company(1, "Google", checked_by_agent=True), company(2, "Stripe", checked_by_agent=False)]

    write_rankings(spreadsheet, results(tmp_path, companies), lock=tmp_path / "tracker.lock")

    assert [row[1] for row in spreadsheet.worksheet("Top 500").get_all_values()[1:]] == ["Google", "Stripe"]


def test_the_rank_command_writes_all_three_tabs_of_the_live_tracker(tmp_path, monkeypatch, capsys):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    monkeypatch.setattr(rankings, "live_tracker_sheet", lambda: spreadsheet)
    monkeypatch.setattr(rankings, "DEFAULT_LOCK", tmp_path / "tracker.lock")
    companies = [company(1, "Google"), company(2, "Shut Inc", open=False, note="Closed"),
                 company(3, "Jane Street", quant=True)]

    rankings.main([str(results(tmp_path, companies))])

    assert [row[1] for row in spreadsheet.worksheet("Top 500").get_all_values()] == ["Company", "Google"]
    assert [row[1] for row in spreadsheet.worksheet("Not open yet").get_all_values()] == ["Company", "Shut Inc"]
    assert [row[1] for row in spreadsheet.worksheet("Quant").get_all_values()] == ["Company", "Jane Street"]
    assert spreadsheet.url in capsys.readouterr().out
    assert (tmp_path / "tracker.lock").exists()


def test_the_rank_command_links_postings_apply_added_since_setup(tmp_path, monkeypatch):
    spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS)
    spreadsheet.worksheet(APPLICATIONS).append_row(["a1", "Google", "Intern", "https://google.com/jobs/1",
                                                    "workday", "submitted", "2026-10-20"] + [""] * 11)
    monkeypatch.setattr(rankings, "live_tracker_sheet", lambda: spreadsheet)
    monkeypatch.setattr(rankings, "DEFAULT_LOCK", tmp_path / "tracker.lock")

    rankings.main([str(results(tmp_path, [company(1, "Google")]))])

    cells = [request["updateCells"]["rows"][0]["values"][0] for request in spreadsheet.requests
             if "updateCells" in request]
    links = [cell["userEnteredFormat"]["textFormat"]["link"]["uri"] for cell in cells if "userEnteredFormat" in cell]
    assert links == ["https://google.com/jobs/1"]
