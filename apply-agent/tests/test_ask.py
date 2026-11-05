"""Ask Claude (apply.ask, KAN-638): the send_click hook's Ask mode, the read-back of what Claude changed, an
attestation box put back, and the Repair request. No browser: the page is a fake that answers FIELDS."""

import json
import subprocess
import sys
from types import SimpleNamespace

import pytest

from apply import ask, send_click
from apply.adapters import Drive
from apply.model import Posting

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
