"""`apply rehearse --into <window> <url>...`: send a posting into a running Apply window (KAN-645).

Job sites keep their sign-in only for the browser's session, so a new Worker Chrome signs in again.
A link sent in is filled in the same running plain Worker, in a tab of its own, beside the forms open
there: Lisul signs in once per job site, not once per posting.

Each Apply window notes itself in APPLY_PROFILES/windows/ (apply.ask.register, mode 0600): its
address, the token its routes ask for (X-Apply-Token), and the PID of its process. `send` finds the
window by its port (`54321`, or `54321:2` for Browser 2) or by an Application ID one of its tiles shows,
and POSTs /rehearse there. The window's process does the rest, with the guards of any rehearsal: it
never submits.
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from apply import ask
from apply.browsers import WorkerBrowsers

ENDED = ("", "filling", "verifying")  # a tile's tone while its form is still being filled


class NoWindow(Exception):
    """No running Apply window matches what `--into` names, or it refused the link."""


def notes() -> Path:
    """Where the Apply windows of this profiles folder note themselves (apply.ask.register)."""
    return WorkerBrowsers().profiles / ask.WINDOWS


def windows(folder: Path | None = None) -> list[dict]:
    """Each Apply window still running, as noted; a note whose process is gone is removed."""
    found = []
    for path in sorted((folder or notes()).glob("*.json")):
        try:
            window = json.loads(path.read_text())
            os.kill(int(window["pid"]), 0)
        except ProcessLookupError:
            path.unlink(missing_ok=True)
            continue
        except (OSError, ValueError, KeyError, TypeError):
            continue
        found.append(window)
    return found


def _call(window: dict, path: str, body: dict | None = None, timeout: float = 30) -> dict:
    request = urllib.request.Request(window["url"] + path, method="POST" if body is not None else "GET",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"X-Apply-Token": window["token"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as answer:
            return json.loads(answer.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            said = json.loads(error.read()).get("error")
        except ValueError:
            said = ""
        raise NoWindow(said or f"the window answered {error.code}") from None
    except OSError as error:
        raise NoWindow(f"the window at {window['url']} doesn't answer ({error})") from None


def find(target: str, folder: Path | None = None) -> tuple[dict, dict]:
    """The window `target` names, and what to send it beside the link: a port (`54321`), a port and a
    Browser (`54321:2`), or an Application ID that one of its tiles shows."""
    running = windows(folder)
    port, _, browser = target.partition(":")
    if port.isdigit():
        window = next((w for w in running if urlsplit(w["url"]).port == int(port)), None)
        if window is None:
            raise NoWindow(f"no running Apply window on port {port} (in {folder or notes()})")
        if browser and not browser.isdigit():
            raise NoWindow(f"{target}: the Browser after the colon is its number, as its tile says")
        return window, {"worker": int(browser) - 1} if browser else {}
    for window in running:
        try:
            tiles = _call(window, "/state").get("tiles") or []
        except NoWindow:
            continue
        if any(t.get("application_id") == target for t in tiles):
            return window, {"application": target}
    raise NoWindow(f"no running Apply window has a tile for the Application {target}")


def send(target: str, url: str, folder: Path | None = None) -> tuple[dict, dict]:
    """Send `url` into the window `target` names. Returns the window and its answer {tile, worker}."""
    window, more = find(target, folder)
    return window, _call(window, "/rehearse", {"url": url, **more})


def fill_again(target: str, folder: Path | None = None) -> tuple[dict, int, dict]:
    """Fill again on the form `target` names: an Application ID on a tile, or a port whose window holds one
    form. Returns the window, the tile and the window's answer. `outcome` then waits for the new fill."""
    window, more = find(target, folder)
    if "worker" in more:
        raise NoWindow(f"{target}: name the window's port, or the form's Application ID")
    tiles = _call(window, "/state").get("tiles") or []
    held = [k for k, t in enumerate(tiles) if t.get("askable")
            and more.get("application") in (None, t.get("application_id"))]
    if len(held) > 1:
        named = ", ".join(str(tiles[k].get("application_id")) for k in held)
        raise NoWindow(f"that window holds {len(held)} forms; name one by its Application ID: {named}")
    if not held:
        raise NoWindow(f"{target}: no form is held for you there now")
    return window, held[0], _call(window, "/fill-again", {"id": f"tile-{held[0]}"})


def outcome(window: dict, tile: int, every: float = 2.0, since: float | None = None) -> dict:
    """Tile `tile`'s caption once its form stopped being filled (held, paused, handed off, failed)."""
    since = since or time.monotonic()
    seen_filling = False
    while True:
        tiles = _call(window, "/state").get("tiles") or []
        caption = tiles[tile] if tile < len(tiles) else {}
        tone = str(caption.get("tone") or "")
        seen_filling |= tone in ("filling", "verifying")
        if tone not in ENDED and (seen_filling or time.monotonic() - since > 30):
            return caption
        time.sleep(every)
