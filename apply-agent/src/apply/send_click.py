"""Claude fill's hook on its browser clicks: a click Claude names as the button
that sends the application is refused before it runs, with word to stop there
and name the button. Any click, key or entry Claude names as on a captcha ("I'm
not a robot", reCAPTCHA, hCaptcha, Turnstile) is refused too: Apply never
touches one (the drive guard refuses it in the captcha's frame as well). The drive guard (apply.submit_guard) would block it on the
page anyway, but Claude can't see that block and spends turns on it.

`claude -p` runs it as a PreToolUse hook (`python -m apply.send_click`): the
tool call comes in on stdin, and a refusal goes out on stdout.

Ask Claude (apply.ask) runs it with `--ask`, and there it judges the real element,
never Claude's word for it: a second hook, after each tool (`--after`), keeps what
the page's snapshots show for each ref (`KEPT`), and a tool on a ref the page hasn't
shown, or on no ref, is refused. It refuses typing in a password or verification-code
field, a click on a Resend or Send code button or on a button that sends, and any
act on an attestation, signature or consent box unless Lisul's own message (`--message=`)
names that box's own text (`may_tick`). A snapshot shows an element's role and name;
its attributes (`type=password`) are judged on the page itself: the drive guard's
Ask section on a CDP Worker, plain.tools on a plain one, both by `ELEMENT`."""

import json
import re
import shlex
import sys
from pathlib import Path

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
# Ask Claude only: what asks for a verification code or mail again, and a box only Lisul ticks or signs.
RESEND = re.compile(r"\bre-?send\b|\b(new|another) (code|link|email)\b|\bsend (me )?(a |the )?(new |verification )?(code|link)\b"
                    r"|\bverify (my |your )?email\b|\bverification (code|email|link)\b", re.IGNORECASE)
ATTEST = re.compile(r"attest|\bcertify\b|acknowledg|\bconsent|signature|\be-?sign|\bsign(ed)? (here|below)|\bi (hereby )?"
                    r"(agree|confirm|declare|understand|accept)|terms (of|and)|privacy (policy|notice)"
                    r"|true(,)? (and )?(complete|correct|accurate)|best of my knowledge", re.IGNORECASE)
# A field Apply never lets Ask Claude type in: its words, with - and _ read as spaces (name="otp_code").
SECRET = re.compile(r"\bpass ?(word|code|phrase)\b|\bpin\b|\botp\b|\b2fa\b|\bmfa\b|\bone time\b"
                    r"|\b(verification|verify|security|confirmation|authentication|auth|access|sms|email(ed)?) code\b",
                    re.IGNORECASE)
REFUSED_SECRET = ("That is a password or verification-code field, and Apply never lets Claude type in one: the applicant "
                  "does it. Leave it as it is, and say so in couldnt.")
REFUSED_UNSEEN = ("Apply can't tell what that is: name a ref the page's latest snapshot shows. Take browser_snapshot, "
                  "then use its ref.")
REFUSED_RESEND = ("That asks the site for a verification code or email again, and Apply never does: the applicant "
                  "asks for one themselves. Leave it, and say so in couldnt.")
REFUSED_ATTEST = ("That is an attestation, signature or consent box, and only the applicant ticks or signs it, unless "
                  "their message names that box by its own words. Leave it as it is, and say in waiting that it is "
                  "theirs to tick.")
REFUSED = ("That button sends the application, and only Apply clicks it, after its own checks. Don't click it, "
           "and don't send the form any other way: this is the form's last step. Name that button exactly in "
           "submit_button, read every field back and give your answer now.")


# His message asks for a tick: a verb for it, not negated. Only then can it name a box.
TICK = re.compile(r"\b(tick|check|sign|agree|accept|consent|certify|attest|acknowledge)\b", re.IGNORECASE)
NOT_TICK = re.compile(r"\b(don'?t|do not|never|not)\b[^.,;]{0,40}?\b(tick|check|sign|agree|accept|consent|certify|attest|acknowledge)\b",
                      re.IGNORECASE)
# Words that name no box by themselves: "the" and "to" in common never name one.
PLAIN_WORDS = frozenset(["a", "all", "am", "an", "and", "are", "as", "at", "be", "by", "for", "has", "have", "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "with"])
CONTENT_WORDS = 2  # how many of a box's own words, in a row in his message, name it


def asks_a_tick(message: str) -> bool:
    """Whether Lisul's message could name a box to tick at all."""
    return bool(TICK.search(message)) and not NOT_TICK.search(message)


def may_tick(message: str, box: str) -> bool:
    """Whether Lisul's message names this attestation box by its own text: all of it, or a run of its words in
    a row with at least two that aren't plain words. "Check the box" names none, nor does "tick the certify box"."""
    if not asks_a_tick(message):
        return False
    said, own = _words(message), _words(box)
    if not own:
        return False
    for start in range(len(own)):
        for at in range(len(said)):
            run = 0
            while start + run < len(own) and at + run < len(said) and own[start + run] == said[at + run]:
                run += 1
            if run == len(own) or sum(w not in PLAIN_WORDS for w in own[start:start + run]) >= CONTENT_WORDS:
                return True
    return False


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", str(text or "").replace("\u2019", "'").casefold())


# What the page says of the element a tool would act on, or an event hit: its own control (a label's input), the
# words it shows and is named by, and its attributes. Run in the page (plain.tools, the drive guard's Ask section).
ELEMENT = r"""(el) => {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let box = (el.closest && el.closest('input, select, textarea, button, a, label, [role=checkbox], [role=switch], '
    + '[role=radio], [role=button], [role=link], [role=textbox], [role=combobox], [contenteditable=true]')) || el;
  if (box.tagName === 'LABEL' && box.control) box = box.control;
  const by = (box.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map((id) => clean((document.getElementById(id) || {}).innerText)).join(' ');
  const labels = box.labels ? [...box.labels].map((l) => clean(l.innerText)).join(' ') : '';
  const field = /^(INPUT|SELECT|TEXTAREA)$/.test(box.tagName);
  const inner = field ? (/^(button|submit)$/.test(box.type) ? box.value : '') : clean(box.innerText || box.textContent);
  // A box with no words of its own: the few words beside it, never a whole page's.
  const beside = !box.getAttribute('aria-label') && !labels && !inner && !by && box.parentElement ? clean(box.parentElement.innerText) : '';
  const around = beside.length <= 300 ? beside : '';
  const role = box.getAttribute('role') || (box.tagName === 'INPUT' ? (/^(checkbox|radio)$/.test(box.type) ? box.type : /^(button|submit)$/.test(box.type) ? 'button' : 'textbox')
    : box.tagName === 'BUTTON' ? 'button' : box.tagName === 'A' ? 'link' : box.tagName === 'SELECT' ? 'combobox' : box.tagName === 'TEXTAREA' ? 'textbox' : 'generic');
  return {role, type: String(box.type || ''), text: clean([box.getAttribute('aria-label'), by, labels, inner, around].filter(Boolean).join(' ')).slice(0, 500),
          attrs: [box.id, box.getAttribute('name'), box.getAttribute('autocomplete'), box.getAttribute('placeholder')].filter(Boolean).join(' ')};
}"""
# The same of the focused element, where a key would go.
FOCUSED = "() => { const el = document.activeElement; return el && el !== document.body ? (" + ELEMENT + ")(el) : null; }"
TYPES = ("type", "fill")
PRESSES = ("click",)
NOT_BUTTONS = ("checkbox", "radio", "switch", "option", "textbox", "combobox", "listbox", "searchbox", "spinbutton")
BUTTON_WORDS = 100  # past this a "generic" holds much more than its button's words


def judged(act: str, facts: dict, message: str = "") -> dict | None:
    """Ask mode's answer to one act (click, type, fill, select, key) on the real element, by `facts` (ELEMENT's shape)."""
    text, attrs, role = str(facts.get("text") or ""), str(facts.get("attrs") or ""), str(facts.get("role") or "")
    typed = act in TYPES or act == "key"
    if typed and (facts.get("type") == "password" or SECRET.search(re.sub(r"[-_]+", " ", f"{text} {attrs}"))):
        return _deny(REFUSED_SECRET)
    if ATTEST.search(text) and act != "key" and not may_tick(message, text):
        return _deny(REFUSED_ATTEST)
    if act in PRESSES and role not in NOT_BUTTONS and len(text) <= BUTTON_WORDS:
        if RESEND.search(text):
            return _deny(REFUSED_RESEND)
        if SENDS.search(text):
            return _deny(REFUSED)
    return None


# --- what the page's snapshots show, for the hook

KEPT = ".apply-ask-refs.json"  # in the drive's own folder, which Claude's tools can't read
REF = re.compile(r"\[ref=((?:f\d+)?e\d+)\]")
LINE = re.compile(r"^(\s*)- (?:'|\")?([a-z]+)(.*)$")
TARGET = re.compile(r"^(?:\[?ref=)?((?:f\d+)?e\d+)\]?$")
_BRACKETS = re.compile(r"\[[a-z]+(=[^\]]*)?\]")
CHILD_LINES = 8
BOXES = ("checkbox", "radio", "switch")


def snapshot_refs(snapshot: str) -> dict[str, dict]:
    """Each ref a snapshot shows: {ref: {role, text}}. The text is the element's own name and inline text, else
    its first children's; an unnamed box takes its parent's (a checkbox beside its text)."""
    lines, found = snapshot.splitlines(), {}
    for n, line in enumerate(lines):
        ref, shape = REF.search(line), LINE.match(line)
        if not ref or not shape:
            continue
        indent, role = len(shape[1]), shape[2]
        text = _own_text(shape[3])
        if not text:
            text = _under(lines, n, indent)
        if not text and role in BOXES:
            parent = next((k for k in range(n - 1, -1, -1) if _indent(lines[k]) < indent), None)
            if parent is not None:
                text = " ".join(x for x in (_own_text((LINE.match(lines[parent]) or [""] * 4)[3]), _under(lines, parent, _indent(lines[parent]))) if x)
        found[ref[1]] = {"role": role, "text": text[:500]}
    return found


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def _own_text(rest: str) -> str:
    return re.sub(r"\s+", " ", _BRACKETS.sub(" ", rest)).strip(" :\"'")


def _under(lines: list[str], n: int, indent: int) -> str:
    said = []
    for line in lines[n + 1:n + 1 + CHILD_LINES]:
        if _indent(line) <= indent:
            break
        if shape := LINE.match(line):
            words = _own_text(shape[3])
            said.append(f"{shape[2].removeprefix('text')} {words}".strip() if shape[2] == "text" else words)
    return " ".join(w for w in said if w)


def keep(call: dict) -> None:
    """After a tool: keep what its answer's snapshot shows for each ref, for the hook on the next tool."""
    found = {}
    for text in _strings(call.get("tool_response")):
        if "[ref=" in text:
            found |= snapshot_refs(text)
    if found:
        path = Path(str(call.get("cwd") or ".")) / KEPT
        path.write_text(json.dumps(_kept(call) | found))


def _kept(call: dict) -> dict:
    try:
        return json.loads((Path(str(call.get("cwd") or ".")) / KEPT).read_text())
    except (OSError, ValueError):
        return {}


def _strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def _asked(call: dict, message: str) -> dict | None:
    """Ask mode's answer to one tool call, on what the page showed for each ref it names."""
    given = call.get("tool_input") or {}
    tool = str(call.get("tool_name") or "").removeprefix("mcp__playwright__browser_")
    if tool == "fill_form":
        acts = [("click" if f.get("type") in ("checkbox", "radio") else "fill", f.get("target"))
                for f in given.get("fields") or [] if isinstance(f, dict)]
    elif tool in ("click", "type", "select_option", "hover"):
        acts = [({"select_option": "select"}.get(tool, tool), given.get("target"))]
    else:
        return None
    kept = _kept(call)
    for act, target in acts:
        ref = TARGET.match(str(target or "").strip())
        facts = kept.get(ref[1]) if ref else None
        if facts is None:
            return _deny(REFUSED_UNSEEN)
        if answer := judged(act, facts, message):
            return answer
    return None


def refusal(call: dict, ask: bool = False, message: str = "") -> dict | None:
    """The hook's answer to one tool call: a refusal of a click on a button
    that sends, else None (the click goes on). With `ask` (Ask Claude), on the
    real element: see the module's docstring."""
    given = call.get("tool_input") or {}
    said = " ".join(str(given.get(k) or "") for k in ("element", "name"))
    named = " ".join([said, *(f"{f.get('name') or ''} {f.get('element') or ''}" for f in given.get("fields") or []
                              if isinstance(f, dict))])
    tool = str(call.get("tool_name") or "")
    if re.fullmatch(ACTS, tool) and CAPTCHA.search(named):
        return _deny(REFUSED_CAPTCHA)
    if ask:
        return _asked(call, message) if re.fullmatch(ACTS, tool) else None
    if tool != TOOLS or not SENDS.search(said):
        return None
    return _deny(REFUSED)


def _deny(why: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": why}}


def settings(python: str, flags: tuple[str, ...] = ()) -> str:
    """The `--settings` that run this hook on every browser tool that acts on the page, with `flags`
    (Ask Claude's `--ask`, `--message=<his message>`), and in Ask mode keep the refs after every browser tool."""
    command = " ".join([shlex.quote(python), "-m", "apply.send_click", *(shlex.quote(f) for f in flags)])
    hooks = {"PreToolUse": [{"matcher": ACTS, "hooks": [{"type": "command", "command": command}]}]}
    if "--ask" in flags:
        after = " ".join([shlex.quote(python), "-m", "apply.send_click", "--after"])
        hooks["PostToolUse"] = [{"matcher": "mcp__playwright__browser_.*", "hooks": [{"type": "command", "command": after}]}]
    return json.dumps({"hooks": hooks})


def flags_of(flags: tuple[str, ...]) -> tuple[bool, str]:
    """(Ask mode?, his message) from the hook's flags."""
    message = next((f.removeprefix("--message=") for f in flags if f.startswith("--message=")), "")
    return "--ask" in flags, message


if __name__ == "__main__":
    asked = json.load(sys.stdin)
    if "--after" in sys.argv:
        keep(asked)
    else:
        mode, words = flags_of(tuple(sys.argv[1:]))
        if answer := refusal(asked, ask=mode, message=words):
            print(json.dumps(answer))
