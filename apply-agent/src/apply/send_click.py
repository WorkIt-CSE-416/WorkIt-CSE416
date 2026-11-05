"""Claude fill's hook on its browser clicks: a click Claude names as the button
that sends the application is refused before it runs, with word to stop there
and name the button. Any click, key or entry Claude names as on a captcha ("I'm
not a robot", reCAPTCHA, hCaptcha, Turnstile) is refused too: Apply never
touches one (the drive guard refuses it in the captcha's frame as well). The drive guard (apply.submit_guard) would block it on the
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
# Every browser tool that acts on the page, and how Claude names what it acts on.
ACTS = "mcp__playwright__browser_(click|type|fill_form|select_option|press_key|hover|file_upload|drag)"
CAPTCHA = re.compile(r"captcha|not a robot|i'?m not a robot|turnstile|cloudflare|verify (that )?you('| a)re (a )?human"
                     r"|are you (a )?human|human verification|datadome|slide (right|to)", re.IGNORECASE)
REFUSED_CAPTCHA = ("That is a captcha, and Apply never touches one: a person does it. Don't click, tick, type in "
                   "or solve it, and don't try another way. Leave it as it is and go on with the rest of the form; "
                   "if its challenge covers the form, stop: set blocked and say captcha in why.")
REFUSED = ("That button sends the application, and only Apply clicks it, after its own checks. Don't click it, "
           "and don't send the form any other way: this is the form's last step. Name that button exactly in "
           "submit_button, read every field back and give your answer now.")


def refusal(call: dict) -> dict | None:
    """The hook's answer to one tool call: a refusal of a click on a button
    that sends, else None (the click goes on)."""
    given = call.get("tool_input") or {}
    said = " ".join(str(given.get(k) or "") for k in ("element", "name"))
    named = " ".join([said, *(f"{f.get('name') or ''} {f.get('element') or ''}" for f in given.get("fields") or []
                              if isinstance(f, dict))])
    tool = str(call.get("tool_name") or "")
    if re.fullmatch(ACTS, tool) and CAPTCHA.search(named):
        return _deny(REFUSED_CAPTCHA)
    if tool != TOOLS or not SENDS.search(said):
        return None
    return _deny(REFUSED)


def _deny(why: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": why}}


def settings(python: str) -> str:
    """The `--settings` that run this hook on every browser tool that acts on the page."""
    return json.dumps({"hooks": {"PreToolUse": [{"matcher": ACTS, "hooks": [
        {"type": "command", "command": f"{shlex.quote(python)} -m apply.send_click"}]}]}})


if __name__ == "__main__":
    if answer := refusal(json.load(sys.stdin)):
        print(json.dumps(answer))
