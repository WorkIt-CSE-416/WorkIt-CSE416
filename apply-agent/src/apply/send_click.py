"""Claude fill's hook on its browser clicks: a click Claude names as the button
that sends the application is refused before it runs, with word to stop there
and name the button. The drive guard (apply.submit_guard) would block it on the
page anyway, but Claude can't see that block and spends turns on it.

`claude -p` runs it as a PreToolUse hook (`python -m apply.send_click`): the
tool call comes in on stdin, and a refusal goes out on stdout."""

import json
import re
import shlex
import sys

# The words of a button that sends, as the drive guard reads them; Apply is left
# out, since the posting's own Apply button opens the form.
SENDS = re.compile(r"\b(submit|send|finish|complete)\b", re.IGNORECASE)
TOOLS = "mcp__playwright__browser_click"
REFUSED = ("That button sends the application, and only Apply clicks it, after its own checks. Don't click it, "
           "and don't send the form any other way: this is the form's last step. Name that button exactly in "
           "submit_button, read every field back and give your answer now.")


def refusal(call: dict) -> dict | None:
    """The hook's answer to one tool call: a refusal of a click on a button
    that sends, else None (the click goes on)."""
    said = " ".join(str((call.get("tool_input") or {}).get(k) or "") for k in ("element", "name"))
    if call.get("tool_name") != TOOLS or not SENDS.search(said):
        return None
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": REFUSED}}


def settings(python: str) -> str:
    """The `--settings` that run this hook on every browser click."""
    return json.dumps({"hooks": {"PreToolUse": [{"matcher": TOOLS, "hooks": [
        {"type": "command", "command": f"{shlex.quote(python)} -m apply.send_click"}]}]}})


if __name__ == "__main__":
    if answer := refusal(json.load(sys.stdin)):
        print(json.dumps(answer))
