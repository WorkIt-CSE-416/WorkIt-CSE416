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
POSTING = Posting(id="req-1", company="Acme Robotics", title="Software Intern", url="https://jobs.example.com/acme/1")


def call(tool: str, element: str) -> dict:
    return {"tool_name": f"mcp__playwright__browser_{tool}", "tool_input": {"element": element}}


@pytest.mark.parametrize("asked", [call("click", "Resend code"), call("click", "Send new code button"),
                                   call("click", "Verify email")])
def test_ask_mode_refuses_asking_for_a_code_again(asked):
    said = send_click.refusal(asked, ask=True)
    assert said["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "verification code" in said["hookSpecificOutput"]["permissionDecisionReason"]
    assert send_click.refusal(call("click", "Resend code")) is None  # Claude fill's own hook is as it was


@pytest.mark.parametrize("asked", [call("click", "I certify that my answers are true checkbox"),
                                   call("click", "I acknowledge the privacy notice"),
                                   call("type", "Electronic signature (type your full name)")])
def test_ask_mode_refuses_an_attestation_box_unless_his_message_asked_for_a_tick(asked):
    assert send_click.refusal(asked, ask=True)["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert send_click.refusal(asked, ask=True, may_tick=True) is None


def test_ask_mode_lets_the_fixes_through():
    for asked in (call("click", "Back button"), call("click", "Next"), call("select_option", "Preferred locations"),
                  call("type", "GPA"), call("type", "Certifications you hold")):
        assert send_click.refusal(asked, ask=True) is None
    assert send_click.refusal(call("click", "Submit application"), ask=True)  # never the one that sends


def test_the_hook_runs_with_its_flags(tmp_path):
    [hook] = json.loads(send_click.settings(sys.executable, ("--ask",)))["hooks"]["PreToolUse"]
    out = subprocess.run(hook["hooks"][0]["command"], shell=True, cwd=tmp_path, capture_output=True, text=True,
                         input=json.dumps(call("click", "Resend code")), check=True).stdout
    assert json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "deny"


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
    return {"blocked": False, "why": "", "reply": "Picked New York and Jersey City.", "changed": [], "couldnt": [],
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

    assert guard.done == ["arm", "lift"]
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


def test_only_a_message_that_asks_for_a_tick_lets_one_through():
    assert ask.may_tick("tick the I certify box for me") and ask.may_tick("please sign the attestation")
    assert not ask.may_tick("select New York and Jersey City") and not ask.may_tick("check my GPA on page 2")


def test_a_box_he_said_to_tick_stays_ticked():
    page = Page([dict(f) for f in FORM])
    reply = ask.ask(Claude(lambda p: p.fields[2].update(checked=True),
                           said(ticked=["I certify that the information above is true"])),
                    page, "tick the I certify box for me", [], ask.Form(POSTING), "", guard=Guard())
    assert page.undone == [] and reply.changed[0]["shown"] == "ticked"


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
    assert lines == ["Acme Robotics | Ask Claude: Changed the GPA to 3.7."]


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
