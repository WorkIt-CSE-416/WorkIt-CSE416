"""Every Tracker the contract tests run against, each with a way for Lisul to
edit it by hand. The fake spreadsheet stands in for gspread's Spreadsheet: it
keeps each tab as a JSON file so several processes can share it."""

import json
import os
from contextlib import contextmanager
from pathlib import Path

import pytest
from gspread.utils import a1_to_rowcol, rowcol_to_a1

from apply.sheet import (
    ANSWER_COLUMNS,
    ANSWERS,
    APPLICATIONS,
    COLUMNS,
    REQUESTS,
    TABS,
    SheetTracker,
    lay_out,
    open_sheet,
)
from apply.tracker import FileTracker, InMemoryTracker


@contextmanager
def tracker_and_lisul(kind: str, tmp_path: Path):
    if kind == "memory":
        tracker = InMemoryTracker()
        yield tracker, MemoryLisul(tracker)
    elif kind == "file":
        # Lisul's edits come through a second FileTracker on the same file, as another process's would.
        yield FileTracker(tmp_path / "tracker.json"), MemoryLisul(FileTracker(tmp_path / "tracker.json"))
    elif kind in ("sheet", "checkbox-sheet"):
        blank_rows = 3 if kind == "checkbox-sheet" else 0
        spreadsheet = FakeSpreadsheet(tmp_path / "sheet", TABS, blank_rows=blank_rows)
        yield SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock"), SheetLisul(spreadsheet)
    elif kind == "live-sheet":
        sheet_id = os.environ.get("APPLY_TEST_SHEET_ID")
        if not sheet_id:
            pytest.skip("set APPLY_TEST_SHEET_ID to a scratch Sheet shared with the service account")
        spreadsheet = fresh(open_sheet(sheet_id))
        yield SheetTracker(spreadsheet, lock=tmp_path / "tracker.lock"), SheetLisul(spreadsheet)
    else:
        raise ValueError(kind)


def fresh(spreadsheet):
    """Empty the scratch Sheet's Tracker tabs and lay them out again (twice, to
    show that a second setup changes nothing)."""
    titles = [worksheet.title for worksheet in spreadsheet.worksheets()]
    if "scratch" not in titles:
        spreadsheet.add_worksheet("scratch", rows=1, cols=1)
    for worksheet in spreadsheet.worksheets():
        if worksheet.title in TABS:
            spreadsheet.del_worksheet(worksheet)
    lay_out(spreadsheet)
    lay_out(spreadsheet)
    return spreadsheet


class MemoryLisul:
    def __init__(self, tracker: InMemoryTracker):
        self.tracker = tracker

    def edit(self, application_id: str, **fields) -> None:
        self.tracker.edit_as_lisul(application_id, **fields)

    def paste_request(self, url: str) -> None:
        self.tracker.paste_request(url)

    def edit_answer(self, question: str, **fields) -> None:
        self.tracker.edit_answer_as_lisul(question, **fields)


class SheetLisul:
    """Lisul typing into the Sheet: cells found by header and Application ID."""

    def __init__(self, spreadsheet):
        self.applications = spreadsheet.worksheet(APPLICATIONS)
        self.requests = spreadsheet.worksheet(REQUESTS)
        self.answers = spreadsheet.worksheet(ANSWERS)

    def edit_answer(self, question: str, **fields) -> None:
        headers, *rows = self.answers.get_all_values()
        number = 2 + [row[headers.index("Question")] for row in rows].index(question)
        header = {field: header for header, field in ANSWER_COLUMNS.items()}
        self.answers.batch_update([
            {"range": rowcol_to_a1(number, headers.index(header[field]) + 1),
             "values": [["TRUE" if value is True else str(value)]]}
            for field, value in fields.items()
        ], raw=False)

    def edit(self, application_id: str, **fields) -> None:
        headers, *rows = self.applications.get_all_values()
        number = 2 + [row[headers.index("Application ID")] for row in rows].index(application_id)
        header = {field: header for header, field in COLUMNS.items()}
        self.applications.batch_update([
            {"range": rowcol_to_a1(number, headers.index(header[field]) + 1),
             "values": [["TRUE" if value is True else str(value)]]}
            for field, value in fields.items()
        ], raw=False)

    def sort_by(self, header: str, descending: bool = False) -> None:
        """Data > Sort sheet: reorders the rows below the frozen header for everyone."""
        column = self.applications.get_all_values()[0].index(header) + 1
        self.applications.sort((column, "des" if descending else "asc"))

    def paste_request(self, url: str) -> None:
        self.requests.append_row([url], value_input_option="USER_ENTERED", table_range="A1")


# Each tab's checkbox column. Lisul's Sheet holds an unticked box, read as
# "FALSE", in this column of every blank row below the data.
CHECKBOXES = {APPLICATIONS: "Approve", ANSWERS: "Reviewed"}


class FakeSpreadsheet:
    """The few gspread Spreadsheet and Worksheet calls the Sheet Tracker makes,
    over one JSON file per tab. Each call loads and saves the whole tab, with
    no lock of its own, so unserialized writers lose rows.

    With `blank_rows`, each tab with a checkbox column starts with that many
    blank rows holding only an unticked checkbox, as Lisul's Sheet does."""

    url = "https://docs.google.com/spreadsheets/d/fake"

    def __init__(self, folder: Path, tabs: dict[str, list[str]], blank_rows: int = 0):
        self.folder = folder
        self.requests = []  # every formatting request, in this process only
        folder.mkdir(parents=True, exist_ok=True)
        for title, headers in tabs.items():
            if not (folder / f"{title}.json").exists():
                blank = ["FALSE" if header == CHECKBOXES.get(title) else "" for header in headers]
                blanks = [blank] * blank_rows if title in CHECKBOXES else []
                self.worksheet(title).save([list(headers), *blanks])

    def worksheet(self, title: str) -> "FakeWorksheet":
        return FakeWorksheet(self.folder / f"{title}.json")

    def worksheets(self) -> list["FakeWorksheet"]:
        return [FakeWorksheet(path) for path in sorted(self.folder.glob("*.json"))
                if path.name != "conditional-formats.json"]

    def add_worksheet(self, title: str, rows: int, cols: int) -> "FakeWorksheet":
        worksheet = self.worksheet(title)
        assert not worksheet.path.exists(), f"{title} already exists"
        worksheet.save([[""] * cols])
        return worksheet

    # Formatting: every tab is sheet 0, and only conditional format rules are
    # kept, so a rerun that stacks them shows. Every request is also recorded
    # in `requests`.
    def fetch_sheet_metadata(self, params=None) -> dict:
        return {"sheets": [{"properties": {"sheetId": 0}, "conditionalFormats": self._rules()}]}

    def batch_update(self, body: dict) -> None:
        self.requests += body["requests"]
        rules = self._rules()
        for request in body["requests"]:
            if "addConditionalFormatRule" in request:
                rules.insert(request["addConditionalFormatRule"]["index"], request["addConditionalFormatRule"]["rule"])
            elif "deleteConditionalFormatRule" in request:
                del rules[request["deleteConditionalFormatRule"]["index"]]
        (self.folder / "conditional-formats.json").write_text(json.dumps(rules))

    def _rules(self) -> list[dict]:
        path = self.folder / "conditional-formats.json"
        return json.loads(path.read_text()) if path.exists() else []


class FakeWorksheet:
    id = 0

    def __init__(self, path: Path):
        self.path = path

    @property
    def title(self) -> str:
        return self.path.stem

    def clear(self) -> None:
        self.save([[""] * self.col_count])

    def resize(self, rows: int, cols: int) -> None:
        """Rows past `rows` are dropped, as Google drops them."""
        self.save([row[:cols] for row in self.load()[:rows]] or [[""] * cols])

    def update(self, values, range_name="A1", value_input_option="RAW"):
        """Write a block from A1. Cells are kept as text, as Sheets shows them;
        a formula is kept as its text."""
        assert range_name == "A1", range_name
        cells = self.load()
        for number, row in enumerate(values):
            while len(cells) <= number:
                cells.append([])
            cells[number] = [str(value) for value in row] + cells[number][len(row):]
        self.save(cells)

    def load(self) -> list[list[str]]:
        return json.loads(self.path.read_text())

    def save(self, cells: list[list[str]]) -> None:
        temporary = self.path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(cells))
        temporary.replace(self.path)

    def get_all_values(self) -> list[list[str]]:
        cells = self.load()
        while cells and not any(cells[-1]):
            cells.pop()
        width = max(len(row) for row in cells)
        return [row + [""] * (width - len(row)) for row in cells]

    def row_values(self, row: int) -> list[str]:
        cells = self.load()
        return list(cells[row - 1]) if row <= len(cells) else []

    def append_row(self, values, value_input_option="RAW", table_range=None):
        """Like Google's append: after the last row with any value in it, so
        after every blank row that holds only a checkbox."""
        assert all(isinstance(value, str) for value in values), values
        cells = self.get_all_values()
        cells.append(list(values))
        self.save(cells)

    @property
    def col_count(self) -> int:
        """The grid's width: as wide as the header row, as `lay_out` makes a tab."""
        return len(self.load()[0])

    def add_cols(self, count: int) -> None:
        cells = self.load()
        cells[0] += [""] * count
        self.save(cells)

    def batch_update(self, data, raw=True):
        cells = self.load()
        width = len(cells[0])
        for update in data:
            row, col = a1_to_rowcol(update["range"])
            assert col <= width, f"{update['range']} is beyond the grid's {width} columns"
            [[value]] = update["values"]
            assert isinstance(value, str), value
            while len(cells) < row:
                cells.append([])
            cells[row - 1] += [""] * (col - len(cells[row - 1]))
            cells[row - 1][col - 1] = value
        self.save(cells)

    def delete_rows(self, index: int) -> None:
        cells = self.load()
        del cells[index - 1]
        self.save(cells)

    def sort(self, *specs, range=None):
        header, *rows = self.get_all_values()
        for column, order in reversed(specs):
            rows.sort(key=lambda row: row[column - 1], reverse=order == "des")
        self.save([header, *rows])
