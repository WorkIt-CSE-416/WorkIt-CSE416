"""Claude fill's hook on its browser clicks (apply.send_click)."""

import json
import subprocess
import sys

import pytest

from apply import send_click

CLICK = "mcp__playwright__browser_click"


@pytest.mark.parametrize("element", ["Submit application button", "Send Application", "Finish", "Complete application"])
def test_a_click_on_the_button_that_sends_is_refused_with_word_to_stop(element):
    said = send_click.refusal({"tool_name": CLICK, "tool_input": {"target": "f1e9", "element": element}})

    assert said["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "submit_button" in said["hookSpecificOutput"]["permissionDecisionReason"]


@pytest.mark.parametrize("call", [
    {"tool_name": CLICK, "tool_input": {"target": "e31", "element": "Apply Now button"}},  # opens the form
    {"tool_name": CLICK, "tool_input": {"target": "f1e53", "element": "Country"}},
    {"tool_name": CLICK, "tool_input": {"target": "f1e8", "element": "Resend code"}},
    {"tool_name": "mcp__playwright__browser_type", "tool_input": {"element": "Submit", "text": "x"}},
])
def test_every_other_call_goes_on(call):
    assert send_click.refusal(call) is None


def test_claude_runs_it_as_a_hook_from_any_folder(tmp_path):
    [hook] = json.loads(send_click.settings(sys.executable))["hooks"]["PreToolUse"]
    call = {"tool_name": CLICK, "tool_input": {"element": "Submit application"}}

    out = subprocess.run(hook["hooks"][0]["command"], shell=True, cwd=tmp_path, input=json.dumps(call),
                         capture_output=True, text=True, check=True).stdout

    assert hook["matcher"] == CLICK
    assert json.loads(out)["hookSpecificOutput"]["permissionDecision"] == "deny"
