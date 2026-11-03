"""The Tracker Sheet: Lisul's Google Sheet, through gspread with a service account.

Retired (KAN-544, ../docs/adr/0007): Apply no longer writes it. Apply's own
Tracker is a file in the data folder (tracker.FileTracker), and the record of
each application is WorkIt's Applications Tracker. What stays here reads the
Sheet: `copy_into` copies its rows into the Tracker file one time, and
`apply import-sheet` (sheet_import.py) puts its submitted rows into WorkIt."""

import argparse
import fcntl
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import gspread
from gspread.utils import rowcol_to_a1

from apply.home import HOME
from apply.model import Outcome, Status
from apply.tracker import (
    LISULS,
    AnswerRow,
    EmployerAccount,
    Row,
    check_new,
    check_writable,
)

APPLICATIONS = "Applications"
REQUESTS = "Requests"
EMPLOYER_ACCOUNTS = "Employer accounts"
ANSWERS = "Answers"

# Each Applications column's header, and the Row field it holds.
COLUMNS = {
    "Application ID": "application_id",
    "Company": "company",
    "Role": "role",
    "Posting": "posting_url",
    "Job system": "job_system",
    "Status": "status",
    "Date applied": "date_applied",
    "Reason": "reason",
    "Record": "record",
    "Missing fact": "missing_fact",
    "Missing fact options": "missing_fact_options",
    "Confirmation received": "confirmation_received",
    "Suggested outcome": "suggested_outcome",
    "Bot signals": "bot_signals",
    # Lisul's columns
    "Essay": "essay",
    "Answer": "answer",
    "Approve": "approve",
    "Outcome": "outcome",
}
HEADERS = {field: header for header, field in COLUMNS.items()}

# Each Answers column's header, and the AnswerRow field it holds. Answer and
# Reviewed are Lisul's; Apply only adds rows.
ANSWER_COLUMNS = {
    "Question": "question",
    "Answer": "answer",
    "Reviewed": "reviewed",
    "Claude's draft": "drafted",
    "Options": "options",
    "Company": "company",
    "First seen": "first_seen",
}

# Every tab, with its header row.
TABS = {
    APPLICATIONS: list(COLUMNS),
    REQUESTS: ["Link"],  # Lisul pastes Posting links here
    EMPLOYER_ACCOUNTS: ["Company", "Site", "Login", "Created"],
    ANSWERS: list(ANSWER_COLUMNS),  # the Answer bank, for Lisul to review and edit
}

# Lisul's saved filter views on the Applications tab, by the Status they show.
FILTER_VIEWS = {"Held": Status.HELD, "Handoff": Status.HANDOFF, "Missing fact": Status.MISSING_FACT}

# Rows a new tab gets: room for every Application, all with Approve's checkbox.
ROWS = 5000

# The service account's JSON key (gspread's default place), and where `setup`
# saves the Sheet's ID for live runs.
KEY = Path.home() / ".config" / "gspread" / "service_account.json"
SHEET_ID = HOME / "sheet-id"

# Every write on this Mac takes this lock, so writers from several processes
# never interleave. Sheets makes no promise about concurrent appends.
DEFAULT_LOCK = HOME / "tracker.lock"


@contextmanager
def locked(path: Path = DEFAULT_LOCK):
    """Hold the Tracker's write lock, which every write to the Sheet takes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def open_sheet(sheet_id: str, key: Path = KEY) -> gspread.Spreadsheet:
    """Open a Sheet as the service account, retrying 429s with backoff."""
    return gspread.service_account(filename=key, http_client=gspread.BackOffHTTPClient).open_by_key(sheet_id)


class NoSheet(Exception):
    """No Tracker Sheet is set up: the Tracker is off."""


def live_tracker_sheet() -> gspread.Spreadsheet:
    """The Sheet `setup` saved for live runs. Raises NoSheet when none was."""
    if not SHEET_ID.is_file() or not SHEET_ID.read_text().strip():
        raise NoSheet(f"no Tracker Sheet is set up ({SHEET_ID} is missing; docs/tracker-setup.md)")
    return open_sheet(SHEET_ID.read_text().strip())


def live_tracker() -> "SheetTracker":
    """The Tracker for live runs: the Sheet `setup` saved."""
    return SheetTracker(live_tracker_sheet())


def lay_out(spreadsheet: gspread.Spreadsheet, lock: Path = DEFAULT_LOCK) -> None:
    """Give a Sheet the Tracker's tabs, headers, checkbox, dropdowns and filter
    views. Safe to run again: it adds only what is missing, and never touches a
    header row that already has text."""
    existing = {worksheet.title: worksheet for worksheet in spreadsheet.worksheets()}
    for title, headers in TABS.items():
        worksheet = existing.get(title) or spreadsheet.add_worksheet(title, rows=ROWS, cols=len(headers))
        if not worksheet.row_values(1):
            worksheet.update([headers], "A1")
        worksheet.freeze(rows=1)
        worksheet.format("1:1", {"textFormat": {"bold": True}})
    blank = existing.get("Sheet1")
    if blank and not blank.get_all_values():
        spreadsheet.del_worksheet(blank)

    applications = spreadsheet.worksheet(APPLICATIONS)
    headers = applications.row_values(1)

    def column(header: str, first_row: int = 1) -> dict:
        index = headers.index(header)
        return {"sheetId": applications.id, "startRowIndex": first_row, "endRowIndex": applications.row_count,
                "startColumnIndex": index, "endColumnIndex": index + 1}

    def one_of(values, strict: bool) -> dict:
        return {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": v} for v in values]},
                "strict": strict, "showCustomUi": True}

    requests = [
        {"setDataValidation": {"range": column("Approve"), "rule": {"condition": {"type": "BOOLEAN"}}}},
        {"setDataValidation": {"range": column("Outcome"), "rule": one_of(Outcome, strict=True)}},
        {"setDataValidation": {"range": column("Status"), "rule": one_of(Status, strict=False)}},
    ]
    metadata = spreadsheet.fetch_sheet_metadata({"fields": "sheets(properties(sheetId),filterViews(title))"})
    views = {view["title"] for sheet in metadata["sheets"] if sheet["properties"]["sheetId"] == applications.id
             for view in sheet.get("filterViews", [])}
    for title, status in FILTER_VIEWS.items():
        if title not in views:
            requests.append({"addFilterView": {"filter": {
                "title": title,
                "range": {"sheetId": applications.id, "startRowIndex": 0,
                          "startColumnIndex": 0, "endColumnIndex": len(headers)},
                "filterSpecs": [{"columnIndex": headers.index("Status"), "filterCriteria": {
                    "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": status}]}}}],
            }}})
    answers = spreadsheet.worksheet(ANSWERS)
    reviewed = answers.row_values(1).index("Reviewed")
    requests.append({"setDataValidation": {"range": {
        "sheetId": answers.id, "startRowIndex": 1, "endRowIndex": answers.row_count,
        "startColumnIndex": reviewed, "endColumnIndex": reviewed + 1,
    }, "rule": {"condition": {"type": "BOOLEAN"}}}})
    spreadsheet.batch_update({"requests": requests})
    tidy_applications(spreadsheet, lock)


# Apply's machine columns, hidden (never deleted) on the Applications tab.
HIDDEN = ["Application ID", "Job system", "Reason", "Record", "Missing fact options", "Confirmation received",
          "Bot signals"]

# Each Status's background on the Applications tab, as RGB.
STATUS_COLORS = {
    Status.SUBMITTED: (0.72, 0.88, 0.72),  # green
    Status.HELD: (1.0, 0.95, 0.6),  # yellow
    Status.MISSING_FACT: (0.99, 0.8, 0.6),  # orange
    Status.FAILED: (0.96, 0.7, 0.7),  # red
}

# Column widths in pixels; columns not named keep theirs.
WIDTHS = {"Company": 150, "Role": 280, "Posting": 260, "Status": 110, "Date applied": 110, "Missing fact": 200,
          "Suggested outcome": 140, "Essay": 240, "Answer": 240, "Approve": 80, "Outcome": 120}


def tidy_applications(spreadsheet: gspread.Spreadsheet, lock: Path = DEFAULT_LOCK) -> None:
    """Make the Applications tab easy to read: hide Apply's machine columns,
    color Status, link each Posting and set column widths. Only formatting
    changes: no header is renamed and no cell value is touched. Takes the
    Tracker's write lock, so it never links a Posting while a row moves. Safe
    to run again: it first removes the Status colors an earlier run added."""
    with locked(lock):
        _tidy_applications(spreadsheet)


def _tidy_applications(spreadsheet: gspread.Spreadsheet) -> None:
    applications = spreadsheet.worksheet(APPLICATIONS)
    headers, *cells = applications.get_all_values()
    status, posting = headers.index("Status"), headers.index("Posting")

    def columns(index: int) -> dict:
        return {"sheetId": applications.id, "dimension": "COLUMNS", "startIndex": index, "endIndex": index + 1}

    requests = replace_rules(spreadsheet, applications.id, lambda rule: _is_status_color(rule, status), [{
        "ranges": [{"sheetId": applications.id, "startRowIndex": 1,
                    "startColumnIndex": status, "endColumnIndex": status + 1}],
        "booleanRule": {"condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": value}]},
                        "format": {"backgroundColor": {"red": red, "green": green, "blue": blue}}},
    } for value, (red, green, blue) in STATUS_COLORS.items()])
    requests += [{"updateDimensionProperties": {"range": columns(headers.index(header)),
                                                "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}}
                 for header in HIDDEN if header in headers]
    requests += [{"updateDimensionProperties": {"range": columns(headers.index(header)),
                                                "properties": {"pixelSize": width}, "fields": "pixelSize"}}
                 for header, width in WIDTHS.items() if header in headers]
    # A link format on each Posting cell, which leaves its value as it is.
    requests += [{"updateCells": {
        "range": {"sheetId": applications.id, "startRowIndex": number, "endRowIndex": number + 1,
                  "startColumnIndex": posting, "endColumnIndex": posting + 1},
        "rows": [{"values": [{"userEnteredFormat": {"textFormat": {"link": {"uri": row[posting].strip()}}}}]}],
        "fields": "userEnteredFormat.textFormat.link",
    }} for number, row in enumerate(cells, 1) if row[posting].strip().startswith("http")]
    spreadsheet.batch_update({"requests": requests})


def replace_rules(spreadsheet: gspread.Spreadsheet, sheet_id: int, ours, rules: list[dict]) -> list[dict]:
    """The requests that swap the conditional format rules an earlier run of a
    command added to a tab (those `ours` picks) for `rules`, so a rerun never
    stacks them. Every other rule, such as Lisul's own, is left alone."""
    metadata = spreadsheet.fetch_sheet_metadata({"fields": "sheets(properties(sheetId),conditionalFormats)"})
    existing = next((sheet.get("conditionalFormats", []) for sheet in metadata["sheets"]
                     if sheet["properties"]["sheetId"] == sheet_id), [])
    stale = [index for index, rule in enumerate(existing) if ours(rule)]
    return ([{"deleteConditionalFormatRule": {"sheetId": sheet_id, "index": index}} for index in reversed(stale)]
            + [{"addConditionalFormatRule": {"index": 0, "rule": rule}} for rule in rules])


def _is_status_color(rule: dict, status: int) -> bool:
    """Whether a conditional format rule is one `tidy_applications` adds."""
    condition = rule.get("booleanRule", {}).get("condition", {})
    values = [value.get("userEnteredValue") for value in condition.get("values", [])]
    return (condition.get("type") == "TEXT_EQ" and len(values) == 1 and values[0] in STATUS_COLORS
            and [r.get("startColumnIndex") for r in rule.get("ranges", [])] == [status])


class SheetTracker:
    """Rows are found by Application ID, never by position, and every value is
    written RAW, so text from a job site is never run as a formula.

    Lookup and write happen back to back under the lock, so Lisul sorting the
    Sheet between writes misplaces nothing. A sort landing in the few hundred
    milliseconds between one write's lookup and its cells is not guarded; sorts
    inside a filter view never move rows, so that is the way to sort."""

    def __init__(self, spreadsheet, lock: Path = DEFAULT_LOCK):
        self._lock = lock
        self._applications = spreadsheet.worksheet(APPLICATIONS)
        self._requests = spreadsheet.worksheet(REQUESTS)
        self._accounts = spreadsheet.worksheet(EMPLOYER_ACCOUNTS)
        self._spreadsheet = spreadsheet
        self._answers = None  # the Answers tab, found (or added, to a Sheet set up before it) on first use

    def _locked(self):
        return locked(self._lock)

    def add(self, row: Row) -> None:
        with self._locked():
            self._add(row)

    def _add(self, row: Row) -> None:
        check_new(row)
        headers, *cells = self._applications.get_all_values()
        if row.application_id in _ids(headers, cells):
            raise ValueError(f"{row.application_id} already has a row")
        values = {header: _cell(getattr(row, field)) for header, field in COLUMNS.items() if field not in LISULS}
        _write_new(self._applications, headers, cells, "Application ID", values)

    def update(self, application_id: str, **fields) -> None:
        with self._locked():
            self._update(application_id, **fields)

    def answer(self, application_id: str, text: str) -> None:
        with self._locked():
            self._update(application_id, lisuls=True, answer=text)

    def _update(self, application_id: str, lisuls: bool = False, **fields) -> None:
        headers, *cells = self._applications.get_all_values()
        ids = _ids(headers, cells)
        if application_id not in ids:
            raise KeyError(application_id)
        number = 2 + ids.index(application_id)
        if not lisuls:
            check_writable(_row(dict(zip(headers, cells[number - 2]))), fields)
        headers = self._with_headers(headers, [HEADERS[field] for field in fields])
        self._applications.batch_update([
            {"range": rowcol_to_a1(number, headers.index(HEADERS[field]) + 1), "values": [[_cell(value)]]}
            for field, value in fields.items()
            if HEADERS[field] in headers  # a Sheet laid out before a newer column of Apply's, as add() does
        ], raw=True)

    def _with_headers(self, headers: list[str], needed: list[str]) -> list[str]:
        """The header row, with any of `needed` a Sheet set up before it existed
        added at its end."""
        while headers and not headers[-1]:  # a blank column past the last header
            headers = headers[:-1]
        missing = [header for header in needed if header not in headers]
        if not missing:
            return headers
        if self._applications.col_count < len(headers) + len(missing):
            self._applications.add_cols(len(headers) + len(missing) - self._applications.col_count)
        self._applications.batch_update([
            {"range": rowcol_to_a1(1, len(headers) + n), "values": [[header]]} for n, header in enumerate(missing, 1)
        ], raw=True)
        return headers + missing

    def get(self, application_id: str) -> Row | None:
        return next((row for row in self.rows() if row.application_id == application_id), None)

    def rows(self) -> list[Row]:
        headers, *cells = self._applications.get_all_values()
        return [_row(dict(zip(headers, values))) for values in cells if _filled(headers, values, "Application ID")]

    def requests(self) -> list[str]:
        return [link for link in self._links() if link]

    def remove_request(self, url: str) -> None:
        with self._locked():
            links = self._links()
            if url in links:
                self._requests.delete_rows(2 + links.index(url))

    def add_request(self, url: str) -> None:
        with self._locked():
            self._requests.append_row([url.strip()], value_input_option="RAW", table_range="A1")

    def add_employer_account(self, account: EmployerAccount) -> None:
        with self._locked():
            cells = {"Company": account.company, "Site": account.site, "Login": account.login,
                     "Created": account.created.isoformat()}
            headers = self._accounts.row_values(1)
            self._accounts.append_row([cells.get(h, "") for h in headers], value_input_option="RAW", table_range="A1")

    def employer_accounts(self) -> list[EmployerAccount]:
        headers, *cells = self._accounts.get_all_values()
        accounts = [dict(zip(headers, values)) for values in cells if any(values)]
        return [
            EmployerAccount(a["Company"], a["Site"], a["Login"], date.fromisoformat(a["Created"])) for a in accounts
        ]

    def add_answer(self, row: AnswerRow) -> None:
        with self._locked():
            answers = self._answers_tab()
            cells = {header: _cell(getattr(row, field)) for header, field in ANSWER_COLUMNS.items()}
            cells["Options"] = "; ".join(row.options)
            cells["Reviewed"] = "TRUE" if row.reviewed else "FALSE"
            headers, *rows = answers.get_all_values()
            _write_new(answers, headers, rows, "Question", cells)

    def answers(self) -> list[AnswerRow]:
        headers, *cells = self._answers_tab().get_all_values()
        rows = [dict(zip(headers, values)) for values in cells if _filled(headers, values, "Question")]
        return [AnswerRow(
            question=r["Question"], answer=r["Answer"], reviewed=r["Reviewed"] == "TRUE", drafted=r["Claude's draft"],
            options=tuple(o.strip() for o in r["Options"].split(";") if o.strip()), company=r["Company"],
            first_seen=date.fromisoformat(r["First seen"]) if r["First seen"] else None,
        ) for r in rows]

    def _answers_tab(self):
        if self._answers is None:
            try:
                self._answers = self._spreadsheet.worksheet(ANSWERS)
            except gspread.WorksheetNotFound:
                self._answers = self._spreadsheet.add_worksheet(ANSWERS, rows=ROWS, cols=len(TABS[ANSWERS]))
                self._answers.update([TABS[ANSWERS]], "A1")
        return self._answers

    def _links(self) -> list[str]:
        return [values[0].strip() for values in self._requests.get_all_values()[1:]]


def _filled(headers: list[str], values: list[str], key: str) -> bool:
    """Whether a row holds a record: its `key` cell isn't blank. A blank row
    can still hold an unticked checkbox, read as "FALSE"."""
    return bool(values[headers.index(key)].strip())


def _write_new(worksheet, headers: list[str], cells: list[list[str]], key: str, values: dict[str, str]) -> None:
    """Write a new record into the first data row whose `key` cell is blank,
    setting only the cells in `values`: whatever else that row holds, such as
    Lisul's unticked checkbox, stays. With no blank row, append one.

    Google's append alone would land below every blank row holding a checkbox,
    thousands of rows down."""
    blank = next((number for number, row in enumerate(cells, 2) if not _filled(headers, row, key)), None)
    if blank is None:
        worksheet.append_row([values.get(h, "") for h in headers], value_input_option="RAW", table_range="A1")
        return
    worksheet.batch_update([
        {"range": rowcol_to_a1(blank, headers.index(header) + 1), "values": [[value]]}
        for header, value in values.items() if header in headers
    ], raw=True)


def _ids(headers: list[str], cells: list[list[str]]) -> list[str]:
    """Every data row's Application ID, blank ones too, so an ID's index
    gives its row number."""
    column = headers.index(HEADERS["application_id"])
    return [values[column] for values in cells]


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _row(cells: dict[str, str]) -> Row:
    values = {field: cells.get(header, "") for header, field in COLUMNS.items()}
    values["status"] = Status(values["status"])
    values["date_applied"] = date.fromisoformat(values["date_applied"]) if values["date_applied"] else None
    values["approve"] = values["approve"] == "TRUE"
    values["outcome"] = Outcome(values["outcome"]) if values["outcome"] else None
    values["suggested_outcome"] = Outcome(values["suggested_outcome"]) if values["suggested_outcome"] else None
    values["confirmation_received"] = (
        date.fromisoformat(values["confirmation_received"]) if values["confirmation_received"] else None
    )
    return Row(**values)


def copy_into(spreadsheet, tracker) -> int:
    """Copy the Sheet's Applications rows and Requests into `tracker` (a FileTracker), one time (KAN-544).
    Read leniently, as a hand-edited Sheet holds: an unknown Outcome is left blank, a row whose Status
    Apply does not know is left out. Writes nothing to the Sheet. Returns how many rows went in."""
    headers, *cells = spreadsheet.worksheet(APPLICATIONS).get_all_values()
    rows = []
    for values in cells:
        cell = {header: value.strip() for header, value in zip(headers, values)}
        if not cell.get("Application ID"):
            continue
        try:
            rows.append(_lenient(cell))
        except ValueError:
            continue
    requests = [values[0].strip() for values in spreadsheet.worksheet(REQUESTS).get_all_values()[1:]
                if values and values[0].strip()]
    tracker.fill(rows, requests)
    return len(rows)


def _lenient(cell: dict[str, str]) -> Row:
    def day(header: str) -> date | None:
        try:
            return date.fromisoformat(cell.get(header, ""))
        except ValueError:
            return None

    def outcome(header: str) -> Outcome | None:
        return next((o for o in Outcome if o.value.lower() == cell.get(header, "").lower()), None)

    values = {field: cell.get(header, "") for header, field in COLUMNS.items()}
    return Row(**values | {
        "status": Status(values["status"]), "date_applied": day("Date applied"),
        "approve": values["approve"].upper() == "TRUE", "outcome": outcome("Outcome"),
        "suggested_outcome": outcome("Suggested outcome"), "confirmation_received": day("Confirmation received"),
    })


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m apply.sheet")
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("setup", help="lay out a Sheet as the Tracker and use it for live runs")
    setup.add_argument("sheet", help="the Sheet's URL or ID")
    args = parser.parse_args(argv)

    sheet_id = args.sheet.split("/d/")[1].split("/")[0] if "/d/" in args.sheet else args.sheet
    spreadsheet = open_sheet(sheet_id)
    lay_out(spreadsheet)
    SHEET_ID.parent.mkdir(parents=True, exist_ok=True)
    SHEET_ID.write_text(sheet_id + "\n")
    print(f"The Tracker is ready: {spreadsheet.url}")


if __name__ == "__main__":
    main()
