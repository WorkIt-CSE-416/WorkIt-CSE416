"""Ask Claude (apply.ask, KAN-638): the send_click hook's Ask mode, the read-back of what Claude changed, an
attestation box put back, and the Repair request. No browser: the page is a fake that answers FIELDS."""

import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from apply import ask, cli, rehearsal, send_click
from apply.adapters import Drive
from apply.answer_bank import AnswerBank
from apply.browsers import WorkerBrowsers
from apply.dashboard import Dashboard, NoFrames
from apply.model import Posting, Question, Status
from apply.records import Filled, FolderRecords, Record
from apply.repair import RepairRequests

CLICK = "mcp__playwright__browser_click"


@pytest.fixture(autouse=True)
def no_settle_wait(monkeypatch):
    monkeypatch.setattr(ask, "SETTLE_S", 0)
POSTING = Posting(id="req-1", company="Acme Robotics", title="Software Intern", url="https://jobs.example.com/acme/1")


def call(tool: str, element: str, target: str = "e1", cwd=".") -> dict:
    return {"tool_name": f"mcp__playwright__browser_{tool}", "tool_input": {"element": element, "target": target},
            "cwd": str(cwd)}


def page_shows(folder, snapshot: str) -> None:
    """The after-tool hook kept this snapshot (a tool's answer, as Claude Code hands it over)."""
    send_click.keep({"cwd": str(folder), "tool_response": [{"type": "text", "text": f"### Snapshot\n```yaml\n{snapshot}\n```"}]})


def denied(answer) -> str:
    assert answer["hookSpecificOutput"]["permissionDecision"] == "deny"
    return answer["hookSpecificOutput"]["permissionDecisionReason"]


@pytest.mark.parametrize("real", ['- button "Resend code" [ref=e1]', '- button "Send new code" [ref=e1]',
                                  '- link "Verify email" [ref=e1] [cursor=pointer]'])
def test_ask_mode_refuses_asking_for_a_code_again(tmp_path, real):
    page_shows(tmp_path, real)
    assert "verification code" in denied(send_click.refusal(call("click", "Next", cwd=tmp_path), ask=True))
    assert send_click.refusal(call("click", "Resend code")) is None  # Claude fill's own hook is as it was


@pytest.mark.parametrize(("real", "tool"), [('- checkbox "I certify that my answers are true" [ref=e1]', "click"),
                                            ('- checkbox "I acknowledge the privacy notice" [ref=e1]', "click"),
                                            ('- generic [ref=e0]:\n  - checkbox [ref=e1]\n  - text: I certify that my answers are true', "click"),
                                            ('- textbox "Electronic signature (type your full name)" [ref=e1]', "type")])
def test_ask_mode_judges_the_real_box_not_claudes_word_for_it(tmp_path, real, tool):
    page_shows(tmp_path, real)
    denied(send_click.refusal(call(tool, "the GPA field", cwd=tmp_path), ask=True))  # Claude's wording says otherwise
    # "Check the box" names no box: refused still.
    denied(send_click.refusal(call(tool, "the GPA field", cwd=tmp_path), ask=True, message="check the box"))


def test_ask_mode_lets_a_box_through_only_when_his_message_names_that_box(tmp_path):
    page_shows(tmp_path, '- checkbox "I certify that my answers are true" [ref=e1]\n- checkbox "I accept the privacy policy" [ref=e2]')
    message = "tick the box: I certify that my answers are true"
    assert send_click.refusal(call("click", "a box", "e1", tmp_path), ask=True, message=message) is None
    denied(send_click.refusal(call("click", "I certify that my answers are true", "e2", tmp_path), ask=True, message=message))


@pytest.mark.parametrize(("message", "box", "named"), [
    ("tick the box that says I certify that my answers are true", "I certify that my answers are true", True),
    ("check 'answers are true and complete'", "I certify that my answers are true and complete", True),
    ("tick I agree", "I agree", True),
    ("check the box", "I certify that my answers are true", False),
    ("tick the checkbox for me", "I certify that my answers are true", False),
    ("sign it", "Electronic signature", False),
    ("tick the certify box", "I certify that my answers are true", False),
    ("tick the box I certify that my answers are true", "I accept the privacy policy", False),
    ("don't tick I certify that my answers are true", "I certify that my answers are true", False),
    ("do not check I agree", "I agree", False),
    ("check my GPA on page 2", "I certify that my answers are true", False),
])
def test_only_his_message_naming_the_box_s_own_text_lets_a_tick_through(message, box, named):
    assert ask.may_tick(message, box) is named


@pytest.mark.parametrize(("real", "tool"), [('- textbox "Password" [ref=e1]', "type"),
                                            ('- textbox "Verification code" [ref=e1]', "type"),
                                            ('- textbox "Enter your one-time passcode" [ref=e1]', "fill_form")])
def test_ask_mode_refuses_typing_in_a_password_or_code_field(tmp_path, real, tool):
    page_shows(tmp_path, real)
    asked = (call(tool, "GPA", cwd=tmp_path) if tool == "type" else
             {"tool_name": f"mcp__playwright__browser_{tool}", "cwd": str(tmp_path),
              "tool_input": {"fields": [{"name": "GPA", "target": "e1", "type": "textbox", "value": "3.7"}]}})
    assert "password or verification-code" in denied(send_click.refusal(asked, ask=True))


@pytest.mark.parametrize("facts", [{"role": "textbox", "type": "password", "text": "Your secret", "attrs": ""},
                                   {"role": "textbox", "type": "text", "text": "", "attrs": "otp_input"},
                                   {"role": "textbox", "type": "text", "text": "", "attrs": "one-time-code"}])
def test_a_secret_field_is_known_by_its_attributes(facts):
    denied(send_click.judged("type", facts))
    denied(send_click.judged("key", facts))
    assert send_click.judged("click", facts) is None  # focusing one is no typing


@pytest.mark.parametrize("label", ["Zip code", "Country code", "Area code", "Postal code", "Code", "Promo code"])
def test_an_ordinary_code_field_is_no_secret(label):
    assert send_click.judged("type", {"role": "textbox", "type": "text", "text": label, "attrs": ""}) is None


def test_a_tool_on_what_the_page_has_not_shown_or_on_a_selector_is_refused(tmp_path):
    page_shows(tmp_path, '- button "Next" [ref=e1]')
    assert "snapshot" in denied(send_click.refusal(call("click", "Next", "e9", tmp_path), ask=True))
    assert "snapshot" in denied(send_click.refusal(call("click", "Next", "button.next", tmp_path), ask=True))


def test_claudes_next_on_the_real_submit_is_refused_and_its_submit_on_the_real_next_goes(tmp_path):
    page_shows(tmp_path, '- button "Submit application" [ref=e1]\n- button "Next" [ref=e2]')
    assert "sends the application" in denied(send_click.refusal(call("click", "Next button", "e1", tmp_path), ask=True))
    assert send_click.refusal(call("click", "Submit", "e2", tmp_path), ask=True) is None


def test_ask_mode_lets_the_fixes_through(tmp_path):
    page_shows(tmp_path, '- button "Back" [ref=e1]\n- button "Next" [ref=e2]\n- combobox "Preferred locations" [ref=e3]\n'
                         '- textbox "GPA" [ref=e4]\n- textbox "Certifications you hold" [ref=e5]\n- radio "Complete" [ref=f1e6]')
    for tool, target in (("click", "e1"), ("click", "e2"), ("select_option", "e3"), ("type", "e4"), ("type", "e5"), ("click", "f1e6")):
        assert send_click.refusal(call(tool, "x", target, tmp_path), ask=True) is None


def test_the_hook_runs_with_its_flags(tmp_path):
    hooks = json.loads(send_click.settings(sys.executable, ("--ask", "--message=tick I certify that it's true")))["hooks"]
    run = lambda command, given: subprocess.run(command, shell=True, cwd=tmp_path, capture_output=True, text=True,
                                                input=json.dumps(given), check=True).stdout
    # The after-tool hook keeps what the snapshot showed; the before-tool hook judges by it, with his message.
    run(hooks["PostToolUse"][0]["hooks"][0]["command"],
        {"cwd": str(tmp_path), "tool_response": {"content": [{"type": "text", "text":
            '- button "Resend code" [ref=e1]\n- checkbox "I certify that it\'s true" [ref=e2]'}]}})
    before = hooks["PreToolUse"][0]["hooks"][0]["command"]
    assert json.loads(run(before, call("click", "Next", "e1", tmp_path)))["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert run(before, call("click", "Next", "e2", tmp_path)) == ""


class Page:
    """A page of one frame whose fields are `fields` (FIELDS's shape); UNDO puts one back."""

    def __init__(self, fields: list[dict]):
        self.fields = fields
        self.undone = []
        self.url = POSTING.url
        self.frames = [self]

    def evaluate(self, code, arg=None):
        if code == ask.FIELDS:
            return {"url": self.url, "title": "Apply", "fields": [dict(f) for f in self.fields]}
        if code == ask.UNDO:
            i, kind, old = arg
            self.undone.append(i)
            next(f for f in self.fields if f["i"] == i)["checked" if kind == "checkbox" else "value"] = old
            return True
        raise AssertionError(code)


class Guard:
    def __init__(self, blocked=()):
        self.done, self._blocked = [], list(blocked)

    def arm(self):
        self.done.append("arm")

    def lift(self):
        self.done.append("lift")

    def asking(self, on, may_tick=False):
        self.done.append(("asking", on, may_tick))

    def blocked(self):
        return list(self._blocked) if "arm" in self.done else []


class Claude:
    def __init__(self, act, said: dict):
        self.act, self.said, self.calls = act, said, []

    def drive(self, **given):
        self.calls.append(given)
        self.act(given["page"])
        return Drive(self.said, 7, 50_000)


def said(**over) -> dict:
    return {"blocked": False, "why": "", "press": "", "reply": "Picked New York and Jersey City.", "changed": [], "couldnt": [],
            "waiting": [], "ticked": [], "remember": [], "apply_bug": []} | over


FORM = [{"i": 0, "type": "text", "label": "Preferred locations", "value": ""},
        {"i": 1, "type": "text", "label": "GPA", "value": "3.9"},
        {"i": 2, "type": "checkbox", "label": "I certify that the information above is true", "checked": False}]


def test_claude_acts_under_the_guard_and_apply_reads_its_change_back():
    page, guard = Page([dict(f) for f in FORM]), Guard()

    def act(p):
        p.fields[0]["value"] = "New York; Jersey City"

    claude = Claude(act, said(changed=[{"field": "Preferred locations", "step": "", "shown": "New York, Jersey City"},
                                       {"field": "GPA", "step": "Education (page 2)", "shown": "3.7"}],
                              remember=[{"question": "Preferred locations", "answer": "New York; Jersey City"}]))
    reply = ask.ask(claude, page, "you left preferred locations blank, pick New York and Jersey City", [],
                    ask.Form(POSTING), "<profile/>", guard=guard)

    assert guard.done == ["arm", ("asking", True, False), ("asking", False, False), "lift"]
    given = claude.calls[0]
    assert given["model"] == "opus" and given["hook"] == ("--ask",)  # he asked for no tick
    assert "<message>you left preferred locations blank" in given["prompt"]
    assert '"label": "Preferred locations"' in given["prompt"]  # the page's state, as data
    assert reply.changed[0] == {"field": "Preferred locations", "step": "", "shown": "New York; Jersey City",
                                "read_back": "Apply read it back"}  # what the page shows, not what Claude said
    assert reply.changed[1]["read_back"] == "Claude's read-back (on Education (page 2))"
    assert reply.remember == [{"question": "Preferred locations", "answer": "New York; Jersey City"}]
    assert reply.as_json()["offers"][0]["saved"] is False  # offered only: his click saves it


def test_an_attestation_box_claude_ticked_unasked_is_put_back():
    page = Page([dict(f) for f in FORM])

    def act(p):
        p.fields[1]["value"] = "3.7"
        p.fields[2]["checked"] = True

    reply = ask.ask(Claude(act, said(reply="Fixed the GPA.")), page, "page 2's GPA is wrong, it should be 3.7", [],
                    ask.Form(POSTING), "", guard=Guard())

    assert page.undone == [2] and page.fields[2]["checked"] is False
    assert [c["field"] for c in reply.changed] == ["GPA"]
    assert "yours to tick" in reply.couldnt[0]


def test_a_box_he_named_stays_ticked():
    page = Page([dict(f) for f in FORM])
    message = "tick the box: I certify that the information above is true"
    claude = Claude(lambda p: p.fields[2].update(checked=True), said(ticked=["the box"]))
    reply = ask.ask(claude, page, message, [], ask.Form(POSTING), "", guard=Guard())
    assert page.undone == [] and reply.changed[0]["shown"] == "ticked"
    assert claude.calls[0]["hook"] == ("--ask", f"--message={message}")


def test_check_the_box_is_not_enough_though_claude_says_it_ticked_that_one():
    page = Page([dict(f) for f in FORM])
    reply = ask.ask(Claude(lambda p: p.fields[2].update(checked=True),
                           said(ticked=["I certify that the information above is true"])),
                    page, "check the box", [], ask.Form(POSTING), "", guard=Guard())
    assert page.undone == [2] and page.fields[2]["checked"] is False
    assert "yours to tick" in reply.couldnt[0]


def test_what_the_guard_blocked_is_said_and_the_cap_fails_the_message():
    page = Page([dict(f) for f in FORM])
    blocked = ask.ask(Claude(lambda p: None, said()), page, "fix it", [], ask.Form(POSTING), "",
                      guard=Guard(['the "Submit" click']))
    assert blocked.couldnt == ['Apply blocked the "Submit" click, so nothing it blocked was sent']

    capped = SimpleNamespace(drive=lambda **_: Drive(None, 61, 3_100_000, capped=True))
    reply = ask.ask(capped, page, "fix it", [], ask.Form(POSTING), "", guard=Guard())
    assert reply.failed and "cap" in reply.reply


def test_followups_carry_the_thread_and_a_bug_of_apply_s_own_is_a_repair_request():
    thread = [{"message": "pick New York", "reply": "Picked New York.",
               "changed": [{"field": "Preferred locations", "shown": "New York"}]}]
    text = ask.prompt("no, the other one", thread, ask.Form(POSTING), [], "")
    assert "They said: pick New York" in text and "Preferred locations → New York" in text

    reply = ask.Reply("Filled it.", changed=[{"field": "Preferred locations", "shown": "Jersey City"}],
                      bugs=[{"field": "Preferred locations", "what": "the Filler left it blank though the profile has it"}])
    [request] = ask.repair_requests(POSTING, "you left preferred locations blank", reply)
    assert request.kind == "wrong answer" and request.posting_url == POSTING.url
    assert "Lisul said \"you left preferred locations blank\"" in request.problems[0]
    assert "Claude's fix: Jersey City" in request.problems[0]


# The window, `apply ask`, and the held page's glue (rehearsal._Ask).



def post(board, path: str, body: dict, token: str | None = None, origin: str | None = None) -> tuple[int, dict]:
    headers = {"X-Apply-Token": board.token if token is None else token, "Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    request = urllib.request.Request(board.url + path, json.dumps(body).encode(), headers)
    try:
        with urllib.request.urlopen(request) as reply:
            return reply.status, json.loads(reply.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_the_window_takes_a_message_only_for_a_held_form_one_at_a_time():
    saved = []
    with Dashboard(1, NoFrames(), remember=lambda q, a: saved.append((q, a)) or "") as board:
        board.update(0, company="Acme Robotics", role="Software Intern", posting_url=POSTING.url, status="filling")
        assert post(board, "/ask", {"id": "tile-0", "message": "fix the GPA"})[0] == 409  # still filling
        board.update(0, askable=True)
        assert post(board, "/ask", {"id": "tile-0", "message": "fix the GPA"}, token="wrong")[0] == 403
        assert post(board, "/ask", {"id": "tile-0", "message": " "})[0] == 400
        status, sent = post(board, "/ask", {"id": "tile-0", "message": "pick New York", "via": "terminal"})
        assert status == 200 and sent["ask"]["state"] == "waiting" and sent["ask"]["via"] == "terminal"
        assert post(board, "/ask", {"id": "tile-0", "message": "and Jersey City"})[0] == 409  # Claude is on the first
        [item] = board.asks(0)
        assert item["message"] == "pick New York" and item["thread"] == [] and board.asks(0) == []

        board.replied(0, item["id"], **ask.Reply("Picked New York.", remember=[
            {"question": "Preferred locations", "answer": "New York"}]).as_json())
        [shown] = board.state()["tiles"][0]["thread"]
        assert shown["reply"] == "Picked New York." and shown["offers"][0]["saved"] is False
        # A follow-up carries the thread so far.
        post(board, "/ask", {"id": "tile-0", "message": "no, the other one"})
        assert [t["message"] for t in board.asks(0)[0]["thread"]] == ["pick New York"]

        # Only his click in the window saves a fact: the window's token and its own Origin, never a terminal's.
        assert post(board, "/ask/remember", {"ask": item["id"], "index": 0})[0] == 403
        assert post(board, "/ask/remember", {"ask": item["id"], "index": 0}, origin="https://evil.example")[0] == 403
        assert saved == []
        status, _ = post(board, "/ask/remember", {"ask": item["id"], "index": 0}, origin=board.url)
        assert status == 200 and saved == [("Preferred locations", "New York")]
        assert post(board, "/ask/remember", {"ask": item["id"], "index": 0}, origin=board.url)[0] == 409  # once


def test_apply_ask_finds_the_form_sends_the_message_and_prints_the_reply():
    with Dashboard(2, NoFrames()) as board:
        board.update(0, company="Acme Robotics", role="Software Intern", posting_url=POSTING.url, application_id="req-1",
                     askable=True, page="Education (/apply)")
        board.update(1, company="Acme Robotics", role="Hardware Intern", posting_url=POSTING.url + "x",
                     application_id="req-2", askable=True)
        note = ask.register(WorkerBrowsers().profiles / ask.WINDOWS, board.url, board.token, os.getpid())
        try:
            said = []
            assert cli._ask(None, None, True, said.append) == 0
            assert "req-1 | Acme Robotics | Software Intern | Education (/apply)" in said[0] and "req-2" in said[0]
            said.clear()
            assert cli._ask("acme", "fix it", False, said.append) == 2  # two match: say which
            assert "say which" in said[0]

            def worker():  # the held page's loop, on its next turn
                while not (items := board.asks(0)):
                    pass
                board.replied(0, items[0]["id"], **ask.Reply(
                    "Changed the GPA to 3.7.", changed=[{"field": "GPA", "step": "page 2", "shown": "3.7",
                                                        "read_back": "Claude's read-back (on page 2)"}],
                    remember=[{"question": "GPA", "answer": "3.7"}]).as_json())
            threading.Thread(target=worker, daemon=True).start()
            said.clear()
            assert cli._ask("software acme", "page 2's GPA is wrong, it's 3.7", False, said.append,
                            sleep=lambda s: None) == 0
            assert "Changed GPA (page 2) → 3.7" in said[-1]
            assert "only your click saves it" in said[-1]
            assert board.state()["tiles"][0]["thread"][0]["via"] == "terminal"
        finally:
            note.unlink()
    assert cli._ask(None, None, True, said.append) == 0  # a closed window is listed no more


class Board:
    def __init__(self):
        self.captions, self.replies, self.queued = {}, [], []

    def update(self, worker, **caption):
        self.captions.update(caption)

    def asks(self, worker):
        queued, self.queued = self.queued, []
        return queued

    def replied(self, worker, ask_id, **reply):
        self.replies.append((ask_id, reply))


def test_an_ask_is_given_the_profile_s_resume_to_attach(tmp_path, monkeypatch):
    # JPMorgan on Oracle (2026-11-05): Claude removed the old resume Oracle kept, then couldn't attach his own.
    resume = tmp_path / "Resume.pdf"
    resume.write_bytes(b"%PDF-1.4")
    claude = Claude(lambda p: None, said(reply="Attached your resume."))
    adapters = SimpleNamespace(board=Board(), claude=claude, records=FolderRecords(tmp_path), repairs=RepairRequests(),
                               answer_bank=AnswerBank(), clock=SimpleNamespace(now=lambda: datetime(2026, 11, 5, 14, 30)))
    profile = SimpleNamespace(policy=lambda key: None, facts=lambda: {"identity": {}}, policies=dict,
                              get=lambda key: str(resume) if key == "files.resume_pdf" else None)
    gpa = Question("gpa", "GPA", "text", True)
    saved = Record(POSTING, Status.HELD, "", Filled((gpa,), {"gpa": "3.9"}, {"gpa": "3.9"}, b""), date(2026, 11, 5))
    done = rehearsal.Rehearsed(POSTING, "ready to submit", saved=saved, questions=(gpa,))
    page = Page([{"i": 0, "type": "file", "label": "Resume", "value": ""}])
    page.title = lambda: "Documents"
    asker = rehearsal._Ask(lambda: done, adapters, profile, 0, [].append)
    asker.open(page)

    monkeypatch.setattr(rehearsal, "DriveGuard", lambda *a, **k: Guard())  # no page code: the fake page has none
    asker(page, {"id": "ask-1", "message": "attach my resume", "thread": [], "via": "terminal"})

    assert claude.calls[0]["files"] == [resume]


def test_the_held_page_s_glue_keeps_his_message_and_the_fix_in_the_record_and_files_a_repair(tmp_path):
    gpa = Question("gpa", "GPA", "text", True)
    filled = Filled((gpa,), {"gpa": "3.9"}, {"gpa": "3.9"}, b"")
    saved = Record(POSTING, Status.HELD, "", filled, date(2026, 11, 5))
    done = rehearsal.Rehearsed(POSTING, "ready to submit", saved=saved, questions=(gpa,))
    records, repairs, board = FolderRecords(tmp_path), RepairRequests(), Board()
    page = Page([{"i": 0, "type": "text", "label": "GPA", "value": "3.9"}])
    page.title = lambda: "Education"

    claude = Claude(lambda p: p.fields[0].update(value="3.7"), said(
        reply="Changed the GPA to 3.7.", changed=[{"field": "GPA", "step": "", "shown": "3.7"}],
        apply_bug=[{"field": "GPA", "what": "the Filler typed the profile's old GPA"}]))
    adapters = SimpleNamespace(board=board, claude=claude, records=records, repairs=repairs, answer_bank=AnswerBank(),
                               clock=SimpleNamespace(now=lambda: datetime(2026, 11, 5, 14, 30)))
    profile = SimpleNamespace(policy=lambda key: None, get=lambda key: None, facts=lambda: {"identity": {}},
                              policies=dict)
    lines = []
    asker = rehearsal._Ask(lambda: done, adapters, profile, 0, lines.append)
    asker.open(page)
    assert board.captions["askable"] is True and board.captions["page"] == "Education (/acme/1)"

    rehearsal.DriveGuard = lambda *a, **k: Guard()  # no page code: the fake page has none
    try:
        asker(page, {"id": "ask-1", "message": "page 2's GPA is wrong, it's 3.7", "thread": [], "via": "window"})
    finally:
        rehearsal.DriveGuard = __import__("apply.submit_guard", fromlist=["DriveGuard"]).DriveGuard
    asker.close()

    assert board.captions["askable"] is False
    assert [state for _, r in board.replies for state in [r["state"]]] == ["working", "done"]
    assert "14:30 You asked Claude: \"page 2's GPA is wrong, it's 3.7\"" in done.history
    record = Path(done.record)
    assert json.loads((record / "asks.json").read_text())[0]["changed"][0]["shown"] == "3.7"
    assert json.loads((record / "answers.json").read_text())[0]["on_page"] == "3.7"
    assert "## Ask Claude" in (record / "README.md").read_text()
    [request] = repairs.all()
    assert "Lisul said" in request.problems[0]
    assert lines == ["Acme Robotics | Ask Claude replied: <reply, 23 chars>"]


def test_a_group_of_boxes_on_another_step_is_read_back_as_one_change():
    group = "Preferred locations"
    page = Page([{"i": n, "type": "checkbox", "label": city, "group": group, "checked": city == "Jersey City", "hidden": True}
                 for n, city in enumerate(["New York", "Jersey City", "Boston"])])

    def act(p):
        p.fields[1]["checked"], p.fields[2]["checked"] = False, True

    reply = ask.ask(Claude(act, said(changed=[{"field": group, "step": "Step 1", "shown": "New York; Boston"}])),
                    page, "no, not Jersey City, I meant Boston", [], ask.Form(POSTING), "", guard=Guard())
    assert reply.changed == [{"field": group, "step": "Step 1", "shown": "New York; Boston",
                              "read_back": "Apply read it back"}]


# An ask that damages a field it wasn't told to touch (KAN-712): Microsoft's held form, 2026-11-06. Asked to set only
# U.S. Armed Forces Status and Veteran Status (custom dropdowns), Claude set both, and the earlier-answered non-compete
# dropdown further down ended up showing "Select a value"; Claude didn't say so, and Apply's read-back covered only
# what Claude named.
NON_COMPETE = "Have you signed a non-compete or non-disclosure statement which may become an obstacle to your acceptance at Microsoft?"
MSFT = [{"i": 0, "type": "text", "combo": True, "label": "U.S. Armed Forces Status", "value": ""},
        {"i": 1, "type": "text", "combo": True, "label": "Veteran Status", "value": ""},
        {"i": 2, "type": "text", "combo": True, "label": NON_COMPETE, "value": "No"},
        {"i": 3, "type": "select", "label": "How did you hear about us?", "value": "University career fair"}]
TWO_FIELDS = ("Two fields only: 'U.S. Armed Forces Status' set to I have not served, and 'Veteran Status' set to "
              "I am not a protected veteran. Touch nothing else.")


def test_a_dropdown_claude_emptied_unasked_waits_for_him_with_its_earlier_answer():
    page = Page([dict(f) for f in MSFT])

    def act(p):
        p.fields[0]["value"], p.fields[1]["value"] = "I have not served", "I am not a protected veteran"
        p.fields[2]["value"] = ""  # the click landed on, or left open, the non-compete dropdown

    claude = Claude(act, said(reply="I set both fields. I changed nothing else.", changed=[
        {"field": "U.S. Armed Forces Status", "step": "", "shown": "I have not served"},
        {"field": "Veteran Status", "step": "", "shown": "I am not a protected veteran"}]))
    reply = ask.ask(claude, page, TWO_FIELDS, [], ask.Form(POSTING), "", guard=Guard())

    assert page.undone == []  # a dropdown built on a text box: its text alone isn't its pick, so not "put back"
    assert [(c["field"], c["read_back"]) for c in reply.changed] == [
        ("U.S. Armed Forces Status", "Apply read it back"), ("Veteran Status", "Apply read it back"),
        (NON_COMPETE, ask.NOT_PUT_BACK)]
    [line] = reply.waiting
    assert line.startswith(f"'{NON_COMPETE}' showed 'No' before this message and shows nothing now")
    assert line.endswith("set it to 'No' again")
    assert "Apply found other answers changed that Claude didn't name" in reply.reply
    assert "Waiting for you: 'Have you signed a non-compete" in ask.told(reply.as_json())
    assert "Apply reads every answered field" in ask.SYSTEM


def test_an_answer_claude_changed_unasked_is_put_back_where_plain_code_can():
    page = Page([dict(f) for f in MSFT])

    def act(p):
        p.fields[0]["value"] = "I have not served"
        p.fields[3]["value"] = ""  # a native select, emptied

    reply = ask.ask(Claude(act, said(changed=[{"field": "U.S. Armed Forces Status", "step": "", "shown": "I have not served"}])),
                    page, "Set 'U.S. Armed Forces Status' to I have not served.", [], ask.Form(POSTING), "", guard=Guard())
    assert page.undone == [3] and page.fields[3]["value"] == "University career fair"
    assert reply.changed[1] == {"field": "How did you hear about us?", "step": "", "shown": "University career fair",
                                "read_back": ask.PUT_BACK}
    assert reply.waiting == []


def test_a_field_his_message_names_or_a_blank_claude_filled_is_not_put_back():
    page = Page([dict(f) for f in MSFT])

    def act(p):
        p.fields[0]["value"] = "I have not served"  # blank before: filled, though Claude didn't list it
        p.fields[3]["value"] = "LinkedIn"  # his message names it

    reply = ask.ask(Claude(act, said()), page, "set How did you hear about us? to LinkedIn and fill the armed forces one",
                    [], ask.Form(POSTING), "", guard=Guard())
    assert page.undone == [] and reply.waiting == []
    assert {c["read_back"] for c in reply.changed} == {"Apply read it back"}


def test_a_drive_cut_short_puts_nothing_back_but_says_what_changed_unasked():
    page = Page([dict(f) for f in MSFT])

    def drive(**given):
        given["page"].fields[3]["value"] = ""
        return Drive(None, 61, 3_100_000, capped=True)

    reply = ask.ask(SimpleNamespace(drive=drive), page, TWO_FIELDS, [], ask.Form(POSTING), "", guard=Guard())
    assert reply.failed and page.undone == []
    assert reply.waiting[0].startswith("'How did you hear about us?' showed 'University career fair' before this message")


def test_a_dropdown_that_empties_itself_a_moment_after_the_drive_is_still_caught():
    page = Page([dict(f) for f in MSFT])
    reads = []

    def act(p):
        p.fields[1]["value"] = "I am not a protected veteran"
        p.late = True

    real = page.evaluate

    def evaluate(code, arg=None):
        if code == ask.FIELDS and getattr(page, "late", False):
            reads.append(1)
            if len(reads) == 2:  # the read right after the drive still shows it; the next doesn't
                page.fields[2]["value"] = ""
        return real(code, arg)

    page.evaluate = evaluate
    reply = ask.ask(Claude(act, said(changed=[{"field": "Veteran Status", "step": "", "shown": "I am not a protected veteran"}])),
                    page, "Set 'Veteran Status' to I am not a protected veteran.", [], ask.Form(POSTING), "", guard=Guard())
    assert len(reads) >= 3 and any(NON_COMPETE in w for w in reply.waiting)


def test_an_answer_found_blank_that_apply_had_read_back_waits_for_him():
    """An earlier message cut short at its cap emptied it: this message's drive didn't change it, but the
    Record's read-back had it answered."""
    fields = [dict(f) for f in MSFT]
    fields[2]["value"] = ""
    plan = [{"label": NON_COMPETE, "kind": "select", "planned": "No", "on_page": "No"},
            {"label": "Veteran Status", "kind": "select", "planned": "I am not a protected veteran", "on_page": None}]
    form = ask.Form(POSTING, plan=plan)
    reply = ask.ask(Claude(lambda p: None, said()), Page(fields), TWO_FIELDS, [], form, "", guard=Guard())
    assert reply.waiting == [f"'{NON_COMPETE}' is blank now, though it showed 'No' when Apply last read it: set it again"]

    # One he asked about in the thread (to leave blank, say) is his to judge.
    thread = [{"message": f"leave '{NON_COMPETE}' blank", "reply": "Done.", "changed": []}]
    assert ask.ask(Claude(lambda p: None, said()), Page(fields), "check the form", thread, form, "",
                   guard=Guard()).waiting == []


def test_the_read_back_pairs_fields_by_label_when_a_field_comes_or_goes_before_them():
    before = [{"frame": 0, "url": POSTING.url, "fields": [dict(f) for f in MSFT]}]
    shifted = [{"i": 0, "type": "text", "label": "If yes, please provide your alias", "value": ""}] + [
        dict(f, i=f["i"] + 1) for f in MSFT]
    shifted[3]["value"] = ""
    after = [{"frame": 0, "url": POSTING.url, "fields": shifted}]
    assert [(c["label"], c["was"], c["now"], c["i"]) for c in ask.changes(before, after)] == [(NON_COMPETE, "No", "", 3)]

