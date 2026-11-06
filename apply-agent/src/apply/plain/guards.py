"""The submit and drive guards on a plain Worker's page (KAN-610, S4).

apply.submit_guard's guard, lift, rearm, renote and DriveGuard come here when the page is a
PortPage. The same scripts guard the page, as fixed files of the worker extension: `prepare`
writes each into worker-extension/vendor/guards/, and the extension registers it as a
MAIN-world content script at document_start in every frame (Playwright's add_init_script),
refusing a file whose sha256 isn't Apply's. No eval and no user scripts, so it runs where page
CSP forbids eval and in Chrome for Testing.

Below the in-page guard, Playwright's route becomes declarativeNetRequest session rules on the
guarded tab (and the tabs it opens, and requests from no tab: service workers): a non-GET
request to any of the guard's final application URLs (its FINAL_URLS, which include ROUTED's) is
blocked before it leaves Chrome, from page code, its workers, or a form's native POST. Unlike a
Playwright route, a rule needs no Python handler, so it blocks the page URLs too (Greenhouse's
posting, Lever's /apply), a page Claude opens never waits on it, and GETs always go.

Untrusted presses: a plain Worker's every click and key is synthetic, so the guard script's copy
here (`port=True`) also counts as a touch the `__apply_touch` the extension dispatches before
each press it makes: Apply's own (page/dom.js) and Lisul's from the tile (tile.input calls touch(), and
the extension reports `guard.touched` up the port itself). What a guard blocked reaches Apply
as `guard.said` events, not the console.
"""

import hashlib
import re
import time
from pathlib import Path

from apply import submit_guard
from apply.submit_guard import DriveGuard

FOLDER = "guards"  # under worker-extension/vendor/


def _final_urls() -> list[str]:
    """The guard script's FINAL_URLS, as regex source (the JS literals with `\\/` as `/`)."""
    block = submit_guard._TEMPLATE.split("const FINAL_URLS = [", 1)[1].split("];", 1)[0]
    return [m.group(1).replace("\\/", "/") for m in re.finditer(r"^\s*/(.+)/i,\s*$", block, re.MULTILINE)]


FINAL_URLS = _final_urls()
# What the plain route blocks (non-GET only): each of FINAL_URLS, as one declarativeNetRequest rule.
# RE2 caps a rule's regex at 2 KB compiled, which Lever's 36-character posting id overruns: it
# takes any run of those characters there (only ever more blocked, never less).
RULES = [r.replace("[0-9a-f-]{36}", "[0-9a-f-]+") for r in FINAL_URLS]
PATTERN = re.compile("|".join(f"(?:{r})" for r in RULES), re.IGNORECASE)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _lifted_file() -> str:
    """LIFTED as window.__applyLift({again, warning, wrong, held}), run in each frame of a lifted tab."""
    body = submit_guard.LIFTED.replace("AGAIN", "note.again === true").replace("WRONG", "note.wrong !== false")
    body = body.replace("HELD", "String(note.held || '')").replace("WARNING", "String(note.warning || '')")
    return "window.__applyLift = (note) => {\n" + body.strip().removesuffix(";") + ";\n};\n"


def _applied_file() -> str:
    """APPLIED_NOTE as window.__applyAppliedNote(day), run in the top frame of a tab that shows it (KAN-621)."""
    body = submit_guard.APPLIED_NOTE.replace("const day = DAY;", "const day = String(noteDay);")
    assert "DAY" not in body
    return "window.__applyAppliedNote = (noteDay) => {\n" + body.strip().removesuffix(";") + ";\n};\n"


def files() -> dict[str, str]:
    """Each guard file's name in vendor/guards/ and its text."""
    out = {"rehearsal.js": submit_guard.rehearsal_script(port=True),
           "lifted.js": _lifted_file(), "rearmed.js": submit_guard.REARMED, "applied.js": _applied_file()}
    for sms in (False, True):
        for marketing in (False, True):
            out[f"drive-{int(sms)}{int(marketing)}.js"] = submit_guard.drive_script(sms, marketing, port=True)
    return out


# The CDP script each plain file stands for, by sha256: what add_init_script recognizes.
def _prepared() -> dict[str, str]:
    known = {_sha(submit_guard.SCRIPT): "rehearsal.js", _sha(submit_guard.REARMED): "rearmed.js"}
    for sms in (False, True):
        for marketing in (False, True):
            known[_sha(submit_guard.drive_script(sms, marketing))] = f"drive-{int(sms)}{int(marketing)}.js"
    return known


PREPARED = _prepared()
FILES = files()


def write(vendor: Path) -> None:
    """Write vendor/guards/*.js, each only when it changed (extension.prepare)."""
    folder = vendor / FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    for name, text in FILES.items():
        path = folder / name
        if not path.exists() or path.read_text() != text:
            path.write_text(text)


def file_params(name: str) -> dict:
    return {"file": f"vendor/{FOLDER}/{name}", "sha256": _sha(FILES[name])}


def init_script(script: str) -> dict:
    """guard.script's params for an add_init_script of `script`: its guard file when it is one
    of the guards' scripts, else the code itself (which needs Allow User Scripts on)."""
    if (name := PREPARED.get(_sha(script))):
        return {"id": name.removesuffix(".js"), **file_params(name)}
    return {"id": _sha(script)[:16], "code": script}


def alternatives(pattern: str) -> list[str]:
    """A regex's top-level alternatives (declarativeNetRequest takes one short regex per rule)."""
    parts, depth, klass, escaped, start = [], 0, False, False, 0
    for i, c in enumerate(pattern):
        if escaped:
            escaped = False
        elif c == "\\":
            escaped = True
        elif klass:
            klass = c != "]"
        elif c == "[":
            klass = True
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "|" and depth == 0:
            parts.append(pattern[start:i])
            start = i + 1
    return parts + [pattern[start:]]


# --- submit_guard on a plain page

def guard(page, reload: bool = True) -> None:
    """submit_guard.guard: the rules on this tab, the guard on every page from now, then a reload
    (none from submit_guard.on_open, before the tab's first load)."""
    page.route(PATTERN, submit_guard._refuse)
    page.context.add_init_script(submit_guard.SCRIPT)
    if reload:
        page.reload(wait_until="domcontentloaded")


def lift(page, pressed=None, again=None, warning: str = "", wrong: bool = True, bound: bool = False,
         held: str = "", dismiss=None) -> None:
    """submit_guard.lift: the page and every page Lisul loads in its tab are his, but for a `held`
    Submit (KAN-629): the guard script still blocks the button that sends, and the red note's Dismiss
    calls `dismiss`. The rules come off either way: the in-page guard alone holds a held Submit."""
    if bound:
        pressed = again = dismiss = None
    if pressed:
        page.expose_binding("__applyLisulPressed", lambda source, words, account=False: pressed(words, account=account))
    if again:
        page.expose_binding("__applyFillAgain", lambda source: again())
    if dismiss:
        page.expose_binding("__applyDismissHold", lambda source: dismiss())
    page.unroute(PATTERN, submit_guard._refuse)
    _note(page, bool(again or bound), warning, wrong, held)


def renote(page, warning: str = "", wrong: bool = True, held: str = "") -> bool:
    """submit_guard.renote: the lifted page's note anew (`held`: what holds Submit still). A page
    still guarded (one Lisul already applied to, KAN-621) stays guarded: False."""
    return _note(page, True, warning, wrong, held, only_lifted=True) is not False


def _note(page, again: bool, warning: str, wrong: bool, held: str = "", only_lifted: bool = False):
    return page.worker.call("guard.lift", tab=page.tab, again=again, warning=warning, wrong=wrong, held=held,
                            onlyLifted=only_lifted, sha256=_sha(FILES["lifted.js"]))


def warn_applied(page, day: str, dismissed=None) -> None:
    """submit_guard.warn_applied: the red "You already applied on <day>" note on this page and each one
    its tab loads; the guard stays on. `dismissed` hears his second press of Dismiss."""
    if dismissed:
        page.expose_binding("__applyDismissApplied", lambda source: dismissed())
    page.worker.call("guard.applied", tab=page.tab, day=day, sha256=_sha(FILES["applied.js"]))


def applied_dismissed(page) -> None:
    """submit_guard.applied_dismissed: no page of the tab shows the note again."""
    page.worker.call("guard.applied", tab=page.tab, day=None, sha256=_sha(FILES["applied.js"]))


def rearm(page) -> None:
    """submit_guard.rearm: the rules back on and the page Apply's again, with no reload."""
    page.route(PATTERN, submit_guard._refuse)
    page.worker.call("guard.rearm", tab=page.tab, sha256=_sha(FILES["rearmed.js"]))


def touch(page, by: str = "lisul", frame: int = 0) -> None:
    """Count a press about to be made in `frame` as Lisul's (or Apply's) touch: what S3's tile
    replay does in the extension before each press of his."""
    page.worker.call("guard.touch", tab=page.tab, frame=frame, by=by)


def reset(worker) -> None:
    """No guard left on the Worker (a Worker reused for another Application): its init scripts,
    rules, lifts and bindings all go. Its open pages keep what already ran in them."""
    worker.call("guard.reset")
    worker.__dict__.pop("_bindings", None)


class PlainDriveGuard(DriveGuard):
    """DriveGuard on a plain Worker's page: its script registered for every page from now and run
    in the open page's frames, what it (or a rehearsal's guard) blocked heard as `guard.said`."""

    def __init__(self, page, sms_opt_in: bool = False, marketing_opt_in: bool = False):
        self._page = page
        self._blocked: list[str] = []
        self._driving = False
        script = submit_guard.drive_script(sms_opt_in, marketing_opt_in)
        page.worker.on("guard.said", self._said)
        page.context.add_init_script(script)
        page.worker.call("guard.inject", tab=page.tab, **file_params(PREPARED[_sha(script)]))

    def _said(self, message: dict) -> None:
        if message.get("tab") == self._page.tab:
            for said in submit_guard.HEARD:
                if (text := str(message.get("text", ""))).startswith(said):
                    self._blocked.append(text.removeprefix(said))
                    return

    def blocked(self) -> list[str]:
        try:
            self._page.worker.call("guard.sync", tab=self._page.tab)  # what the page said before now has come
            time.sleep(0.05)  # and its event has been read off the port
        except Exception:
            pass  # a page that went away has said all it will
        return list(self._blocked)

    def lift(self) -> None:
        self._flags(__applyDriveLifted=True)

    def let_account_click(self) -> None:
        self._flags(__applyAccountClick=True)

    def let_profile_click(self, let: bool = True) -> None:
        self._flags(__applyProfileClick=let)

    def let_upload_post(self, let: bool = True) -> None:
        self._flags(__applyUploadPost=let)

    def let_start_click(self) -> None:
        self._flags(__applyStartClick=True)

    def arm(self) -> None:
        self._flags(__applyDriveLifted=False, __applyAccountClick=False, __applyProfileClick=False,
                    __applyUploadPost=False, __applyStartClick=False)
        self._set_driving(True)

    def asking(self, on: bool, may_tick: bool = False) -> None:
        """Nothing on the page: every press here comes through plain.tools, which judges it on the real element."""

    def _set_driving(self, driving: bool) -> None:
        """Only keeps the state. A captcha's frame refuses trusted presses alone, and every press on a plain
        Worker is synthetic: there the plain tools refuse each action on a captcha (KAN-617)."""
        self._driving = driving

    def _flags(self, **flags) -> None:
        try:
            self._page.worker.call("guard.flags", tab=self._page.tab, set=flags)
        except Exception:
            pass  # a page that went away, as _in_frames
