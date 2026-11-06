"""The dashboard: one Chrome app window with a live tile per Worker, so
Lisul can watch every Worker at once. Workers run headless, so the tiles
are their only windows.

It is served on 127.0.0.1 (stdlib http.server). Each tile shows Worker k's
current page live. The window takes every tile's frames over one connection,
GET /frames: a browser opens at most six to one host, and a stream per tile
(GET /stream/k, MJPEG, still there for a single tile) left none for the
window's other requests. The latest frame alone is at GET /frame/k.

Each tile leads with a verdict from GET /state, coloured: whether its
Application is filling, ready (stopped before Submit), needs Lisul, or
failed; a line on top sums them all up. A click on a tile enlarges it and
hands Lisul its browser: clicks, the wheel, keys, pastes, a <select>'s
options and a file the page asks for go to the Worker's page (POST
/input/k) till Esc, so he can finish or fix a form from the tile itself.
Under its caption a tile lists the files its form was given (the résumé, a
cover letter): View opens the copy that was sent (GET /file/k/i) and Show
in Finder reveals it (POST /reveal/k/i). Only a file a tile lists is ever
served or revealed.
A Worker's Chrome is headless and keeps its profile locked, so it cannot
be shown in a window of its own: the tile is its only window.

The frames come from the dashboard's own thread (CdpFrames), with its own
Playwright connected over CDP to each Worker's Chrome: a Worker thread's
Playwright only answers while that thread calls it, and freezes while it
waits on `claude -p`, so the dashboard never touches the Workers' own.
Plain Workers (no CDP, apply.plain) have their own frame source with the
same Frames shape: apply.plain.tile.PortFrames, over each Worker's port.
"""

import base64
import hmac
import json
import math
import os
import queue
import re
import secrets
import signal
import struct
import subprocess
import tempfile
import threading
import time
from collections import Counter
from collections.abc import Callable
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, Self
from urllib.parse import parse_qs, urlsplit

from apply import bot_signals, captcha, dock_app, masked, stuck
from apply.answers_tab import AnswersTab, Refused
from apply.asking import IN
from apply.dashboard_page import (
    ACCOUNTS,
    ACCOUNTS_TAB,
    ANSWERS,
    APPLIED,
    HISTORY,
    INBOX,
    NO_RUN,
    PAGE,
    STYLE,
    TABS,
)
from apply.focus import KEEPER
from apply.model import one_line
from apply.tracker import cell_options

if TYPE_CHECKING:
    # The Accounts tab imports the adapters, which import this module.
    from apply.accounts_tab import AccountsTab

JPEG_QUALITY = 70
MODIFIERS = ("Alt", "Control", "Meta", "Shift")
# The most an Answers tab edit may send: room for the longest answer, and no more.
MAX_BODY = 256 * 1024
MAX_FILE = 15 * 1024 * 1024  # an answer that is a file, base64 in its JSON
# Seconds the window's page has to load again after it goes away (a reload) before its window counts as closed.
CLOSE_GRACE = 3.0
# Seconds a window opened behind Lisul's app is kept there, while Chrome may still bring itself forward.
BEHIND_FOR = 10.0
MAX_ITEMS = 500  # ended Applications the window keeps, the newest
# The status of an Inbox item for a form still filling whose Missing facts are known already.
ASKING = "still filling"
NOTIFY_EVERY = 60.0  # s: at most one macOS notification a minute of what newly waits on Lisul
FOCUS_FRESH = 3.0  # s a poll's word that the window is in front holds
FRAME_GAP = 0.015  # s between turns of /frames: at most about 60 frames a second a tile (a filmed plain tile sends 30)
PUMP = 30  # ms the frames thread waits each turn, letting screencast frames and input through
GO_TO_WAIT = 8.0  # s Go to question waits for the held form's hold loop to show the field
ERRORS_EVERY = 2.0  # s between reads of each Worker's page for a field error it shows (apply.stuck)


def jpeg_size(frame: bytes) -> tuple[int, int] | None:
    """(width, height) of a JPEG, from its start-of-frame segment."""
    i = 2
    while i + 9 < len(frame):
        if frame[i] != 0xFF:
            return None
        marker, length = frame[i + 1], int.from_bytes(frame[i + 2:i + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(frame[i + 7:i + 9], "big"), int.from_bytes(frame[i + 5:i + 7], "big")
        i += 2 + length
    return None


def to_page(x: float, y: float, tile_width: float, tile_height: float, frame_width: int, frame_height: int,
            clamp: bool = False):
    """The page point (CSS pixels) under (x, y) in a tile that shows a
    frame fitted inside it and centred; None outside the frame, or with
    `clamp` the nearest point on it, in the frame's own pixels. A CDP frame
    is the page's viewport at CSS size; a plain Worker's may be 2x (filmed,
    KAN-635), and its page scales the point by the frame's size (page/tile.js)."""
    scale = min(tile_width / frame_width, tile_height / frame_height)
    left, top = (tile_width - frame_width * scale) / 2, (tile_height - frame_height * scale) / 2
    px, py = (x - left) / scale, (y - top) / scale
    if clamp:
        px, py = min(max(px, 0), frame_width), min(max(py, 0), frame_height)
    if not (0 <= px <= frame_width and 0 <= py <= frame_height):
        return None
    return round(px), round(py)


def is_view(metadata: dict) -> bool:
    """Whether a screencast frame shows the page's window, not the whole page
    laid out at once for a full-page screenshot (a tall frame), which the tile skips."""
    return metadata.get("deviceHeight", 0) <= 1.2 * metadata.get("deviceWidth", 0)


def grid(tiles: int) -> tuple[int, int]:
    """(columns, rows) for `tiles` tiles: ceil(sqrt(n)) columns, as many rows as needed."""
    columns = max(1, math.ceil(math.sqrt(tiles)))
    return columns, max(1, math.ceil(tiles / columns))


# The window's plain words for Apply's terms (GLOSSARY.md), and a line of help on each:
# labels, headings and the ? beside a term all come from here. The Tracker's own
# word (the key, where it is one of its statuses) is shown only as quiet second text.
WORDS = {
    "held": ("Waiting for your OK", "Apply filled it and stopped before sending: it's a company you asked to check "
             "first, it has an essay about the company, or it's one of your first 10 applications."),
    "missing fact": ("Question only you can answer", "A form asked something your facts don't say. Answer it once "
                     "and Apply keeps the answer for every form that asks."),
    "needs sign-in": ("Sign in once", "The job site wants an account. Sign in once and Apply remembers it for "
                      "every job on that site."),
    "check": ("Answer to check before sending", "Before it sends, Apply checks every answer against your facts; "
              "one didn't match."),
    "captcha": ("Do the captcha", "Apply never solves a captcha. Do it on the form's page; Apply waits, and goes on "
                "by itself once it's gone."),
    "blocked": ("Finish it in your Chrome", "The job site refused Apply's Chrome as a bot. Open the posting in "
                "your own Chrome: the WorkIt extension fills it there, and you press Submit."),
    "handoff": ("Finish this one yourself", "Apply got as far as it could; the rest needs a person, such as a site that blocks it."),
    "needs code": ("Type the emailed code", "After you pressed Submit, the job site asked for a code it emailed "
                   "you. Apply looks for it in Gmail and types it in; this time it couldn't, so it typed nothing."),
    "code filled": ("Code filled, not sent", "After you pressed Submit, the job site asked for a code it emailed "
                    "you. Apply typed it in from Gmail. It never presses Submit: that's yours."),
    "failed": ("Couldn't finish", "Something went wrong. Nothing was sent; Apply keeps a note to fix it and tries again."),
    "submitted": ("Sent", "The application went in."),
    "ready to submit": ("Filled, not sent", "A practice run fills the form and stops before Submit."),
    "filling": ("Filling", "Apply is answering this application's questions now."),
    "verifying": ("Verifying…", "Apply reads the filled form back from the page and checks each answer against your "
                  "facts, before anything is sent. It never presses Submit."),
    "verified": ("Verified", "Apply read the filled form back and found nothing that needs you."),
    "skipped": ("Skipped", "Apply didn't apply, for the reason given."),
    "rehearsal": ("Practice run", "Fills forms and sends nothing; each page is yours to check once it stops."),
    "run": ("Live run", "Fills forms and sends them, except those that wait for your OK."),
    "bank": ("Saved answers", "Answers to one-off questions, used word for word on every form that asks. Claude "
             "writes one the first time a form asks; check it once and it's yours."),
}
READY = WORDS["ready to submit"][0]
SENT = WORDS["submitted"][0]
IDLE = "Waiting for the next job"
# Parts of a rehearsal's ready-to-submit reason that Lisul must look at; the
# rest (Calibration run, Target company...) only say a run would hold it.
TO_CHECK = ("Not filled", "Pre-submit check failed", "Pre-submit review", "Verify: ", "Yours to tick")
TICK_YOURS = "Tick or sign what is yours before it's sent"  # an attestation Apply left for Lisul, his alone
# Each part of a Hold's reason in plain words.
HOLD_WORDS = [
    (re.compile(r"^Target company: (.+)$"), r"\1 is on your check-first list"),
    (re.compile(r"^High-stakes essay: (.+)$"), r"it has an essay about the company (\1)"),
    (re.compile(r"^Calibration run: Application (\d+) of (\d+).*$"),
     r"it's one of your first \2 applications (\1 of \2), so you can check Claude's answers"),
]
# Each job system by its proper name; any other is capitalised.
JOB_SYSTEMS = {"greenhouse": "Greenhouse", "ashby": "Ashby", "lever": "Lever", "workday": "Workday",
               "rippling": "Rippling", "workable": "Workable", "smartrecruiters": "SmartRecruiters", "icims": "iCIMS",
               "bamboohr": "BambooHR"}
# A reason that is a raw Python or Playwright error, "TimeoutError: Page.goto: ...", and the plain words for its kinds.
RAW_ERROR = re.compile(r"^[A-Z]\w*(Error|Exception|Interrupt|Exit)\b:?")
CAUSES = [(re.compile(p, re.IGNORECASE), cause) for p, cause in [
    (r"timeout|timed out", "the page took too long to respond"),
    (r"net::|ERR_|connection|unreachable", "the page couldn't be reached"),
    (r"closed|crash|disconnected", "the browser closed before it finished"),
]]
# Heads the answers Claude drafted for a tile's Application, one "question → answer" a line.
DRAFTED = "Written by Claude (in Saved answers, to check):"


def job_system(key: object) -> str:
    """A job system's proper name, "Greenhouse" for "greenhouse"."""
    key = str(key or "")
    return JOB_SYSTEMS.get(key.lower(), key[:1].upper() + key[1:])


def failure(why: str) -> tuple[str, str]:
    """(the plain cause, the raw error or "") of a failed Application's reason."""
    if not RAW_ERROR.match(why):
        return why.rstrip("."), ""
    cause = next((cause for pattern, cause in CAUSES if pattern.search(why)), "something on the page went wrong")
    return cause, why


def plain(why: str) -> str:
    """A Hold's (or any) reason with each part Apply's rules name said in plain words."""
    parts = []
    for part in filter(None, why.split("; ")):
        for pattern, words in HOLD_WORDS:
            if pattern.match(part):
                part = pattern.sub(words, part)
                break
        parts.append(part.removeprefix("Pre-submit check failed. ").removeprefix("Missing fact: ").removeprefix("Verify: "))
    return "; ".join(parts)


def verdict(caption: dict) -> dict[str, str]:
    """What a tile says at a glance of how its Application went: a tone
    (idle, filling, ready, submitted, needs, failed, ended) and a short label;
    the detail is the reason in full, then each answer Claude drafted. One
    that needs Lisul also says its kind (a WORDS key), what to do, why, and
    what then happens: the same three lines its Inbox row shows."""
    status, why = str(caption.get("status") or ""), one_line(str(caption.get("why") or ""))
    # How verifying the filled form went (apply.verify): its flags that need Lisul, and whether it found none.
    verification = caption.get("verification") or {}
    flags = [f for f in verification.get("flags") or [] if f.get("holds")]
    verified = verification.get("state") == "verified"
    missing = "; ".join(caption.get("missing") or [])
    company, system = str(caption.get("company") or ""), job_system(caption.get("job_system"))
    checks = [part for part in why.split("; ") if part.startswith(TO_CHECK)]
    cause, error = failure(why or status)
    tone, label, detail, kind = "failed", f"{WORDS['failed'][0]}: {cause}", "", "failed"
    needs = {}
    if not status:
        tone, label, kind = "idle", IDLE, ""
    elif status == "filling" and caption.get("verifying"):
        tone, label, kind = "verifying", WORDS["verifying"][0], "verifying"
        detail = WORDS["verifying"][1]
    elif status == "filling":  # a rehearsal held for Start says how far it got; else what Apply is doing (apply.stuck)
        stage = {"getting ready": "Getting ready", "ready": "Ready"}.get(str(caption.get("stage") or ""))
        tone, label, kind = "filling", stage or WORDS["filling"][0], "filling"
        detail = str(caption.get("doing") or "")
    elif status == "submitted":  # sent: what it asked of Lisul before waits on him no more (KAN-622)
        tone, label, kind = "submitted", f"{WORDS['verified'][0]} and sent" if verified else SENT, "submitted"
        detail = why
    elif missing or status == "missing fact":
        needs = {"kind": "missing fact", "do": "Answer a question only you know", "why": missing or plain(why),
                 "then": "Saved to your facts, for every form that asks it, and filled in on this form" if missing
                 else "Saved in your Tracker; this application goes on at the next check"}
    elif flags and status in ("ready to submit", "held"):
        needs = {"kind": "check", "do": verification.get("label") or WORDS["check"][0],
                 "why": "; ".join(f"{f['field']}: {f['why']}" if f.get("field") else f["why"] for f in flags),
                 "then": "Nothing has been sent. Fix each on the page, or dismiss it here"
                 + (", then press Submit yourself if you want it sent" if status == "ready to submit"
                    else "; once every one is dismissed, approve it to send it")}
    elif checks:
        # Only attestations to tick (KAN-676): Lisul ticks or signs each himself; nothing of Apply's is wrong.
        do = TICK_YOURS if all(part.startswith("Yours to tick") for part in checks) else "Fix an answer before it's sent"
        needs = {"kind": "check", "do": do, "why": plain("; ".join(checks)),
                 "then": "Nothing has been sent. Fix it on the page, then press Submit yourself if you want it sent"
                 if status == "ready to submit" else "Apply checks every answer again before it sends"}
    elif status == "ready to submit":
        tone, label, kind = "ready", f"{WORDS['verified'][0]} · {READY.lower()}" if verified else READY, "ready to submit"
        detail = "\n".join(filter(None, [
            "Nothing has been sent. This page is yours now: check it, and press Submit yourself to send it "
            "(it goes in your Tracker)", why and f"In a real run this would wait for your OK: {plain(why)}"]))
    elif status == "held":
        needs = {"kind": "held", "do": "Review and approve before it's sent", "why": plain(why),
                 "then": "Approve it here and it's sent at the next check, within 5 minutes"}
    elif status == "needs sign-in":
        site = f"{company}'s {system} site" if company and system else f"the {system} site" if system else "this job site"
        needs = {"kind": "needs sign-in", "do": f"Sign in to {site} once", "why": why,
                 "then": f"Apply remembers the sign-in for every {system or 'such'} job"}
    elif status == "needs code":
        needs = {"kind": "needs code", "do": WORDS["needs code"][0], "why": why,
                 "then": "Nothing more was sent. Type the code from your email, then press Submit yourself"}
    elif status == "code filled":
        tone, label, kind, detail = "ready", WORDS["code filled"][0], "code filled", why
    elif status == "handoff" and caption.get("blocked"):  # a bot block (KAN-590): his own Chrome, where the extension fills it
        needs = {"kind": "blocked", "do": captcha.FINISH.format(company or "it"), "why": plain(why),
                 "then": "Nothing was sent. Press Open in my Chrome: the posting opens in your everyday Chrome, the "
                 "WorkIt extension fills it, and you do any challenge and press Submit. It waits here till then"}
    elif status == "handoff" and caption.get("captcha"):
        needs = {"kind": "captcha", "do": WORDS["captcha"][0], "why": plain(why),
                 "then": "Do it on the page (Fix here, or Open in Chrome). Apply goes on by itself once it's gone, "
                 "or press Resume"}
    elif status == "handoff":
        needs = {"kind": "handoff", "do": WORDS["handoff"][0], "why": plain(why),
                 "then": "Nothing was sent. Open it and finish the form, then press Submit"}
    elif status == "not eligible":
        tone, label, kind = "ended", "Skipped: you don't qualify" + (f" ({why})" if why else ""), "skipped"
    elif status == "closed":
        tone, label, kind = "ended", "Skipped: no longer taking applications", "skipped"
    elif status == "skipped":
        tone, label, kind = "ended", f"Skipped: {why}", "skipped"
    elif status == "paused":
        tone, label, kind = "ended", "Paused at Claude's usage limit; it goes on by itself", "skipped"
    elif status == "already applied":  # KAN-621: the form was never opened
        tone, label, kind = "ended", (why or "Already applied").split(" (")[0], "skipped"
        detail = f"{why}. Apply didn't open the form, so nothing was filled or sent"
    resume = caption.get("resume") or {}
    if needs and resume.get("ok") and needs["kind"] not in ("captcha", "blocked"):  # a rehearsal paused mid-form: Lisul fixes the page, and Resume goes on
        needs["then"] = ("Nothing was sent. Fix it on the page (Fix here, or Open in Chrome), then press Resume: "
                         "Apply goes on from the page as you left it, and never presses Submit")
    if needs:
        tone, label, kind = "needs", needs["do"], needs["kind"]
        detail = f"{needs['why']}\n{needs['then']}" if needs["why"] else needs["then"]
    if tone == "failed":
        detail = "Nothing was sent. Apply keeps a note to fix this and tries again"
    if drafted := caption.get("drafted"):  # a line each, under the verdict, in the enlarged tile
        detail = "\n".join(filter(None, [detail, DRAFTED, *drafted]))
    shown = {"tone": tone, "label": label, "detail": detail}
    if kind:
        shown["kind"] = kind
    if tone == "filling" and detail:
        shown["doing"] = detail  # its banner says it, small too
    shown |= needs
    if flags and needs.get("kind") == "check":
        shown["flags"] = [{"field": f.get("field") or "", "why": f["why"]} for f in flags]
    if verified:
        shown["verified"] = True
    if notes := [f for f in verification.get("flags") or [] if not f.get("holds")]:
        shown["notes"] = [f"{f['field']}: {f['why']}" if f.get("field") else f["why"] for f in notes]
    if tone == "failed" and error:
        shown["error"] = error  # behind Details in the enlarged tile
    if system:
        shown["system"] = system
    # Paused; or filling, and stuck or waiting (apply.stuck); or ruled out, and his to fill anyway (its label says so).
    if resume and (needs or tone == "filling" or status in ("not eligible", "closed")):
        shown["resume"] = {"ok": bool(resume.get("ok")), "why": str(resume.get("why") or "")} \
            | ({"label": str(resume["label"])} if resume.get("label") else {})
    if history := caption.get("history"):  # each pause and Resume, under the verdict
        shown["detail"] = "\n".join(filter(None, [shown["detail"], *history]))
    return shown


def summary(tiles: list[dict], items: list[dict] | None = None) -> str:
    """One line on the run, what went out first, then what waits on Lisul:
    "nothing sent yet · 1 needs you · 1 filling · 4 filled, not sent". With
    `items` (every Application this run ended), the ended ones are counted
    from them, so one stays counted once its Worker moves on; else from the tiles."""
    words = {"needs": "needs you", "filling": "filling", "verifying": "verifying", "ready": "filled, not sent", "failed": "couldn't finish",
             "ended": "skipped"}
    ended = [t for t in tiles if t["tone"] in ("filling", "verifying")] + items if items is not None else tiles
    counts = Counter(words[t["tone"]] for t in ended if t["tone"] in words)
    parts = [f"{counts[w]} {'need you' if w == 'needs you' and counts[w] > 1 else w}" for w in words.values() if counts[w]]
    sent = sum(t["tone"] == "submitted" for t in ended)
    return " · ".join([f"{sent} sent" if sent else "nothing sent yet", *parts])


class Frames(Protocol):
    """A Worker's frames, input and file requests. A plain Worker's source (apply.plain.tile.PortFrames) also takes
    `tab=` on frame, wait, input, chooser and forget_chooser: that one form's tab of the Worker, never another (KAN-717)."""

    def frame(self, worker: int) -> bytes | None:
        """Worker `worker`'s page, as a JPEG, the latest taken; None before any."""
        ...

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        """Worker `worker`'s latest frame and its number, once one newer than
        number `after` comes (or `timeout` seconds pass: then the latest, maybe None)."""
        ...

    def input(self, worker: int, event: dict) -> dict | None:
        """Replay a mouse or key event on Worker `worker`'s page, at page coordinates:
        {"type": "down"|"up", x, y, button, clicks} | {"type": "move", x, y}
        | {"type": "wheel", x, y, dx, dy} | {"type": "key", key, modifiers}
        | {"type": "text", text}; or read the text selected on it, {"type": "copy"},
        which returns {"text": ...}. A press on a <select> returns {"menu": {options,
        selected}}, as headless Chrome draws no menu of its own, and
        {"type": "choose", index} picks that option of it. {"type": "files", paths}
        gives the file input that asked for a file (chooser) those files; no paths: none."""
        ...

    def chooser(self, worker: int) -> str | None:
        """Whether Worker `worker`'s page asked for a file ("selectSingle" or
        "selectMultiple"), till it is given one; headless Chrome shows no picker."""
        ...

    def field_error(self, worker: int) -> str:
        """The field error Worker `worker`'s page last showed (apply.stuck.FIELD_ERROR), "" for none."""
        ...


class Board(Protocol):
    """What the Orchestrator and a rehearsal tell the dashboard."""

    def update(self, worker: int, **caption: object) -> None:
        """Set some of Worker `worker`'s caption: company, role, job_system,
        posting_url, application_id, status, line; and once it ends, why (the
        reason, in full), essay (a Hold's essays, for Lisul to edit: essays.as_cell), choices (what each Missing fact offers to pick from,
        by question), and for a rehearsal filled and asked (fields) and missing
        (its Missing facts)."""
        ...

    def note(self, company: str, role: str, why: str, posting_url: str = "") -> None:
        """A Posting the run skipped without a Worker (an employer's limit, a
        Repost, the Daily cap), and why, for the window's History."""
        ...

    def run(self, **fields: object) -> None:
        """Set some of what the run as a whole is doing, for the window's status
        bar: mode ("run" or "rehearsal"), queued (Applications left to start),
        today and cap (Matches applied to today, and the Daily cap), capped and
        tomorrow (the Daily cap stopped it; how many wait), paused_until (an
        ISO time, at a usage limit; None once it goes on), start ("waiting":
        forms are still getting ready; "ready": the Start button is shown;
        "started"), unchecked (why Apply couldn't check WorkIt for jobs
        already applied to, KAN-621)."""
        ...

    def answered(self, worker: int) -> list[tuple[str, str]]:
        """Lisul's answers typed in the window to Worker `worker`'s rehearsed
        Missing facts since it last asked, (question, answer) each, for its
        open form to be filled with; each is given once."""
        ...

    def file_given(self, worker: int) -> None:
        """Claude gave Worker `worker`'s page the file it asked for, so the
        window stops asking Lisul for one."""
        ...

    def resumed(self, worker: int) -> bool:
        """Whether Lisul pressed Resume on Worker `worker`'s paused form since
        it last asked; each press is given once."""
        ...

    def fill_again_asked(self, worker: int) -> bool:
        """Whether Fill again was asked for tile `worker`'s held form from outside its page
        (`POST /fill-again`) since it last asked; each ask is given once."""
        ...

    def regenerations(self, worker: int) -> list[tuple[str, str]]:
        """The answers of Worker `worker`'s held form that Lisul asked in the
        window to have written again since it last asked, (question name, his
        context) each (apply.regenerate); each is given once."""
    def wanted(self, worker: int) -> list[tuple[str, Callable[[str], None]]]:
        """Each Go to question Lisul pressed for Worker `worker`'s held form since it last asked: the
        question, and where to say how it went ("" when the field is shown; else why not). Each is given once."""
        ...

    def typed(self, worker: int, questions: list[str], answer: str) -> str:
        """Lisul answered `questions` (a Missing fact, or each Essay fact of one essay) on Worker `worker`'s
        held form himself: save the answer as his answer in Needs you is, and ask them no more. Says how it went."""
        ...

    def asks(self, worker: int) -> list[dict]:
        """Each Ask Claude message (apply.ask) Lisul sent to Worker `worker`'s held form since it last asked,
        from the window or `apply ask`: {id, message, thread (the replies before it)}. Each is given once."""
        ...

    def replied(self, worker: int, ask_id: str, **reply: object) -> None:
        """How an Ask Claude message went (apply.ask.Reply.as_json), or `state="working"` while Claude works."""
        ...

    def wait_for_start(self, timeout: float | None) -> None:
        """Show the Start button and return once Lisul presses it, or after
        `timeout` seconds (None: however long he takes): a rehearsal for
        filming starts its fills on it."""
        ...


class NoBoard:
    """No dashboard: tests, and anything run without one."""

    def update(self, worker: int, **caption: object) -> None:
        pass

    def file_given(self, worker: int) -> None:
        pass

    def run(self, **fields: object) -> None:
        pass

    def wait_for_start(self, timeout: float) -> None:
        pass

    def note(self, company: str, role: str, why: str, posting_url: str = "") -> None:
        pass

    def answered(self, worker: int) -> list[tuple[str, str]]:
        return []

    def resumed(self, worker: int) -> bool:
        return False

    def fill_again_asked(self, worker: int) -> bool:
        return False

    def regenerations(self, worker: int) -> list[tuple[str, str]]:
        return []

    def wanted(self, worker: int) -> list[tuple[str, Callable[[str], None]]]:
        return []

    def typed(self, worker: int, questions: list[str], answer: str) -> str:
        return ""


class NoFrames:
    """No Worker's browser to show: the window with no run going, its Answers tab alone."""

    def frame(self, worker: int) -> bytes | None:
        return None

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        return None, after

    def input(self, worker: int, event: dict) -> dict | None:
        return None

    def chooser(self, worker: int) -> str | None:
        return None

    def field_error(self, worker: int) -> str:
        return ""


class Dashboard:
    """`answers`, when given, is what the window's Answers tab shows and edits.
    `applied`, when given, adds the Own application a link pasted at the top
    of that tab leads to, and says in one line how it went. `past`, when
    given, reads the Tracker's rows, once: the Inbox lists those still waiting
    on Lisul from runs gone by, and the window says what today's runs did.
    `tracker_url` links his Tracker; `sweep_at` is when the Daily sweep runs.
    `answer`, when given, saves his answer to an item's Missing fact typed in
    the Inbox (the item, the question, the answer) and says how it went.
    `notify`, when given, shows a macOS notification (title, message) of
    what newly waits on him while the window is not in front, one a minute at most.
    `show`, when given, brings Worker k's own Chrome window to the front (False:
    it has none), for what the tile cannot do: a sign-in, a captcha, a dialog.
    `quiet(k)`, when given, says Worker k is a plain Worker: Go to question then never
    brings its window forward (only Lisul's own Show does), and the tile shows the field.
    `sample`: Apply runs on the Test Person sample data, and the window says so.
    `remember`, when given, saves a fact Lisul stated to Ask Claude into his Answer bank (the question,
    the answer), on his own click of the offer in the tile, and says how it went.
    `approve`, when given, approves a Hold from the Inbox (its Application ID, and
    `essay=` the Essay cell with his edit of its essays' text if he edited them), as
    editing the Essay cell and ticking Approve did in the retired Tracker Sheet (KAN-544),
    and says how it went."""

    def __init__(self, workers: int, frames: Frames, answers: AnswersTab | None = None,
                 applied: Callable[[str], str] | None = None, now: Callable[[], datetime] = datetime.now,
                 past: Callable[[], list] | None = None, tracker_url: str = "", sweep_at: str | None = None,
                 answer: Callable[[dict, str, str], str] | None = None,
                 notify: Callable[[str, str], None] | None = None, show: Callable[[int], bool] | None = None,
                 sample: bool = False, approve: Callable[[str], str] | None = None,
                 everyday: Callable[[str], None] | None = None, accounts: "AccountsTab | None" = None,
                 quiet: Callable[[int], bool] | None = None, remember: Callable[[str, str], str] | None = None):
        self._workers = workers
        self._remember = remember
        # Ask Claude (apply.ask): each Application's thread, by its posting URL, and the messages waiting for its Worker.
        self._threads: dict[str, list[dict]] = {}
        self._to_ask: dict[int, list[dict]] = {}
        self._asked = 0
        # Tile k shows Worker _shown[k]: one tile per Worker at first, and one more for each link sent into a
        # Worker already running (`apply rehearse --into`, KAN-645), which shows that Worker's window.
        self._shown = list(range(workers))
        self._tile_tabs: dict[int, int] = {}  # tile -> the tab its form is on in its plain Worker (showing)
        self._into: Callable[[str, int], dict] | None = None  # takes a new link into a Worker (taking)
        quiet = quiet or (lambda k: False)
        self._quiet = lambda k: quiet(self.worker_of(k))
        self.accounts = accounts  # the Accounts tab: each Employer account, its password only in Keychain
        self._sample = sample
        self._frames = _Shown(frames, self)
        self.answers = answers
        self.applied = applied
        self._now = now
        self._past, self._read, self._reading = past, None, threading.Lock()  # the Tracker's rows, once read
        self._context = {"tracker_url": tracker_url, "sweep_at": sweep_at, "workers": workers, "answers": bool(answer),
                         "show": bool(show), "approve": bool(approve), "everyday": bool(everyday)}
        self.everyday = everyday  # opens a bot-blocked posting in Lisul's everyday Chrome, when he presses it
        self.approve = approve
        self._approved: set[str] = set()  # the Holds Lisul approved in the window, by item id
        self.show = (lambda k: show(self.worker_of(k))) if show else None
        self.answer = answer
        self._answered: dict[str, str] = {}  # each item's questions Lisul answered in the window, by "id|question"
        self._notify, self._told, self._told_at, self._telling = notify, set(), -NOTIFY_EVERY, None
        self._focused_at = -FOCUS_FRESH  # when a poll last said the window was in front
        self._captions: list[dict[str, object]] = [{} for _ in range(workers)]
        self._picked: list[list[dict]] = [[] for _ in range(workers)]  # files Lisul picked in each tile for its page
        # Every Application this run ended, newest last, kept after its Worker moves on: the Inbox and History.
        self._items: list[dict[str, object]] = []
        self._numbered = 0  # the last item's number, its id in the window
        self._run: dict[str, object] = {}  # what the run as a whole is doing (Board.run)
        self._lock = threading.Lock()
        handler = type("Handler", (_Handler,), {"dashboard": self})
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._server.daemon_threads = True  # an open stream never holds up the run's end
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"
        # Proof that an edit comes from the page itself: a page of another site
        # in Lisul's browser can send requests here, but never read this.
        self.token = secrets.token_urlsafe(24)
        self._loaded = 0.0  # when the window last loaded the page
        self._started = threading.Event()  # Lisul pressed Start
        self._to_fill: dict[int, list[tuple[str, str]]] = {}  # answers to fill on each Worker's open form (answered)
        self._resume: set[int] = set()  # the Workers whose paused form Lisul pressed Resume on (resumed)
        self._again: set[int] = set()  # the tiles whose held form was asked to fill again (fill_again_asked)
        self._redo: dict[int, list[tuple[str, str]]] = {}  # answers to write again on each Worker's form (regenerations)
        self._goto: dict[int, list[tuple[str, Callable[[str], None]]]] = {}  # Go to question presses, by Worker (wanted)

    def __enter__(self) -> Self:
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def worker_of(self, tile: int) -> int:
        """The Worker whose window tile `tile` shows."""
        return self._shown[tile] if 0 <= tile < len(self._shown) else tile

    def showing(self, tile: int, tab: int | None) -> None:
        """Tile `tile`'s form is on tab `tab` of its plain Worker (None: no tab of its own, or a CDP page): the
        tile shows that tab's frames and sends its input there, never another form's in the same Worker (KAN-717)."""
        with self._lock:
            if tab is None:
                self._tile_tabs.pop(tile, None)
            else:
                self._tile_tabs[tile] = tab

    def tab_of(self, tile: int) -> int | None:
        """The tab of its plain Worker that tile `tile`'s form is on, once `showing` said."""
        return self._tile_tabs.get(tile)

    def blind(self, tile: int) -> bool:
        """Whether tile `tile` shares its Worker with another tile (`--into`) and doesn't know its form's tab yet (its
        page still opening): it shows nothing and takes no input, since the Worker's shown tab may be another form's."""
        with self._lock:
            worker = self.worker_of(tile)
            return tile not in self._tile_tabs and sum(shown == worker for shown in self._shown) > 1

    def taking(self, into: Callable[[str, int], dict]) -> None:
        """`into(url, worker)` starts a new link in Worker `worker`'s running browser, with a tile of its own
        (add_tile), and says which: `apply rehearse --into` sends it through POST /rehearse."""
        self._into = into

    def aim(self, workers: list[int]) -> None:
        """Tile k shows Worker `workers[k]`: a reopened form's, whose profile holds its sign-in (KAN-720)."""
        with self._lock:
            self._shown[:len(workers)] = list(workers)

    def add_tile(self, worker: int) -> int:
        """One more tile, showing Worker `worker`'s window. Returns its number; the window reloads to show it."""
        with self._lock:
            self._captions.append({})
            self._picked.append([])
            self._shown.append(worker)
            self._workers += 1
            self._context["workers"] = self._workers
            return self._workers - 1

    def into(self, url: str, worker: int | None = None, application: str = "") -> dict:
        """A new link into the Worker that `application` (an Application ID on a tile) fills, else Worker
        `worker` (default the first). Raises Refused when this window takes no links, or names no such Worker."""
        if self._into is None:
            raise Refused("This window takes no new links: only a rehearsal's does.", 409)
        if application:
            with self._lock:
                tile = next((k for k, c in enumerate(self._captions) if c.get("application_id") == application), None)
            if tile is None:
                raise Refused(f"No tile in this window has the Application {application}.", 404)
            worker = self.worker_of(tile)
        worker = 0 if worker is None else worker
        if worker not in self._shown:
            raise Refused(f"This window has no Worker {worker + 1}.", 404)
        return self._into(url, worker)

    def __exit__(self, *exc) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self.accounts:
            self.accounts.close()  # a password copied less than a minute ago leaves the clipboard
        self._quit_window()  # its page has no server now: a window left open shows a dead run

    def _quit_window(self) -> None:
        """Quit the Chrome that shows this server's window, if one does."""
        profile = _OPENED.get(urlsplit(self.url).netloc)
        for pid, shown in _window_chromes(profile) if profile else []:
            if urlsplit(shown).netloc == urlsplit(self.url).netloc:
                _quit(pid)

    def closed(self) -> None:
        """The window's page went away. Unless it loads again within
        CLOSE_GRACE (a reload), its window closed: quit its Chrome, which on
        a Mac outlives its last window, so Apply leaves the Dock and
        whoever waits on window_open sees it closed."""
        gone = time.monotonic()

        def check() -> None:
            if self._loaded <= gone:
                self._quit_window()

        timer = threading.Timer(CLOSE_GRACE, check)
        timer.daemon = True
        timer.start()

    def file_given(self, worker: int) -> None:
        if forget := getattr(self._frames, "forget_chooser", None):
            forget(worker)

    def update(self, worker: int, **caption: object) -> None:
        """Set some of the tile's caption. An Application that ends (any status but filling, and paused,
        which goes on) is kept as an item, in place of one before for the same Posting."""
        if not 0 <= worker < self._workers:
            return
        with self._lock:
            now, tile = self._now(), self._captions[worker]
            if caption.get("status") == "filling" and tile.get("status") != "filling":
                tile.clear()  # the next Application: none of the last one's caption
                self._picked[worker] = []
            if "files" in caption:  # the plan's files, and each one Lisul picked in the tile too
                caption["files"] = list(caption["files"] or []) + [
                    f for f in self._picked[worker] if f not in (caption["files"] or [])]
            if caption.get("status") == "submitted":  # sent: its Missing facts and Essay facts ask him no more
                caption = caption | {"missing": [], "choices": {}, "required": {}, "where": {}}
            tile.update(caption)
            status = str(tile.get("status") or "")
            ended = "status" in caption and status not in ("", "filling", "paused")
            if ended:
                self._end(worker, dict(tile), now)
        if ended and self._notify:
            self._tell()

    def focused(self, front: bool) -> None:
        """The window's page says whether it is in front, with each poll."""
        if front:
            self._focused_at = time.monotonic()

    def _tell(self) -> None:
        """One notification of every item newly waiting on Lisul, unless the
        window is in front (he sees them); within a minute of the last, once that minute is up."""
        with self._lock:
            new = [i for i in self._items if i["id"] not in self._told and verdict(i)["tone"] == "needs"]
            if not new:
                return
            if time.monotonic() - self._focused_at < FOCUS_FRESH:
                self._told.update(i["id"] for i in new)
                return
            wait = self._told_at + NOTIFY_EVERY - time.monotonic()
            if wait > 0:
                if not self._telling:
                    self._telling = threading.Timer(wait, self._tell)
                    self._telling.daemon = True
                    self._telling.start()
                return
            self._telling, self._told_at = None, time.monotonic()
            self._told.update(i["id"] for i in new)
        names = ", ".join(f"{i.get('company') or 'one'} ({WORDS.get(verdict(i)['kind'], ('',))[0]})" for i in new)
        try:
            self._notify("Apply", f"{len(new)} application{'s need' if len(new) > 1 else ' needs'} you: {names}")
        except Exception:
            pass  # Notification Center unavailable: the window's title still counts them

    def run(self, **fields: object) -> None:
        with self._lock:
            self._run.update(fields)

    def wait_for_start(self, timeout: float | None) -> None:
        self.run(start="ready")
        self._started.wait(timeout)
        self.run(start="started")

    def answered(self, worker: int) -> list[tuple[str, str]]:
        with self._lock:
            return self._to_fill.pop(worker, [])

    def resumed(self, worker: int) -> bool:
        with self._lock:
            pressed = worker in self._resume
            self._resume.discard(worker)
            return pressed

    def fill_again_asked(self, worker: int) -> bool:
        with self._lock:
            asked = worker in self._again
            self._again.discard(worker)
            return asked

    def wanted(self, worker: int) -> list[tuple[str, Callable[[str], None]]]:
        with self._lock:
            return self._goto.pop(worker, [])

    def go_to(self, item: dict, question: str) -> tuple[str, bool]:
        """Lisul pressed Go to question on an item's question: its Worker's Chrome comes to the front (False:
        it has no window, so the tile shows it), and the held form scrolls to the field and focuses it.
        Raises Refused when the form doesn't answer within GO_TO_WAIT. Returns what to tell him, and the front."""
        k, said, told = item["worker"], [], threading.Event()
        with self._lock:
            held = 0 <= k < self._workers and self._captions[k].get("posting_url") == item.get("posting_url")
        if not held:
            raise Refused("Its form is closed: answer it here.", 409)
        front = bool(self.show and not self._quiet(k) and self.show(k))

        def reply(why: str) -> None:
            said.append(why)
            told.set()
        with self._lock:
            self._goto.setdefault(k, []).append((question, reply))
        if not told.wait(GO_TO_WAIT):
            with self._lock:
                self._goto[k] = [g for g in self._goto.get(k, []) if g[1] is not reply]
            raise Refused("The form didn't answer: Apply may be busy with it. Try again in a moment.", 409)
        return said[0] or "There it is: answer it on the form. Apply saves your answer once you leave the field.", front

    def typed(self, worker: int, questions: list[str], answer: str) -> str:
        item = next((i for i in self.state()["items"] if i.get("worker") == worker and not i.get("live")
                     and questions[0] in (i.get("questions") or _questions(i))), None)
        if item is None:
            return ""
        from apply.essays import (
            ASK,  # imported here: essays imports the adapters, which import this module
        )
        asked = questions[0] if len(questions) == 1 else ASK + "; ".join(q.removeprefix(ASK) for q in questions)
        message = self.answer(item, asked, answer) if self.answer else ""
        with self._lock:
            for question in questions:
                self._answered[f"{item['id']}|{question}"] = answer
                if item.get("posting_url"):
                    self._answered[f"{item['posting_url']}|{question}"] = answer
        print(f"Answered on the form, for {item.get('company') or 'an application'}: {asked} → {masked.sized(answer)}")
        return message

    def resume(self, key: str) -> str:
        """Lisul pressed Resume on an item (its id) or a tile ("tile-<k>"): its
        Worker goes on with the paused form. Raises Refused, with why, when it
        can't: its tab was closed, or the Worker has moved on."""
        state = self.state()
        if key.startswith("tile-") and key.removeprefix("tile-").isdigit():
            k = int(key.removeprefix("tile-"))
            shown = state["tiles"][k] if k < len(state["tiles"]) else {}
        else:
            item = next((i for i in state["items"] if str(i["id"]) == key), None)
            if item is None or not isinstance(item.get("worker"), int) or item["worker"] < 0:
                raise Refused("That application no longer waits for Resume.", 404)
            k, shown = item["worker"], item
        resume = shown.get("resume") or {}
        tile = state["tiles"][k] if 0 <= k < len(state["tiles"]) else {}
        if not resume:
            raise Refused("That application no longer waits for Resume.", 404)
        if not resume.get("ok"):
            raise Refused(resume.get("why") or TAB_CLOSED, 409)
        if tile.get("posting_url") != shown.get("posting_url") or not (tile.get("resume") or {}).get("ok"):
            raise Refused(TAB_CLOSED, 409)  # its Worker moved on, and the form's tab with it
        with self._lock:
            self._resume.add(k)
        if resume.get("label"):  # Fill it anyway, on a rehearsal that ruled him out
            return "Filling it anyway: Apply opens the form and fills it. It never presses Submit."
        return "Resuming: Apply reads the page as you left it and goes on. It never presses Submit."

    def fill_again(self, key: str) -> str:
        """Fill again on a tile's held form ("tile-<k>"), as the page's own button does. Raises Refused, with
        why, when no form is held for Lisul there: one still filling, one he submitted, or a tile with none."""
        k = int(key.removeprefix("tile-")) if key.startswith("tile-") and key.removeprefix("tile-").isdigit() else -1
        with self._lock:
            if not 0 <= k < self._workers:
                raise Refused("No such form.", 404)
            if not self._captions[k].get("askable"):  # a rehearsal's held page, until he presses Submit (rehearsal._Ask)
                raise Refused("That form isn't held for you now: Fill again works once Apply has stopped on it, "
                              "before Submit.", 409)
            self._again.add(k)
        return "Filling it again: Apply opens the form anew and fills it. It never presses Submit."

    def regenerations(self, worker: int) -> list[tuple[str, str]]:
        with self._lock:
            return self._redo.pop(worker, [])

    def regenerate(self, key: str, name: str, context: str) -> str:
        """Lisul pressed Regenerate on one answer Claude wrote (its question
        `name`), on an item (its id) or a tile ("tile-<k>"), with `context`:
        its Worker writes it again on the held form. Raises Refused, with why,
        when it can't: no context, an answer Claude did not write, or a form
        that is gone or filling again."""
        if not context.strip():
            raise Refused("Type what Claude should know or change first.", 400)
        state = self.state()
        if key.startswith("tile-") and key.removeprefix("tile-").isdigit():
            k = int(key.removeprefix("tile-"))
            shown = state["tiles"][k] if k < len(state["tiles"]) else {}
        else:
            item = next((i for i in state["items"] if str(i["id"]) == key), None)
            if item is None or not isinstance(item.get("worker"), int) or item["worker"] < 0:
                raise Refused("That form is no longer open: press Fill again on it, or rehearse it again.", 404)
            k, shown = item["worker"], item
        tile = state["tiles"][k] if 0 <= k < len(state["tiles"]) else {}
        if not any(w.get("name") == name for w in shown.get("written") or []):
            raise Refused("Claude did not write that answer on this form.", 404)
        if tile.get("posting_url") != shown.get("posting_url") or tile.get("status") in ("filling", "submitted"):
            raise Refused("That form is no longer open: press Fill again on it, or rehearse it again.", 409)
        if any(w.get("name") == name and w.get("state") == "working" for w in tile.get("written") or []):
            raise Refused("Claude is already rewriting that answer.", 409)
        with self._lock:
            self._redo.setdefault(k, []).append((name, context.strip()))
        return "Claude is writing that answer again with your context. It goes in the form's field; nothing is sent."

    def ask(self, key: str, message: str, via: str = "window") -> dict:
        """Lisul's Ask Claude message for a tile's form ("tile-<k>"), from the window or `apply ask` (`via`): its
        Worker hands it to Claude on the held page. Raises Refused, with why, when it can't: no message, a form
        not held for him, or one Claude still works on. Returns the thread entry: its `id` is polled for the reply."""
        if not message.strip():
            raise Refused("Type what Claude should fix first.", 400)
        if not (key.startswith("tile-") and key.removeprefix("tile-").isdigit()):
            raise Refused("No such form.", 404)
        k = int(key.removeprefix("tile-"))
        with self._lock:
            tile = self._captions[k] if 0 <= k < self._workers else {}
            if not tile.get("askable") or not tile.get("posting_url"):
                raise Refused("That form isn't held for you now: Ask Claude works once Apply has filled it and "
                              "stopped, before Submit.", 409)
            thread = self._threads.setdefault(str(tile["posting_url"]), [])
            if any(t.get("state") in ("waiting", "working") for t in thread):
                raise Refused("Claude is still working on your last message for this form.", 409)
            self._asked += 1
            entry = {"id": f"ask-{self._asked}", "worker": k, "message": message.strip()[:4000], "via": via,
                     "at": self._now().isoformat(timespec="seconds"), "state": "waiting",
                     "company": tile.get("company") or "", "role": tile.get("role") or ""}
            thread.append(entry)
            self._to_ask.setdefault(k, []).append({"id": entry["id"], "message": entry["message"],
                                                   "thread": [dict(t) for t in thread[:-1]]})
        print(f"Ask Claude ({via}), for {entry['company'] or key}: {masked.sized(entry['message'], 'message')}")
        return dict(entry)

    def asks(self, worker: int) -> list[dict]:
        with self._lock:
            return self._to_ask.pop(worker, [])

    def replied(self, worker: int, ask_id: str, **reply: object) -> None:
        with self._lock:
            for entry in (t for thread in self._threads.values() for t in thread if t["id"] == ask_id):
                entry.update(reply)

    def asked(self, ask_id: str) -> dict | None:
        """One Ask Claude entry, as its thread holds it now (`apply ask` waits on its state)."""
        with self._lock:
            return next((dict(t) for thread in self._threads.values() for t in thread if t["id"] == ask_id), None)

    def remember(self, ask_id: str, index: int) -> str:
        """Lisul pressed Save on a fact Claude offered from his message: it goes in his Answer bank as his own
        answer. Raises Refused when there is no such offer, or it was saved already."""
        with self._lock:
            entry = next((t for thread in self._threads.values() for t in thread if t["id"] == ask_id), None)
            offers = (entry or {}).get("offers") or []
            if not self._remember or not 0 <= index < len(offers):
                raise Refused("No such answer to save.", 404)
            offer = offers[index]
            if offer.get("saved"):
                raise Refused("You saved that answer already.", 409)
        said = self._remember(str(offer["question"]), str(offer["answer"]))
        with self._lock:
            offer["saved"] = True
        return said or f"Saved to your answers: {offer['question']} → {offer['answer']}"

    def start(self) -> None:
        """Lisul pressed Start."""
        self._started.set()

    def note(self, company: str, role: str, why: str, posting_url: str = "") -> None:
        with self._lock:
            self._end(-1, {"company": company, "role": role, "posting_url": posting_url, "status": "skipped",
                           "why": why}, self._now())

    def _end(self, worker: int, caption: dict, now: datetime) -> None:
        key = (caption.get("company"), caption.get("role"), caption.get("posting_url"))
        self._items = [i for i in self._items if (i.get("company"), i.get("role"), i.get("posting_url")) != key]
        self._numbered += 1
        self._items.append(caption | {"worker": worker, "at": now.isoformat(timespec="seconds"), "id": self._numbered})
        del self._items[:-MAX_ITEMS]

    def to_page_event(self, worker: int, event: dict) -> dict | None:
        """A tile's event as the Worker's page takes it: a mouse event's tile
        point (x, y in a w x h tile) made a page point; None if it misses the page."""
        kind = event.get("type")
        if kind == "text":
            return {"type": kind, "text": str(event.get("text", ""))}
        if kind == "key":
            modifiers = [m for m in event.get("modifiers") or [] if m in MODIFIERS]
            return {"type": kind, "key": str(event.get("key", ""))} | ({"modifiers": modifiers} if modifiers else {})
        if kind == "copy":
            return {"type": kind}
        if kind == "choose":
            return {"type": kind, "index": int(event.get("index", -1))}
        if kind == "files":
            return {"type": kind, "paths": [self._picked_file(worker, f["name"], base64.b64decode(f["data"]))
                                            for f in event.get("files", [])]}
        if kind not in ("down", "up", "move", "wheel"):
            return None
        size = jpeg_size(self._frames.frame(worker) or b"")
        # A button let go off the page still lets go, where the pointer left it.
        point = size and to_page(event["x"], event["y"], event["w"], event["h"], *size, clamp=kind == "up")
        if not point:
            return None
        mapped = {"type": kind, "x": point[0], "y": point[1]}
        if kind == "wheel":
            return mapped | {"dx": event.get("dx", 0), "dy": event.get("dy", 0)}
        if kind == "move":
            return mapped
        return mapped | {"button": event.get("button", "left"), "clicks": int(event.get("clicks") or 1)}

    def _picked_file(self, worker: int, name: str, data: bytes) -> str:
        """A file Lisul picked in the tile for its page, saved under its own name: with the
        Application's other files under SENT, and listed on the tile, once the tile names one."""
        from apply.worker import (
            keep_sent,  # imported here: the worker imports the adapters, which import this module
            sent_folder,
        )
        picked = Path(_saved(name, data))
        with self._lock:
            tile = self._captions[worker] if 0 <= worker < self._workers else {}
            company, application = str(tile.get("company") or ""), str(tile.get("application_id") or "")
        if not application:
            return str(picked)
        try:
            kept = keep_sent(sent_folder(company, application, self._now().date()), picked)
        except OSError:
            return str(picked)  # the page still gets its file; only the window's copy is missing
        given = {"label": PICKED, "name": kept.name, "path": str(kept)}
        with self._lock:
            self._picked[worker].append(given)
            self._captions[worker]["files"] = list(self._captions[worker].get("files") or []) + [given]
        return str(kept)

    def state(self) -> dict:
        """Every tile's caption with its verdict, every ended Application's
        (items, newest first), and the one-line summary of them all."""
        # Imported here: verify imports the fill engine, which imports this module.
        from apply import verify
        with self._lock:
            captions = [dict(caption) for caption in self._captions]
            items = [dict(item) for item in reversed(self._items)]
            run = dict(self._run)
        for k, caption in enumerate(captions):
            caption |= verify.without_dismissed(caption)  # a flag Lisul dismissed holds it no more
            if caption.get("status") == "filling" and not caption.get("verifying") and not caption.get("stage") \
                    and (why := stuck.why(caption, getattr(self._frames, "field_error", lambda k: "")(k), time.time())):
                caption["resume"] = {"ok": True, "why": why}  # stuck or waiting: Resume goes on from the page
            caption |= verdict(caption)
            with self._lock:  # Ask Claude's thread for the form the tile holds
                caption["thread"] = [dict(t) for t in self._threads.get(str(caption.get("posting_url") or ""), [])]
            if chooser := self._frames.chooser(k):
                caption["file"] = chooser
            if notice := getattr(self._frames, "notice", lambda k: "")(k):  # a plain tile without Screen Recording
                caption["capture"] = notice
        # A form still filling asks its Missing facts at once, before Claude has drafted the rest.
        items = [caption | {"status": ASKING, "worker": k, "id": f"live-{k}", "live": True}
                 for k, caption in enumerate(captions) if caption.get("status") == "filling" and caption.get("missing")] + items
        ours = {item.get("posting_url") for item in items}
        past, context = self._tracker()
        items += [item for item in past if item.get("posting_url") not in ours]
        with self._lock:
            answered, approved = dict(self._answered), set(self._approved)
        from apply.essays import (
            cell_texts,  # imported here: essays imports the adapters, which import this module
        )
        # A form that fills again (Resume, Fill again) waits on Lisul no more for how it stopped before.
        filling = {c.get("posting_url") for c in captions if c.get("tone") in ("filling", "verifying") and c.get("posting_url")}
        for item in items:
            item |= verify.without_dismissed(item)
            item |= verdict(item)
            if not item.get("live") and item.get("from") != "tracker" and item.get("posting_url") in filling:
                item["answered"] = True
            if item.get("kind") == "held":
                # Only each essay's text is his to edit: the heading and Plan lines stay in the cell (`essay`).
                item["essays"] = [{"question": q, "text": t} for q, t in cell_texts(str(item.get("essay") or ""))]
            if item.get("kind") in ("held", "check") and item["id"] in approved:
                item["answered"] = True  # approved here: it waits on Lisul no more
            if item.get("kind") == "missing fact":
                item["questions"] = [q for q in _questions(item) if f"{item['id']}|{q}" not in answered
                                     and not (item.get("posting_url") and f"{item['posting_url']}|{q}" in answered)]
                item["choices"] = {q: c for q, c in (item.get("choices") or {}).items() if q in item["questions"]}
                item["required"] = {q: r for q, r in (item.get("required") or {}).items() if q in item["questions"]}
                item["where"] = {q: w for q, w in (item.get("where") or {}).items() if q in item["questions"]}
                if not item["questions"]:
                    item["answered"] = True  # every question answered here: it waits on Lisul no more
        return {"summary": summary(captions, items if self._workers else None), "tiles": captions, "items": items,
                "context": self._context | context, "run": run}

    def _tracker(self) -> tuple[list[dict], dict]:
        """The Tracker's Applications still waiting on Lisul, as items, and what
        it says of today; read once. A Tracker that can't be read lists none."""
        with self._reading:  # never under self._lock: a Sheet read takes seconds, and Workers update meanwhile
            if self._read is None:
                try:
                    self._read = list(self._past()) if self._past else []
                except Exception:  # the Sheet unreachable: the window still shows this run
                    self._read = []
                    self._context["tracker_error"] = True
            rows = self._read
        today = self._now().date()
        waiting = [_waiting(row) for row in rows if _waits(row) or row.date_applied == today]  # and today's, for History
        sent = sum(str(row.status) == "submitted" and row.date_applied == today for row in rows)
        return waiting, {"rows": len(rows), "sent_today": sent}

    def page(self) -> str:
        columns, rows = grid(self._workers)
        tiles = "".join(
            f'<div class="tile" data-k="{k}"><div class="banner idle" id="banner-{k}"><span class="label">{IDLE}</span>'
            f'<span class="fields"></span></div><div class="caption" id="caption-{k}">Browser {self.worker_of(k) + 1}</div>'
            f'<div class="sent" id="sent-{k}" hidden></div>'
            f'<div class="capture" id="capture-{k}" hidden></div>'
            f'<div class="resumebar" id="resume-{k}" hidden><button class="primary">Resume</button>'
            f'<span class="why"></span></div>'
            f'<div class="askclaude" id="ask-{k}" hidden><div class="thread"></div><form><input maxlength="4000" '
            f'autocomplete="off" aria-label="Ask Claude"><button class="go tonal">Ask Claude</button></form></div>'
            f'<img id="frame-{k}" alt="Browser {self.worker_of(k) + 1}" tabindex="0" draggable="false">'
            f'<div class="hint">Open to look or type</div>'
            f'<div class="note">You\'re controlling this browser — Esc to return '
            f'<button onclick="control(null)">Back to all tiles</button>'
            f'<button class="chrome" onclick="openChrome({k})" hidden>Open in Chrome</button></div>'
            f'<div class="filebar" id="file-{k}" hidden>The page asks for a file: '
            f'<label><input type="file" hidden>Choose file…</label> <button>Not now</button></div>'
            f'<div class="detail" id="detail-{k}"></div></div>'
            for k in range(self._workers)
        ) or NO_RUN
        answers = ANSWERS.replace("{token}", self.token) if self.answers else ""
        history = HISTORY.replace("{applied}", APPLIED if self.applied and self.answers else "")
        return PAGE.replace("{columns}", str(columns)).replace("{rows}", str(rows)) \
            .replace("{workers}", str(self._workers)).replace("{tiles}", tiles) \
            .replace("{tabs}", TABS.replace("{answers_tab}", ANSWERS_TAB if self.answers else "")
                     .replace("{accounts_tab}", ACCOUNTS_TAB if self.accounts else "")
                     .replace("{sample}", SAMPLE if self._sample else "")) \
            .replace("{accounts}", ACCOUNTS if self.accounts else "") \
            .replace("{inbox}", INBOX.replace("{words}", json.dumps(WORDS))).replace("{closing}", self.token) \
            .replace("{answers}", answers).replace("{history}", history).replace("{style}", STYLE)


TAB_CLOSED = "The form's tab was closed: start it again"  # rehearsal.TAB_CLOSED: Resume can't go on
PICKED = "Picked in the window for its page"  # the label of a file Lisul gave a page that asked for one
SAMPLE = '<span id="sample" title="Apply is running as Test Person: put your own files in the data folder">Sample data</span>'
ANSWERS_TAB = '<button id="tab-answers" role="tab">Answers</button>'


def _questions(item: dict) -> list[str]:
    """The questions only Lisul can answer that an item asks: a rehearsal's
    Missing facts, or a run's one Missing fact (its reason without its context line)."""
    return list(item.get("missing") or []) or [_asked(str(item.get("why") or ""))[0]]


def _asked(why: str) -> tuple[str, str]:
    """(the question, its context line) of a Missing fact's reason: "Missing fact: <q>; In: <context>"."""
    asked, _, where = why.removeprefix("Missing fact: ").partition(f"; {IN}")
    return asked, where.split("; ")[0]


def _fills_in_place(item: dict, question: str) -> bool:
    """Whether Lisul's answer goes into the open form of the item's Worker:
    a rehearsed form's field (a run's Missing fact goes on from its Tracker
    row, and what an essay asked him is written into the essay next time)."""
    from apply.essays import (
        ASK,  # imported here: essays imports the adapters, which import this module
    )
    return item.get("from") != "tracker" and str(item.get("status")) != "missing fact" \
        and isinstance(item.get("worker"), int) and item["worker"] >= 0 and not question.startswith(ASK)


def on_form(item: dict) -> bool:
    """Whether an item's question is on a form still open in its Worker's browser, held for Lisul: a
    rehearsal's, ended or paused (a form still filling is Apply's to drive, and a run's Missing fact is a row)."""
    return item.get("from") != "tracker" and str(item.get("status")) != "missing fact" and not item.get("live") \
        and isinstance(item.get("worker"), int) and item["worker"] >= 0


def _waits(row) -> bool:
    """Whether a Tracker row's Application waits on Lisul: a Hold he hasn't
    approved, a Missing fact he hasn't answered, or a Handoff."""
    status = str(row.status)
    return (status == "held" and not row.approve) or (status == "missing fact" and not row.answer.strip()) \
        or status == "handoff"


def _waiting(row) -> dict:
    """A Tracker row waiting on Lisul, as the window's item for it."""
    why = f"Missing fact: {row.missing_fact}" if str(row.status) == "missing fact" and row.missing_fact else row.reason
    return {"company": row.company, "role": row.role, "posting_url": row.posting_url, "job_system": row.job_system,
            "application_id": row.application_id, "status": str(row.status), "why": one_line(why),
            "blocked": bot_signals.BLOCKED in {n.strip() for n in (row.bot_signals or "").partition(":")[2].split(",")},
            "record": row.record, "from": "tracker", "id": "t:" + row.application_id,
            "essay": row.essay if str(row.status) == "held" else "",
            "choices": {row.missing_fact: offered} if (offered := cell_options(row.missing_fact_options)) else {},
            "where": {row.missing_fact: where} if str(row.status) == "missing fact" and row.missing_fact
            and (where := _asked(row.reason)[1]) else {},
            "at": row.date_applied.isoformat() if row.date_applied else None}


def _saved(name: str, data: bytes) -> str:
    """A file Lisul picked in the window, saved where the Worker's Chrome can read it, under its own name."""
    path = Path(tempfile.mkdtemp(prefix="apply-file-")) / (Path(name).name or "file")
    path.write_bytes(data)
    return str(path)


class _Handler(BaseHTTPRequestHandler):
    dashboard: Dashboard

    def do_GET(self):
        path = urlsplit(self.path).path
        if not self._own_host():
            return self._json(403, {"error": "not this window's address"})
        if path == "/":
            self.dashboard._loaded = time.monotonic()
            return self._send(200, "text/html; charset=utf-8", self.dashboard.page().encode())
        if path == "/state":
            self.dashboard.focused(parse_qs(urlsplit(self.path).query).get("front") == ["1"])
            return self._send(200, "application/json", json.dumps(self.dashboard.state()).encode())
        if path == "/frames":
            return self._all_frames()
        if path == "/answers" and self.dashboard.answers:
            return self._json(200, self.dashboard.answers.view())
        if path == "/accounts" and self.dashboard.accounts:
            if not self._from_window():
                return self._json(403, {"error": "Only the Apply window may list your accounts."})
            return self._json(200, self.dashboard.accounts.view())
        if path.startswith("/ask/"):
            if not self._from_window():
                return self._json(403, {"error": "Only the Apply window and `apply ask` may read a thread."})
            entry = self.dashboard.asked(path.removeprefix("/ask/"))
            return self._json(200, entry) if entry else self._json(404, {"error": "No such message."})
        if path.startswith("/stream/"):
            return self._stream(int(path.removeprefix("/stream/")))
        if path.startswith("/file/"):
            return self._file(path)
        if path.startswith("/frame/"):
            frame = self.dashboard._frames.frame(int(path.removeprefix("/frame/")))
            return self._send(200, "image/jpeg", frame) if frame else self._send(204, "text/plain", b"")
        self._send(404, "text/plain", b"not found")

    def do_POST(self):
        parts = urlsplit(self.path)
        if not self._own_host():
            return self._json(403, {"error": "not this window's address"})
        if parts.path == "/closed":
            return self._closed()
        if parts.path == "/start":
            return self._start()
        if parts.path == "/applied" and self.dashboard.applied:
            return self._applied()
        if parts.path == "/answer" and self.dashboard.answer:
            return self._answer()
        if parts.path == "/approve" and self.dashboard.approve:
            return self._approve()
        if parts.path == "/dismiss":
            return self._dismiss()
        if parts.path == "/resume":
            return self._resume()
        if parts.path == "/fill-again":
            return self._fill_again()
        if parts.path == "/regenerate":
            return self._regenerate()
        if parts.path == "/goto":
            return self._go_to()
        if parts.path == "/rehearse":
            return self._rehearse()
        if parts.path == "/ask":
            return self._ask()
        if parts.path == "/ask/remember":
            return self._ask_remember()
        if parts.path == "/everyday" and self.dashboard.everyday:
            return self._everyday()
        if parts.path == "/accounts/copy" and self.dashboard.accounts:
            return self._account("copy a password", self.dashboard.accounts.copy)
        if parts.path == "/accounts/open" and self.dashboard.accounts:
            return self._account("open your Chrome", self.dashboard.accounts.open_sign_in)
        if parts.path.startswith("/show/") and self.dashboard.show:
            return self._show(parts.path.removeprefix("/show/"))
        if parts.path.startswith("/answers/") and self.dashboard.answers:
            return self._edit_answers(parts.path.removeprefix("/answers/"))
        if parts.path.startswith("/reveal/"):
            return self._reveal(parts.path)
        if parts.path.startswith("/input/"):
            # A press here counts as Lisul's own, so only the window itself may send one. The custom header also makes
            # a page's request preflight, which this server never answers.
            token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
            if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin != self.dashboard.url:
                return self._send(403, "text/plain", b"forbidden")
            worker = int(parts.path.removeprefix("/input/"))
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            event = self.dashboard.to_page_event(worker, body)
            reply = self.dashboard._frames.input(worker, event) if event else None
            if reply is not None:
                return self._send(200, "application/json", json.dumps(reply).encode())
            return self._send(204, "text/plain", b"")
        self._send(404, "text/plain", b"not found")

    def _listed(self, path: str) -> Path | None:
        """The file a tile lists at /file/k/i or /reveal/k/i, or an ended
        Application in History at /file/item/n/i, if it is there."""
        try:
            *kind, owner, index = path.split("/")[-3:]
            with self.dashboard._lock:
                if kind == ["item"]:
                    caption = next(i for i in self.dashboard._items if i["id"] == int(owner))
                else:
                    caption = self.dashboard._captions[int(owner)]
                listed = Path(caption["files"][int(index)]["path"])
        except (ValueError, IndexError, KeyError, TypeError, StopIteration):
            return None
        return listed if listed.is_file() else None

    def _file(self, path: str) -> None:
        """A file a tile lists, as it was sent, for the window to show."""
        listed = self._listed(path)
        if not listed:
            return self._send(404, "text/plain", b"not found")
        kind = {".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8"}.get(listed.suffix.lower(),
                                                                                     "application/octet-stream")
        self._send(200, kind, listed.read_bytes())

    def _reveal(self, path: str) -> None:
        """Show a file a tile lists in the Finder, asked by the page itself."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may open the Finder."})
        listed = self._listed(path)
        if not listed:
            return self._json(404, {"error": "That file is gone."})
        subprocess.run(["open", "-R", str(listed)], check=False)
        self._send(204, "text/plain", b"")

    def _from_window(self) -> bool:
        """Whether a request comes from the window's own page: its token, which no other site can read, and no
        other site's Origin."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        return hmac.compare_digest(token.encode(), self.dashboard.token.encode()) and origin in (None, self.dashboard.url)

    def _own_host(self) -> bool:
        """Whether the request names this server as it is: another site's name
        for 127.0.0.1 (DNS rebinding) must not read Lisul's answers."""
        return self.headers.get("Host") == self.dashboard.url.removeprefix("http://")

    def _closed(self) -> None:
        """The window's page went away: its window closed, or it is reloading."""
        token = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 1024))
        origin = self.headers.get("Origin")
        if not hmac.compare_digest(token, self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may say it closed."})
        self.dashboard.closed()
        self._send(204, "text/plain", b"")

    def _start(self) -> None:
        """The window's Start button: every form held for it starts filling."""
        token = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 1024))
        origin = self.headers.get("Origin")
        if not hmac.compare_digest(token, self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may press Start."})
        self.dashboard.start()
        self._send(204, "text/plain", b"")

    def _edit_answers(self, edit: str) -> None:
        """An edit from the Answers tab, made only for the page itself; the reply is the tab read again."""
        tab = self.dashboard.answers
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may change answers."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            return self._json(413, {"error": "That is too long to be an answer."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "Not JSON."})
        edits = {"bank/save": lambda: tab.save(body.get("question"), body.get("answer")),
                 "bank/add": lambda: tab.add(body.get("question"), body.get("answer")),
                 "bank/review": lambda: tab.review(body.get("question")),
                 "bank/delete": lambda: tab.delete(body.get("question")),
                 "answered/save": lambda: tab.save_answered(body.get("question"), body.get("answer")),
                 "stock/save": lambda: tab.save_stock(body.get("key"), body.get("answer")),
                 "stock/keep": lambda: tab.keep_stock(body.get("type"), body.get("company"), body.get("question"),
                                                      body.get("answer")),
                 "stock/type/save": lambda: tab.save_stock_type(body.get("type"), body.get("answer"))}
        if edit not in edits or not isinstance(body, dict):
            return self._json(404, {"error": "No such edit."})
        try:
            edits[edit]()
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        self._json(200, tab.view())

    def _show(self, worker: str) -> None:
        """Bring a Worker's own Chrome window to the front, asked by the page itself."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may open a browser."})
        if not worker.isdigit() or not 0 <= int(worker) < self.dashboard._workers:
            return self._json(404, {"error": "No such browser."})
        if not self.dashboard.show(int(worker)):
            return self._json(409, {"error": "That browser has no window to open: it runs headless, or it closed."})
        self._send(204, "text/plain", b"")

    def _answer(self) -> None:
        """Lisul's answer to a question only he can answer, typed in the Inbox by the page itself."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may answer for you."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_FILE:
            self.close_connection = True
            return self._json(413, {"error": "That is too big to be an answer."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            key, question, answer = str(body["id"]), str(body["question"]), str(body["answer"]).strip()
            upload = body.get("file") and (Path(str(body["file"]["name"])).name, base64.b64decode(body["file"]["data"]))
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not an answer."})
        item = next((i for i in self.dashboard.state()["items"] if str(i["id"]) == key), None)
        if item is None or question not in item.get("questions", []):
            return self._json(404, {"error": "That question is no longer waiting for you."})
        if upload:  # a file the form asks for: attached to this form only, not kept as a fact
            if not upload[0] or not _fills_in_place(item, question):
                return self._json(400, {"error": "Attach the file on the form itself."})
            folder = Path(tempfile.mkdtemp(prefix="apply-answer-"))
            (folder / upload[0]).write_bytes(upload[1])
            return self._in_place(item, key, question, folder / upload[0], f"Claude attaches {upload[0]} on the open form now.")
        if not answer:
            if (item.get("required") or {}).get(question) is not False:
                return self._json(400, {"error": "Write an answer."})
            # An optional question he has no answer to: left blank on this form, and not asked again here.
            return self._in_place(item, key, question, None, "Skipped: it's optional, so the form leaves it blank.")
        try:
            message = self.dashboard.answer(item, question, answer)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        except Exception as error:  # the Sheet: say so in the window, keep the draft
            return self._json(502, {"error": f"Not saved: {error}"})
        with self.dashboard._lock:
            self.dashboard._answered[f"{key}|{question}"] = answer
            if item.get("posting_url"):  # answered while its form filled: not asked again once it ends
                self.dashboard._answered[f"{item['posting_url']}|{question}"] = answer
            if _fills_in_place(item, question):
                self.dashboard._to_fill.setdefault(item["worker"], []).append((question, answer))
                message += " Claude fills it in on the open form now."
        print(f"Answered in the window, for {item.get('company') or 'an application'}: {question} → {masked.sized(answer)}")
        self._json(200, {"message": message})

    def _go_to(self) -> None:
        """Go to question, pressed on a Needs you card by the page itself: the held form shows the field."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may move a form."})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            key, question = str(body["id"]), str(body["question"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a question."})
        item = next((i for i in self.dashboard.state()["items"] if str(i["id"]) == key), None)
        if item is None or question not in item.get("questions", []):
            return self._json(404, {"error": "That question is no longer waiting for you."})
        if not on_form(item):
            return self._json(409, {"error": "Its form is closed: answer it here."})
        try:
            message, front = self.dashboard.go_to(item, question)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        self._json(200, {"message": message, "front": front})

    def _approve(self) -> None:
        """Lisul approves a Hold in the Inbox, from the page itself: it is sent at the next check, with
        the essays as he edited them in their boxes, if he did (`essays`: the text of each, in order).
        The cell is built here from the stored headings and Plan lines and his text (essays.with_texts),
        so an edit never loses an essay's heading; an empty essay is refused, with the reason."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may approve for you."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            return self._json(413, {"error": "That essay is too long."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            key, texts = str(body["id"]), body.get("essays")
            if texts is not None and not (isinstance(texts, list) and all(isinstance(t, str) for t in texts)):
                raise TypeError
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not an approval."})
        item = next((i for i in self.dashboard.state()["items"]
                     if str(i["id"]) == key and i.get("application_id")
                     and (i.get("kind") == "held" or (i.get("kind") == "check" and i.get("status") == "held")) and not i.get("answered")), None)
        if item is None:
            return self._json(404, {"error": "That application no longer waits for your approval."})
        from apply.essays import (
            with_texts,  # imported here: essays imports the adapters, which import this module
        )
        try:
            essay = None if texts is None else with_texts(str(item.get("essay") or ""), texts)
        except ValueError as refused:
            return self._json(400, {"error": str(refused)})
        try:
            # His edit of the essays, when he made one, is sent in place of Claude's.
            message = self.dashboard.approve(item["application_id"], **({"essay": essay} if essay is not None else {}))
        except Exception as error:  # the Tracker file: say so in the window
            return self._json(502, {"error": f"Not approved: {error}"})
        with self.dashboard._lock:
            self.dashboard._approved.add(key)
        print(f"Approved in the window: {item.get('company') or 'an application'}")
        self._json(200, {"message": message})

    def _dismiss(self) -> None:
        """Lisul dismisses one flag of an Application in the Inbox, from the page itself: it is kept for that
        Application (verify.dismiss), so it holds it no more, after a reload of the window or in a new run."""
        # Imported here: verify imports the fill engine, which imports this module.
        from apply import verify

        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may dismiss a flag."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key, field, why = str(body["id"]), str(body.get("field") or ""), str(body["why"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a flag."})
        item = next((i for i in self.dashboard.state()["items"] if str(i["id"]) == key and i.get("application_id")
                     and {"field": field, "why": why} in (i.get("flags") or [])), None)
        if item is None:
            return self._json(404, {"error": "That flag no longer needs you."})
        verify.dismiss(item["application_id"], field, why)
        print(f"Dismissed in the window, for {item.get('company') or 'an application'}: {field}: {masked.sized(why, 'reason')}")
        self._json(200, {"message": "Dismissed: it holds this application no more."})

    def _resume(self) -> None:
        """Lisul pressed Resume on a paused form, from the page itself: its Worker goes on with it."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may resume a form."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key = str(body["id"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a Resume."})
        try:
            message = self.dashboard.resume(key)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        print(f"Resume pressed in the window ({key})")
        self._json(200, {"message": message})

    def _fill_again(self) -> None:
        """Fill again on a held form, from a process that read the window's token from its 0600 file
        (`apply fill-again`), or from the page itself. Body {"id": "tile-<k>"}."""
        if not self._from_window():
            return self._json(403, {"error": "Only Apply may fill a form again."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key = str(body["id"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a Fill again."})
        try:
            message = self.dashboard.fill_again(key)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        print(f"Fill again asked ({key})")
        self._json(200, {"message": message})

    def _rehearse(self) -> None:
        """A new link for a running Worker (`apply rehearse --into`): from a process that read the window's
        token from its 0600 file, or from the page itself. Body {url, worker?, application?}."""
        if not self._from_window():
            return self._json(403, {"error": "Only Apply may send a link into this window."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            url, worker = str(body["url"]), body.get("worker")
            if worker is not None and not isinstance(worker, int):
                raise TypeError
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a link to rehearse."})
        try:
            taken = self.dashboard.into(url, worker, str(body.get("application") or ""))
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        print(f"Took {url} into Browser {taken['worker'] + 1} (tile {taken['tile'] + 1})")
        self._json(200, taken)

    def _regenerate(self) -> None:
        """Lisul pressed Regenerate on an answer Claude wrote, from the page itself, with his context."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may regenerate an answer."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key, name, context = str(body["id"]), str(body["name"]), str(body["context"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a regenerate."})
        try:
            message = self.dashboard.regenerate(key, name, context)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        print(f"Regenerate pressed in the window ({key})")
        self._json(200, {"message": message})

    def _ask(self) -> None:
        """Lisul's Ask Claude message, from the tile's box or `apply ask` (which has the window's token)."""
        if not self._from_window():
            return self._json(403, {"error": "Only the Apply window and `apply ask` may ask Claude."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key, message = str(body["id"]), str(body["message"])
            via = "terminal" if body.get("via") == "terminal" else "window"
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not a message."})
        try:
            entry = self.dashboard.ask(key, message, via)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        self._json(200, {"message": "Claude is on it. It never presses Submit.", "ask": entry})

    def _ask_remember(self) -> None:
        """Lisul pressed Save on a fact Claude offered: only from the window's own page (its token and its
        Origin, which a browser always sends on a POST), never from a terminal."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin != self.dashboard.url:
            return self._json(403, {"error": "Only your click in the Apply window saves an answer."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            ask_id, index = str(body["ask"]), int(body["index"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not an answer to save."})
        try:
            message = self.dashboard.remember(ask_id, index)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        self._json(200, {"message": message})

    def _everyday(self) -> None:
        """Lisul pressed Open in my Chrome on a bot block, from the page itself: its posting opens in his everyday
        Chrome (KAN-590). Only his press opens it, so a rehearsal never pops a window by itself."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may open your Chrome."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            key = str(body["id"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return self._json(400, {"error": "Not an item."})
        item = next((i for i in self.dashboard.state()["items"] if str(i["id"]) == key), None)
        if item is None or item.get("kind") != "blocked" or not item.get("posting_url"):
            return self._json(404, {"error": "That application no longer waits on your Chrome."})
        self.dashboard.everyday(str(item["posting_url"]))
        print(f"Opened {item['posting_url']} in your Chrome, as you asked in the window")
        self._json(200, {"message": f"Opened {item.get('company') or 'the posting'} in your Chrome: "
                                    "the extension fills it there."})

    def _account(self, does: str, press: Callable[[object], str]) -> None:
        """Lisul pressed Copy password or Open sign-in page on an account in the Accounts tab (KAN-591). A password
        goes only to the clipboard: the reply, and the line printed, never hold it."""
        if not self._from_window():
            return self._json(403, {"error": f"Only the Apply window may {does}."})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_BODY)) or b"{}")
            site = body["site"]
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"error": "Not an account."})
        try:
            message = press(site)
        except Refused as refused:
            return self._json(refused.status, {"error": str(refused)})
        print(f"Accounts tab, {site}: {message}")
        self._json(200, {"message": message})

    def _in_place(self, item: dict, key: str, question: str, answer: Path | None, message: str) -> None:
        """An answer for this form alone, not saved to his facts: a file to attach, or None for an
        optional question he skipped; either way it waits on him no more."""
        with self.dashboard._lock:
            self.dashboard._answered[f"{key}|{question}"] = str(answer or "")
            if item.get("posting_url"):
                self.dashboard._answered[f"{item['posting_url']}|{question}"] = str(answer or "")
            if isinstance(item.get("worker"), int) and item["worker"] >= 0:
                self.dashboard._to_fill.setdefault(item["worker"], []).append((question, answer))
        print(f"Answered in the window, for {item.get('company') or 'an application'}: {question} → {masked.sized(answer) if answer else 'skipped'}")
        self._json(200, {"message": message})

    def _applied(self) -> None:
        """A link pasted into the window, from the page itself: the Own application it leads to joins the Tracker."""
        token, origin = self.headers.get("X-Apply-Token") or "", self.headers.get("Origin")
        if not hmac.compare_digest(token.encode(), self.dashboard.token.encode()) or origin not in (None, self.dashboard.url):
            return self._json(403, {"error": "Only the Apply window may add to the Tracker."})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            return self._json(413, {"error": "That is too long to be a link."})
        try:
            url = (json.loads(self.rfile.read(length) or b"{}") or {}).get("url")
        except (ValueError, AttributeError):
            return self._json(400, {"error": "Not JSON."})
        if not isinstance(url, str) or not url.strip().startswith(("http://", "https://")):
            return self._json(400, {"error": "Paste a link that starts with https://."})
        try:
            message = self.dashboard.applied(url.strip())
        except Exception as error:  # the Sheet or Claude: say so in the window, keep serving
            return self._json(502, {"error": f"Nothing was added: {error}"})
        self._json(200, {"message": message})

    def _stream(self, worker: int) -> None:
        """Worker `worker`'s frames as they come, as MJPEG, until the tile goes away."""
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        seen = 0
        try:
            while True:
                frame, number = self.dashboard._frames.wait(worker, seen, 1.0)
                if frame is None or number == seen:
                    continue
                seen = number
                self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(frame)
                                 + frame + b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _all_frames(self) -> None:
        """Every Worker's frames as they come, on one connection, each as
        (worker, length) in two big-endian 32-bit words, then the JPEG."""
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        seen: dict[int, int] = {}
        try:
            while True:
                sent = False
                for worker in range(self.dashboard._workers):  # a tile added since (--into) streams too
                    seen.setdefault(worker, 0)
                    frame, number = self.dashboard._frames.wait(worker, seen[worker], 0)
                    if frame is not None and number != seen[worker]:
                        seen[worker] = number
                        self.wfile.write(struct.pack(">II", worker, len(frame)) + frame)
                        sent = True
                if sent:
                    self.wfile.flush()
                time.sleep(FRAME_GAP)  # every tile changing at once is still frames the window can draw
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, status: int, body: object) -> None:
        self._send(status, "application/json", json.dumps(body).encode())

    def _send(self, status: int, kind: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class _Shown:
    """The window's frame source by tile: tile k is Worker worker_of(k)'s frames and input, and, once the
    tile's form has a tab of its own in that Worker (tab_of, a plain Worker's), that tab's only (KAN-717).
    A tile that shares its Worker and has no tab yet (Dashboard.blind) gets nothing and sends nothing."""

    def __init__(self, frames: Frames, dashboard: Dashboard):
        self._frames, self._dashboard = frames, dashboard

    def _at(self, tile: int) -> tuple[int, dict]:
        tab = self._dashboard.tab_of(tile)
        return self._dashboard.worker_of(tile), ({} if tab is None else {"tab": tab})

    def frame(self, tile: int) -> bytes | None:
        if self._dashboard.blind(tile):
            return None
        worker, tab = self._at(tile)
        return self._frames.frame(worker, **tab)

    def wait(self, tile: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        if self._dashboard.blind(tile):
            time.sleep(timeout)
            return None, after
        worker, tab = self._at(tile)
        return self._frames.wait(worker, after, timeout, **tab)

    def input(self, tile: int, event: dict) -> dict | None:
        if self._dashboard.blind(tile):
            return None
        worker, tab = self._at(tile)
        return self._frames.input(worker, event, **tab)

    def chooser(self, tile: int) -> str | None:
        if self._dashboard.blind(tile):
            return None
        worker, tab = self._at(tile)
        return self._frames.chooser(worker, **tab)

    def forget_chooser(self, tile: int) -> None:
        if (forget := getattr(self._frames, "forget_chooser", None)) and not self._dashboard.blind(tile):
            worker, tab = self._at(tile)
            forget(worker, **tab)

    def __getattr__(self, name: str):  # field_error, notice: by tile too, where the source has them
        found = getattr(self._frames, name)
        return (lambda tile, *rest: found(self._dashboard.worker_of(tile), *rest)) if callable(found) else found


class CdpFrames:
    """Each Worker's page streamed live by Chrome's screencast, on a thread
    of its own over CDP; and a tile's clicks and keys replayed on it.
    `endpoint(k)` is where Worker k's Chrome listens, None while it is closed.
    A screencast sends a frame whenever the page changes, so a tile moves
    with the form, and it never competes with the Worker's own screenshots."""

    def __init__(self, workers: int, endpoint: Callable[[int], str | None]):
        self._workers = workers
        self._endpoint = endpoint
        self._frames: dict[int, tuple[bytes, int]] = {}  # worker -> (latest frame, its number)
        self._choosers: dict[int, dict] = {}  # worker -> the file chooser its page opened, till it has files
        self._errors: dict[int, tuple[str, float]] = {}  # worker -> the field error its page shows, and when read
        self._changed = threading.Condition()
        self._requests: queue.Queue[tuple[int, dict, queue.Queue | None]] = queue.Queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self) -> Self:
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join(5)

    def frame(self, worker: int) -> bytes | None:
        return self._frames.get(worker, (None, 0))[0]

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        with self._changed:
            self._changed.wait_for(lambda: self._frames.get(worker, (None, 0))[1] > after, timeout)
            return self._frames.get(worker, (None, 0))

    def input(self, worker: int, event: dict) -> dict | None:
        # Replayed on the frames thread, which owns the connections; a copy waits
        # for what it read, and a press to learn whether it opened a <select>.
        reply: queue.Queue | None = queue.Queue(1) if event["type"] in ("copy", "down") else None
        self._requests.put((worker, event, reply))
        if reply is None:
            return None
        try:
            return reply.get(timeout=5)
        except queue.Empty:
            return None

    def chooser(self, worker: int) -> str | None:
        return self._choosers.get(worker, {}).get("mode")

    def field_error(self, worker: int) -> str:
        return self._errors.get(worker, ("", 0.0))[0]

    def forget_chooser(self, worker: int) -> None:
        """The file its page asked for was given another way (Claude set the input itself)."""
        self._choosers.pop(worker, None)

    def _keep(self, worker: int, frame: bytes) -> None:
        with self._changed:
            self._frames[worker] = (frame, self._frames.get(worker, (None, 0))[1] + 1)
            self._changed.notify_all()

    def _run(self) -> None:
        # An error must never end this thread: every tile would freeze, and take no input, for good.
        # One in a turn starts the connections afresh; one in Playwright itself, Playwright afresh.
        while not self._stop.is_set():
            try:
                self._connected()
            except Exception:
                self._stop.wait(1)

    def _connected(self) -> None:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            watching: dict[int, _Watch] = {}
            while not self._stop.is_set():
                try:
                    self._turn(playwright, watching)
                except Exception:
                    watching.clear()  # connect again next turn, with a screencast anew
                    time.sleep(PUMP / 1000)

    def _turn(self, playwright, watching: dict) -> None:
        for worker in range(self._workers):
            self._follow(playwright, watching, worker)
            self._read_errors(watching, worker)
        self._replay(watching)
        pages = [w.page for w in watching.values() if w.page is not None and not w.page.is_closed()]
        try:
            if pages:
                pages[0].wait_for_timeout(PUMP)  # any call lets this thread's CDP events through
            else:
                time.sleep(PUMP / 1000)
        except Exception:
            time.sleep(PUMP / 1000)  # that page closed just now

    def _follow(self, playwright, watching: dict, worker: int) -> None:
        """Keep a screencast on Worker `worker`'s current page: connect when its
        Chrome opens anew, and move to a new tab or pop-up as it appears."""
        endpoint = self._endpoint(worker)
        watch = watching.get(worker)
        if endpoint is None:
            watching.pop(worker, None)
            return
        if watch is None or watch.endpoint != endpoint or not watch.browser.is_connected():
            try:
                watch = watching[worker] = _Watch(endpoint, playwright.chromium.connect_over_cdp(endpoint, timeout=5_000))
            except Exception:
                watching.pop(worker, None)
                return
        pages = [p for context in watch.browser.contexts for p in context.pages
                 if not p.url.startswith(("chrome:", "devtools:")) and not p.is_closed()]
        page = pages[-1] if pages else None
        if page is None or page is watch.page:
            return
        watch.page, watch.session = page, None
        self._choosers.pop(worker, None)
        try:
            session = page.context.new_cdp_session(page)

            def on_frame(event, session=session, worker=worker):
                try:
                    session.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})
                except Exception:
                    pass
                if is_view(event.get("metadata", {})):
                    self._keep(worker, base64.b64decode(event["data"]))

            session.on("Page.screencastFrame", on_frame)
            session.on("Page.fileChooserOpened", lambda event, worker=worker: self._choosers.__setitem__(worker, event))
            session.send("Page.enable")
            session.send("Page.setInterceptFileChooserDialog", {"enabled": True})
            session.send("Page.startScreencast", {"format": "jpeg", "quality": JPEG_QUALITY,
                                                  "maxWidth": 1280, "maxHeight": 800, "everyNthFrame": 1})
            watch.session = session
        except Exception:
            watch.page = None  # it closed under us; the next turn finds what replaced it

    def _read_errors(self, watching: dict, worker: int) -> None:
        """Read the field error Worker `worker`'s page shows, every ERRORS_EVERY s: seen
        on this thread's own connection, so also while the Worker waits (apply.stuck)."""
        watch = watching.get(worker)
        if watch is None or watch.page is None:
            self._errors.pop(worker, None)
            return
        if time.monotonic() - self._errors.get(worker, ("", -ERRORS_EVERY))[1] < ERRORS_EVERY:
            return
        self._errors[worker] = (stuck.field_error(watch.page), time.monotonic())

    def _replay(self, watching: dict) -> None:
        while not self._requests.empty():
            worker, event, reply = self._requests.get()
            watch = watching.get(worker)
            answer = None
            if event["type"] == "files":
                self._give(watch, worker, event["paths"])
            elif watch is not None and watch.page is not None and not watch.page.is_closed():
                try:
                    answer = _dispatch(watch.page, event)
                except Exception:
                    pass  # the page went away under it, or Playwright knows no such key
            if reply is not None:
                reply.put(answer)


    def _give(self, watch, worker: int, paths: list[str]) -> None:
        """Answer the file chooser Worker `worker`'s page opened with `paths` (none: let it go)."""
        chooser = self._choosers.pop(worker, None)
        if chooser and paths and watch is not None and watch.session is not None:
            try:
                watch.session.send("DOM.setFileInputFiles", {"files": paths, "backendNodeId": chooser["backendNodeId"]})
            except Exception:
                pass  # the page went away under it


class _Watch:
    """The dashboard's connection to one Worker's Chrome, and the page it streams."""

    def __init__(self, endpoint: str, browser):
        self.endpoint = endpoint
        self.browser = browser
        self.page = None
        self.session = None


# The text selected on the page: in the controlled field, else on the page itself.
SELECTED = """() => {
  let doc = document;
  while (doc.activeElement && /^I?FRAME$/.test(doc.activeElement.tagName)) {
    try { doc = doc.activeElement.contentDocument; } catch (e) { doc = null; }
    if (!doc) return '';
  }
  const field = doc.activeElement;
  try {
    if (field && typeof field.selectionStart === 'number') return field.value.slice(field.selectionStart, field.selectionEnd);
  } catch (e) {}
  return String(doc.getSelection());
}"""

# The <select> under a press, if any, kept for CHOOSE: its options, for the tile's own menu.
PRESSED_SELECT = """([x, y]) => {
  let doc = document, at = doc.elementFromPoint(x, y);
  while (at && /^I?FRAME$/.test(at.tagName)) {
    const box = at.getBoundingClientRect();
    try { doc = at.contentDocument; } catch (e) { doc = null; }
    if (!doc) return null;
    x -= box.left; y -= box.top;
    at = doc.elementFromPoint(x, y);
  }
  const select = at && at.closest('select');
  if (!select || select.disabled || select.multiple || select.size > 1) return null;
  window[Symbol.for('apply.select')] = select;
  return {options: [...select.options].map(o => ({label: o.label, disabled: o.disabled})), selected: select.selectedIndex};
}"""
CHOOSE = """(index) => {
  const select = window[Symbol.for('apply.select')];
  if (!select || !select.isConnected) return false;
  select.focus();
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', {bubbles: true}));
  select.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
}"""


def _dispatch(page, event: dict) -> dict | None:
    """Replay one tile event on the page, with Playwright's own mouse and
    keyboard (its key codes, and macOS's editing commands for Cmd+A and the like)."""
    kind, mouse, keyboard = event["type"], page.mouse, page.keyboard
    if kind in ("down", "up", "move", "wheel"):
        mouse.move(event["x"], event["y"])
    if kind == "down":
        mouse.down(button=event["button"], click_count=event["clicks"])
        menu = page.evaluate(PRESSED_SELECT, [event["x"], event["y"]]) if event["button"] == "left" else None
        return {"menu": menu} if menu else None
    elif kind == "up":
        mouse.up(button=event["button"], click_count=event["clicks"])
    elif kind == "wheel":
        mouse.wheel(event["dx"], event["dy"])
    elif kind == "text" and len(event["text"]) == 1:
        keyboard.type(event["text"])  # a key press, which a field's own key handlers see
    elif kind == "text":
        keyboard.insert_text(event["text"])  # a paste
    elif kind == "key":
        keyboard.press("+".join([*event.get("modifiers", []), event["key"]]))
    elif kind == "copy":
        return {"text": page.evaluate(SELECTED)}
    elif kind == "choose":
        page.evaluate(CHOOSE, event["index"])
    return None


def open_window(url: str, profile: Path, front: bool = True) -> None:
    """Open the dashboard as a Chrome app window, in a plain profile of its
    own (never a Worker profile), as the Apply app in the Dock (dock_app),
    and bring it to the front; or, not `front` (a run starting while Lisul
    works in another app), leave it behind his app till he clicks Apply.

    Only one Chrome may use a profile: when one already shows this server's
    window it is brought forward, not launched again; one left showing an
    older server's window (a run gone by) is quit first."""
    profile.mkdir(parents=True, exist_ok=True)
    _OPENED[urlsplit(url).netloc] = profile
    for pid, shown in _window_chromes(profile):
        if urlsplit(shown).netloc == urlsplit(url).netloc:
            if front:
                raise_window(profile)
            return
        _quit(pid)
    app = dock_app.install(profile.parent, dock_app.bundle_for(profile.parent))
    # The DevTools port lets the window's keeper (dock_app.keep) see its tabs (its port goes in the profile).
    command = ["open", "-na", str(app), "--args", f"--app={url}", f"--user-data-dir={profile}", "--remote-debugging-port=0"]
    if front:
        subprocess.run(command, check=False)
        raise_window(profile)
    else:
        with KEEPER.launching():
            subprocess.run(command, check=False)
            for pid in _launched(profile):
                KEEPER.watch(pid, seconds=BEHIND_FOR)  # Chrome comes forward a moment after it starts, too


def _launched(profile: Path, timeout: float = 10.0) -> list[int]:
    """The pids of the Chrome showing the window in `profile`, once it has started."""
    deadline = time.monotonic() + timeout
    while not (pids := [pid for pid, _ in _window_chromes(profile)]) and time.monotonic() < deadline:
        time.sleep(0.1)
    return pids


# The window profile each of this process's servers was opened in, by its address.
_OPENED: dict[str, Path] = {}


def _window_chromes(profile: Path) -> list[tuple[int, str]]:
    """Each Chrome (pid, the URL its window opened on) running the window in `profile`:
    Chrome itself, not the `open` command that launched it with the same arguments."""
    found = subprocess.run(["pgrep", "-lf", f"MacOS/Google Chrome --app=.*--user-data-dir={profile}"],
                           capture_output=True, text=True, check=False)
    chromes = []
    for line in found.stdout.splitlines():
        pid, _, command = line.partition(" ")
        app = next((a.removeprefix("--app=") for a in command.split(" ") if a.startswith("--app=")), "")
        if pid.isdigit():
            chromes.append((int(pid), app))
    return chromes


def _quit(pid: int, timeout: float = 10.0) -> None:
    """Quit the window's Chrome as Cmd-Q would, and wait for it to be gone."""
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)


def window_open(profile: Path) -> bool:
    """Whether the window opened in `profile` is still open."""
    found = subprocess.run(["pgrep", "-f", f"MacOS/Google Chrome --app=.*--user-data-dir={profile}"],
                           capture_output=True, text=True, check=False)
    return bool(found.stdout.split())


def raise_window(profile: Path, timeout: float = 10.0) -> bool:
    """Bring the dashboard window in front of every other window.

    It is a Chrome of its own, so Chrome's Dock icon finds Lisul's everyday
    Chrome, not this window, and a window opened behind others stays lost.
    """
    deadline = time.monotonic() + timeout
    while True:
        # Chrome itself, not the `open` command that launched it with the same arguments.
        found = subprocess.run(["pgrep", "-f", f"MacOS/Google Chrome --app=.*--user-data-dir={profile}"],
                               capture_output=True, text=True, check=False)
        for pid in found.stdout.split():
            script = (f'tell application "System Events" to tell (first process whose unix id is {pid})\n'
                      "if (count of windows) is 0 then return false\n"
                      "set frontmost to true\nreturn frontmost\nend tell")
            raised = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)
            if raised.stdout.strip() == "true":
                return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.25)
