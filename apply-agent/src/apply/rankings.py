"""The ranked tabs of Lisul's Tracker (Top 500, Not open yet and Quant),
written from a research results file with
`uv run python -m apply.rankings <results-file>`."""

import argparse
import json
import re
from dataclasses import dataclass, fields
from pathlib import Path

from gspread.utils import rowcol_to_a1

from apply.model import Status
from apply.sheet import (
    APPLICATIONS,
    DEFAULT_LOCK,
    HEADERS,
    live_tracker_sheet,
    locked,
    replace_rules,
    tidy_applications,
)

# The tabs ranked from a research results file.
TOP_500 = "Top 500"
NOT_OPEN_YET = "Not open yet"
QUANT = "Quant"
RANKED_HEADERS = ["Rank", "Company", "Tier", "Role", "Apply", "Location", "Applied", "Checked"]
NOT_OPEN_HEADERS = ["Rank", "Company", "Tier", "Why not open", "Checked"]
TOP = 500


@dataclass(frozen=True)
class RankedCompany:
    """One company in a research results file, a JSON list of these objects.
    Keys the file carries beyond these (such as `checked_by_agent`) are
    ignored."""

    rank: int  # the company's overall rank (1 = best); Google is 1
    company: str  # its name as Lisul would search the Applications tab
    tier: int  # 1 (elite) to 5 (solid)
    quant: bool  # whether it is a Quant firm
    open: bool  # whether a matching Posting was open when checked
    checked: str  # the ISO date the link was checked ("2026-10-26")
    role: str = ""  # the best open Posting's title ("" if not open)
    url: str = ""  # that Posting on the employer's own site ("" if not open)
    location: str = ""  # the Posting's location ("" if not open)
    note: str = ""  # why it is closed, or any caveat ("" if none)
    pay_hourly: float | None = None  # the intern pay estimate in US$ per hour
    innovation: float | None = None  # 0 to 10
    verified: str = ""  # how the link was checked: "loaded" or "feed only"

    @classmethod
    def parse(cls, data: dict) -> "RankedCompany":
        known = {field.name for field in fields(cls)}
        return cls(**{key: value for key, value in data.items() if key in known})


def read_results(path: Path) -> list[RankedCompany]:
    """A research results file's companies, in rank order."""
    return sorted((RankedCompany.parse(data) for data in json.loads(Path(path).read_text())), key=lambda c: c.rank)


def write_rankings(spreadsheet, results: Path, lock: Path = DEFAULT_LOCK) -> None:
    """Write the ranked tabs (Top 500, Not open yet and Quant) from a research
    results file (see RankedCompany), replacing each tab's rows. Takes the
    Tracker's write lock and never touches the Applications tab's cells.

    The Top 500 is the first 500 open non-quant companies by rank, renumbered
    1 to 500. Not open yet is every closed non-quant company ranked above the
    Top 500's last company, with its overall rank and note. Quant is every open
    Quant firm by rank, renumbered from 1, with the Top 500's columns."""
    companies = read_results(results)
    with locked(lock):
        applied = _applied(spreadsheet.worksheet(APPLICATIONS).row_values(1))
        for title, cells in _ranked_tabs(companies, applied).items():
            _replace_tab(spreadsheet, title, cells)
            _format_ranked_tab(spreadsheet, spreadsheet.worksheet(title), cells)


def _ranked_tabs(companies: list[RankedCompany], applied) -> dict[str, list[list]]:
    """Each ranked tab's cells, header first, from companies in rank order.
    `applied` gives a company's Applied formula."""
    top = [c for c in companies if c.open and not c.quant][:TOP]
    # With fewer than 500 open, every closed company is a gap in the Top 500.
    cutoff = top[-1].rank if len(top) == TOP else float("inf")
    closed = [c for c in companies if not c.open and not c.quant and c.rank < cutoff]
    quant = [c for c in companies if c.open and c.quant]
    return {
        TOP_500: [RANKED_HEADERS, *(_ranked_row(number, c, applied(c.company)) for number, c in enumerate(top, 1))],
        QUANT: [RANKED_HEADERS, *(_ranked_row(number, c, applied(c.company)) for number, c in enumerate(quant, 1))],
        NOT_OPEN_YET: [NOT_OPEN_HEADERS, *([c.rank, c.company, c.tier, c.note, c.checked] for c in closed)],
    }


def _ranked_row(rank: int, company: RankedCompany, applied: str) -> list:
    return [rank, company.company, company.tier, company.role, _link(company.url, "Apply"),
            company.location, applied, company.checked]


def _link(url: str, label: str) -> str:
    quoted = url.replace('"', '""')
    return f'=HYPERLINK("{quoted}","{label}")' if url else ""


def _applied(headers: list[str]):
    """A function from a company to its ranked tab row's Applied formula: ✓
    and the latest Date applied (as an ISO date, even one Lisul typed by hand)
    of the submitted Applications whose Company holds this company's name as a
    whole word, ignoring case ("DoorDash" matches "DoorDash USA", "Meta" does
    not match "Metamorphic"), else blank. A live formula, so it follows Apply
    as it submits. Applications columns are found by header, as Apply finds
    them."""
    def column(field: str) -> str:
        letter = rowcol_to_a1(1, headers.index(HEADERS[field]) + 1).rstrip("1")
        return f"'{APPLICATIONS}'!${letter}$2:${letter}"

    company, status, date_applied = column("company"), column("status"), column("date_applied")

    def formula(name: str) -> str:
        # Escape only RE2's metacharacters: RE2 rejects an escaped space.
        literal = re.sub(r"([.^$*+?()\[\]{}|\\])", r"\\\1", name.strip().lower())
        word = f"(^|[^a-z0-9]){literal}($|[^a-z0-9])".replace('"', '""')
        return (
            f'=IFERROR("✓ "&INDEX(SORT(FILTER(TEXT({date_applied},"yyyy-mm-dd"),'
            f'REGEXMATCH(LOWER({company}),"{word}"),'
            f'{status}="{Status.SUBMITTED}"),1,FALSE),1),"")'
        )
    return formula


def _replace_tab(spreadsheet, title: str, cells: list[list]) -> None:
    """Make a tab hold exactly `cells`, adding the tab if it is missing.
    Written as if typed, so formulas run and dates read as dates."""
    existing = {worksheet.title: worksheet for worksheet in spreadsheet.worksheets()}
    width = len(cells[0])
    worksheet = existing.get(title) or spreadsheet.add_worksheet(title, rows=len(cells), cols=width)
    worksheet.clear()
    worksheet.resize(rows=len(cells), cols=width)
    worksheet.update(cells, "A1", value_input_option="USER_ENTERED")


# Each Tier's row background on the ranked tabs, as RGB: light, so text reads.
TIER_COLORS = {
    1: (0.85, 0.92, 0.99),  # blue
    2: (0.86, 0.94, 0.86),  # green
    3: (1.0, 0.97, 0.8),  # yellow
    4: (0.99, 0.9, 0.8),  # orange
    5: (0.93, 0.93, 0.93),  # gray
}


# The widest, in pixels, the long-text columns of the ranked tabs grow when
# fitted to their content; every other column just fits.
RANKED_CAPS = {"Role": 320, "Why not open": 380}
# About how many pixels a character of the Sheet's default font takes, and
# a cell's padding: enough to tell whether a column would outgrow its cap.
CHARACTER, PADDING = 7, 16

# A note on the Rank header of the ranked tabs that need one: the Top 500's
# ranking method, and what the Quant tab holds. Not open yet has none.
NOTES = {
    TOP_500: ("Ranked by tier first (1 elite to 5 solid), then by 0.6 × innovation + 0.4 × intern pay, "
              "with Google pinned at #1. Each link was checked on its Checked date."),
    QUANT: ("Open Quant firms only, kept off the Top 500. Ranked by tier first (1 elite to 5 solid), "
            "then by innovation and intern pay. Each link was checked on its Checked date."),
}


def _format_ranked_tab(spreadsheet, worksheet, cells: list[list]) -> None:
    """Freeze a bold header with the tab's note (if any) on Rank, filter
    the data, fit each column to its content (Role and Why not open no wider
    than their caps) and band each row by its Tier. The bands
    are a formula on the Tier column, so a sort keeps each band on its row.
    Safe to run again: it first removes the bands an earlier run added, and
    every other change replaces the last one."""
    headers = cells[0]
    tier = headers.index("Tier")
    letter = rowcol_to_a1(1, tier + 1).rstrip("1")
    formulas = {f"=${letter}2={number}" for number in TIER_COLORS}
    requests = replace_rules(spreadsheet, worksheet.id, lambda rule: _formula(rule) in formulas, [{
        "ranges": [{"sheetId": worksheet.id, "startRowIndex": 1,
                    "startColumnIndex": 0, "endColumnIndex": len(headers)}],
        "booleanRule": {"condition": {"type": "CUSTOM_FORMULA",
                                      "values": [{"userEnteredValue": f"=${letter}2={number}"}]},
                        "format": {"backgroundColor": {"red": red, "green": green, "blue": blue}}},
    } for number, (red, green, blue) in TIER_COLORS.items()])
    header = {"sheetId": worksheet.id, "startRowIndex": 0, "endRowIndex": 1}
    requests += [
        {"updateSheetProperties": {"properties": {"sheetId": worksheet.id, "gridProperties": {"frozenRowCount": 1}},
                                   "fields": "gridProperties.frozenRowCount"}},
        {"repeatCell": {"range": header, "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat.bold"}},
        {"setBasicFilter": {"filter": {"range": {"sheetId": worksheet.id}}}},
        # A tab with no note gets none: this clears one an earlier run left.
        {"updateCells": {"range": {**header, "startColumnIndex": 0, "endColumnIndex": 1},
                         "rows": [{"values": [{"note": NOTES[worksheet.title]} if worksheet.title in NOTES else {}]}],
                         "fields": "note"}},
    ]
    for index, name in enumerate(headers):
        columns = {"sheetId": worksheet.id, "dimension": "COLUMNS", "startIndex": index, "endIndex": index + 1}
        widest = max(len(str(row[index])) for row in cells) * CHARACTER + PADDING
        if widest > RANKED_CAPS.get(name, widest):
            requests.append({"updateDimensionProperties": {
                "range": columns, "properties": {"pixelSize": RANKED_CAPS[name]}, "fields": "pixelSize"}})
        else:
            requests.append({"autoResizeDimensions": {"dimensions": columns}})
    spreadsheet.batch_update({"requests": requests})


def _formula(rule: dict) -> str | None:
    condition = rule.get("booleanRule", {}).get("condition", {})
    values = condition.get("values", [])
    return values[0].get("userEnteredValue") if condition.get("type") == "CUSTOM_FORMULA" and len(values) == 1 else None


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m apply.rankings",
                                     description="write the ranked tabs of the live Tracker from a research results file, "
                                                 "and tidy its Applications tab")
    parser.add_argument("results", type=Path, help="the research results file (format in RankedCompany)")
    args = parser.parse_args(argv)
    spreadsheet = live_tracker_sheet()
    write_rankings(spreadsheet, args.results, lock=DEFAULT_LOCK)
    tidy_applications(spreadsheet, lock=DEFAULT_LOCK)  # links the Postings of rows added since setup
    print(f"Ranked tabs written: {spreadsheet.url}")


if __name__ == "__main__":
    main()
