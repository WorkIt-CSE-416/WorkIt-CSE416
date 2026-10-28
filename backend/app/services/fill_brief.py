"""
The fix brief (KAN-369 fix reports): one fill report as Markdown written for
a coding agent, so it can find and fix what the fill did wrong without
asking. docs/fill-reports.md describes its sections; tests/fixtures/
fill_brief.md is a whole one, kept equal to this code's output.

Pure: it takes the report as GET /admin/fill-reports/{id} answers it (JSON)
and the engine commit, when the caller could resolve one
(app/scripts/fill_report.py, from a git checkout), and returns text. The
report's values were taken out in the student's browser; «planned»,
«shown», «redacted», «email» and «phone» mark where.
"""

import json

# Where each job system is filled: the Fill engine's Filler for it (the engine is the submodule at
# autofiller_extension/fill-engine; its Site type names these).
ENGINE = "autofiller_extension/fill-engine"
SITES = frozenset({
    "greenhouse", "lever", "ashby", "rippling", "workable", "eightfold", "workday", "tiktok", "oracle", "waymo",
    "smartrecruiters", "icims", "successfactors",
})
# Where a kind of failure usually lives, besides the job system's Filler.
ERROR_FILES = {
    "Readback": (f"{ENGINE}/src/readback.ts", "the read-back comparison: what counts as the page showing the answer"),
    "NoAnswer": (f"{ENGINE}/src/planner.ts", "the answer planner (rules.ts holds the label rules it matches)"),
    "FillError": (f"{ENGINE}/src/page.ts", "the shared page helpers the Fillers type, pick and click with"),
    "NoForm": (f"{ENGINE}/src/jobs.ts", "jobOf and the job system's form detection"),
    "Handoff": (f"{ENGINE}/src/steps.ts", "the stepped job systems' walk (Workday's steps)"),
}
FIXTURE_DIR = f"{ENGINE}/test/fixtures/forms"


def fixture_name(report_id: str) -> str:
    return f"fill-report-{report_id[:8]}.html"


def _cell(value) -> str:
    """A table cell: no pipe or newline breaks the row."""
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value)
    return str(value).replace("|", "\\|").replace("\n", " ")


def _code(value) -> str:
    return f"`{value}`" if value else ""


def _planned(shape: str | None) -> str:
    """'text:12' as words: what kind of answer, never the answer."""
    if not shape:
        return "nothing"
    kind, _, size = shape.partition(":")
    words = {"text": f"text of {size} characters", "option": "one option", "options": f"{size} options", "file": "a file", "none": "nothing"}
    return words.get(kind, shape)


def _field_title(field: dict) -> str:
    label = field.get("label") or field.get("label_shape") or "(no label)"
    return f"{label} ({_code(field.get('name'))})" if field.get("name") else label


def _focus(fields: list[dict]) -> list[dict]:
    """The fields the brief is about: those the student marked, else those that failed or that they edited."""
    marked = [f for f in fields if f.get("marked")]
    return marked or [f for f in fields if f.get("status") == "failed" or f.get("error") or f.get("edited")]


def _headline(report: dict, focus: list[dict]) -> str:
    if focus:
        first = focus[0]
        what = {"differs": "reads back wrong", "empty": "ends up empty"}.get(first.get("readback") or "", "")
        what = what or ("was edited by the student" if first.get("edited") else (first.get("error") or first.get("status") or "is wrong"))
        more = f" (+{len(focus) - 1} more)" if len(focus) > 1 else ""
        return f"{first.get('label') or first.get('label_shape')} {what}{more}"
    return "the student reported a problem" if report.get("note") else "a report with no field named"


def _expected_actual(field: dict) -> list[str]:
    planned = _planned(field.get("planned"))
    lines = [f"### {_field_title(field)}", ""]
    source = field.get("source")
    lines.append(f"- **Expected:** the field takes the planned answer ({planned}{', from ' + source if source else ''}) and reads back as it.")
    actual = [f"status `{field.get('status') or 'unknown'}`"]
    if field.get("error"):
        actual.append(f"error `{field['error']}`")
    if field.get("readback"):
        actual.append(f"read-back `{field['readback']}` (the page shows {_planned(field.get('shows'))})")
    if field.get("edited"):
        actual.append("the student changed it after WorkIt filled it")
    lines.append(f"- **Actual:** {', '.join(actual)}.")
    if field.get("reason"):
        lines.append(f"- **The fill's reason:** {field['reason']}")
    shape = [f"kind `{field.get('kind')}`", "required" if field.get("required") else "optional"]
    if field.get("selector"):
        shape.append(f"selector `{field['selector']}`")
    if field.get("visible") is not None:
        shape.append("visible" if field["visible"] else "hidden")
    if field.get("options"):
        shape.append(f"options: {', '.join(field['options'][:20])}{' …' if len(field['options']) > 20 else ''}")
    lines.append(f"- **The field:** {', '.join(shape)}.")
    lines.append("")
    return lines


def fix_brief(report: dict, *, engine_commit: str | None = None, fixture_path: str | None = None) -> str:
    """The report as a fix brief. `fixture_path`: where the form's HTML is beside the brief (fill_report.py writes it)."""
    fields = report.get("fields") or []
    context = report.get("context") or {}
    recognition = context.get("recognition") or {}
    system = report["job_system"]
    focus = _focus(fields)
    short = str(report["id"])[:8]
    fixture = fixture_path or fixture_name(str(report["id"]))
    out: list[str] = []

    out += [f"# Fill report {short}: {system}, {_headline(report, focus)}", ""]
    out += [
        "> A WorkIt student sent this from the extension's panel. It is written for a coding agent: fix the fill",
        "> so the fields below fill and read back right, and add the fixture as a test. Every value the student",
        "> typed or WorkIt planned was taken out in their browser before it was sent: «planned» and «shown» stand",
        "> for the planned answer and what the page showed, «redacted», «email» and «phone» for other personal text.",
        "",
    ]

    out += ["## Summary", ""]
    out.append(f"- **What the student said:** {report['note']}" if report.get("note") else "- **What the student said:** nothing (no note).")
    out.append(f"- **Fields at issue:** {', '.join(_field_title(f) for f in focus)}" if focus else "- **Fields at issue:** none named.")
    ids = ", ".join(f"{k}={v}" for k, v in (recognition.get("ids") or {}).items())
    seen = f"site `{recognition.get('site')}`" + (", on its form" if recognition.get("on_form") else ", not on its form" if recognition.get("on_form") is False else "") + (f", {ids}" if ids else "")
    out.append(f"- **Job system:** {system} (the engine's jobOf: {seen if recognition else 'not recorded'})")
    out.append(f"- **Opened by:** {report.get('trigger') or 'unknown'} · **status:** {report.get('status', 'new')} · **reported:** {report.get('created_at')}")
    if report.get("admin_note"):
        out.append(f"- **Admin note:** {report['admin_note']}")
    out.append("")

    out += ["## Reproduce", ""]
    out.append(f"1. Open {report['posting_url']} in Chrome with the WorkIt extension loaded"
               + (f" (step: {context['step']})" if context.get("step") else "") + ".")
    out.append("2. Press Autofill This Page in the WorkIt panel. Never press the employer's Submit.")
    if focus:
        targets = "; ".join(f"{_field_title(f)}" + (f" at `{f['selector']}`" if f.get("selector") else "") for f in focus)
        out.append(f"3. Look at {targets}.")
    out.append(f"4. Offline: load `{fixture}` (the form as the student's page had it, values out) in the engine's tests; `question-set.json` beside it is the form's Question set.")
    out.append("")

    if focus:
        out += ["## Expected vs actual", ""]
        for field in focus:
            out += _expected_actual(field)

    out += ["## Fields", "", "| # | Field | Name | Kind | Req | Visible | Selector | Source | Planned | Status | Read-back | Marked |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for n, f in enumerate(fields, 1):
        mark = "**wrong**" if f.get("marked") else ("edited" if f.get("edited") else "")
        out.append("| " + " | ".join([
            str(n), _cell(f.get("label") or f.get("label_shape")), _cell(_code(f.get("name"))), _cell(f.get("kind")), _cell(f.get("required")),
            _cell(f.get("visible")), _cell(_code(f.get("selector"))), _cell(f.get("source")), _cell(f.get("planned")),
            _cell(f.get("status") or f.get("error")), _cell(f.get("readback")), mark,
        ]) + " |")
    out.append("")

    timeline = report.get("timeline") or []
    out += ["## Timeline", ""]
    if timeline:
        out += ["| t (ms) | Event | Field | Status | Detail |", "|---|---|---|---|---|"]
        for e in timeline:
            out.append(f"| {e.get('t')} | {_cell(e.get('kind'))} | {_cell(_code(e.get('field')))} | {_cell(e.get('status'))} | {_cell(e.get('message'))} |")
        stacks = [e for e in timeline if e.get("stack")]
        for e in stacks:
            out += ["", f"Stack at {e.get('t')} ms:", "", "```", e["stack"], "```"]
    else:
        out.append("No timeline (an older extension, or the report came from the toolbar popup).")
    out.append("")

    out += ["## Where to look", ""]
    if system in SITES:
        out.append(f"- `{ENGINE}/src/{system}.ts`: the engine's Filler for {system} (its question set, fill and read-back of each kind).")
    else:
        out.append(f"- `{ENGINE}/src/jobs.ts`: jobOf doesn't cover this job system; a new one needs a Filler (`src/<system>.ts`) and an entry in jobs.ts.")
    for error in dict.fromkeys(f.get("error") for f in focus if f.get("error")):
        if error in ERROR_FILES:
            path, why = ERROR_FILES[error]
            out.append(f"- `{path}`: {why}.")
    out.append("- `autofiller_extension/src/content/content-script.js`: the extension's fill loop (plan, fill, read back, the checklist's statuses).")
    out.append(f"- Engine version `{report['engine_version']}`" + (f", commit `{engine_commit}`" if engine_commit else " (the commit: `uv run python -m app.scripts.fill_report <id>` resolves it from a checkout)") + ".")
    out.append("")

    out += ["## Fixture", ""]
    if report.get("html"):
        out.append(f"`{fixture}` ({len(report['html'].encode()) // 1024 or 1} KB): the form's HTML with every value, selection and personal text taken out; structure, labels and attributes kept.")
        out.append(f"Save it with `question-set.json` as `{FIXTURE_DIR}/{system}-report-{short}/` and write the failing spec against it first.")
    else:
        out.append("No form snapshot came with this report.")
    out.append("")

    out += ["## Environment", ""]
    out.append(f"- Extension {context.get('extension_version', 'unknown')}, engine `{report['engine_version']}`, {context.get('browser', 'browser unknown')}, frame {context.get('frame', 'top')}.")
    if context.get("page_url") and context["page_url"] != report["posting_url"]:
        out.append(f"- Page address: {context['page_url']}")
    out.append(f"- Captured {context.get('captured_at', 'at an unknown time')}.")
    out.append("")
    return "\n".join(out)


def question_set(report: dict) -> str:
    """The report's fields as the engine's Question set (model.ts Question), JSON, for the fixture's folder."""
    questions = [
        {"name": f.get("name") or f.get("label_shape"), "label": f.get("label") or f.get("label_shape"), "kind": f.get("kind"),
         "required": bool(f.get("required")), "options": f.get("options") or []}
        for f in report.get("fields") or []
    ]
    return json.dumps(questions, indent=1) + "\n"
