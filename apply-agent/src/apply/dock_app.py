"""The Apply window's own app on the Mac: ~/Applications/Apply.app.

The Apply window is a Chrome app window in a profile of its own. Opened as
Google Chrome, it showed in the Dock as a second Google Chrome icon that
looked just like Lisul's everyday Chrome, so he could not find it to bring
it forward or quit it. Opened through this small bundle, whose launcher
execs Chrome on the window, the Dock shows it as Apply, with Apply's icon:
a click brings the window forward, Quit closes it.

Opened with no window to show (the Apply icon kept in the Dock, or found in
Spotlight), the launcher runs `apply watch` from the checkout that last
opened the window, which opens the window of the run going, else the
Answers tab.

A click on Apply in the Dock while the window is open goes to its Chrome,
which counts no app window as a browser window and so opens a New Tab
window, every click. The launcher starts the window's keeper (`keep`) beside
its Chrome: it lives as long as that Chrome, whoever opened the window, and
closes each New Tab at once and brings the window forward instead. Kept in
the process that opened the window, it died with `apply watch` a moment
after the window opened, and from then on each click left a Chrome tab.

Generated, never committed: written again whenever Apply opens the window,
so it always points at the checkout and profiles that opened it last. Only
the main checkout writes ~/Applications/Apply.app; another worktree (a
scratch one, soon deleted) keeps a bundle of its own beside its profiles.
"""

import json
import os
import plistlib
import shlex
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

APP = Path.home() / "Applications" / "Apply.app"
BUNDLE_ID = "local.apply.window"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
ICON = Path(__file__).with_name("Apply.icns")
# Beside the profiles: what `apply watch` printed when the Apply icon opened it.
LOG = "apply-window.log"
# How often the window's keeper looks for a New Tab a Dock click opened: soon enough that it is barely seen.
KEEP_EVERY = 0.05
# The pages a Dock click opens in the window's Chrome.
NEW_TAB = ("chrome://newtab", "chrome://new-tab-page", "chrome-search://")

LAUNCHER = """#!/bin/sh
# Apply's window: Chrome on Apply's dashboard, under Apply's own name and icon in the Dock.
export APPLY_PROFILES={profiles}
case "$1" in
  --app=*)
    # The window's keeper, beside its Chrome (this very process once exec'd) till it quits.
    for arg in "$@"; do case "$arg" in --user-data-dir=*) profile="${{arg#--user-data-dir=}}" ;; esac; done
    {python} -m apply.dock_app "$$" "$profile" >> {log} 2>&1 &
    exec {chrome} "$@" ;;
esac
# Opened with no window to show: `apply watch` opens the window of the run going, else the Answers tab.
cd / && nohup {python} -m apply.cli watch >> {log} 2>&1 &
"""


def bundle_for(profiles: Path, checkout: Path = Path(__file__).resolve().parents[3]) -> Path:
    """Where the bundle for `profiles` goes: APP for the repository's main
    checkout, else beside the profiles of the worktree that opened it."""
    def git(*args: str) -> str:
        found = subprocess.run(["git", "-C", str(checkout), "rev-parse", *args], capture_output=True, text=True)
        return found.stdout.strip()

    git_dir, common = git("--absolute-git-dir"), git("--path-format=absolute", "--git-common-dir")
    return APP if git_dir and Path(git_dir).resolve() == Path(common).resolve() else profiles / "Apply.app"


def install(profiles: Path, app: Path | None = None, chrome: Path = CHROME, python: Path | str = sys.executable) -> Path:
    """Write the bundle at `app` (else APP) if it differs, launching `chrome` on a
    window, and `python -m apply.cli watch` over `profiles` when opened bare."""
    app = app or APP
    info = {
        "CFBundleName": "Apply",
        "CFBundleDisplayName": "Apply",
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleExecutable": "Apply",
        "CFBundleIconFile": "Apply",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "NSHighResolutionCapable": True,
        # A script launches under Rosetta unless the bundle asks for arm64; Chrome then hangs translating.
        "LSArchitecturePriority": ["arm64", "x86_64"],
    }
    launcher = LAUNCHER.format(profiles=shlex.quote(str(profiles)), chrome=shlex.quote(str(chrome)),
                               python=shlex.quote(str(python)), log=shlex.quote(str(profiles / LOG)))
    files = {
        app / "Contents" / "Info.plist": plistlib.dumps(info),
        app / "Contents" / "MacOS" / "Apply": launcher.encode(),
        app / "Contents" / "Resources" / "Apply.icns": ICON.read_bytes(),
    }
    profiles.mkdir(parents=True, exist_ok=True)
    changed = False
    for path, content in files.items():
        if not path.exists() or path.read_bytes() != content:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            changed = True
    (app / "Contents" / "MacOS" / "Apply").chmod(0o755)
    if changed:
        app.touch()  # a newer bundle, so Launch Services reads its name and icon again
    return app


def keep(pid: int, profile: Path, every: float = KEEP_EVERY) -> None:
    """While the window's Chrome `pid` runs: close each New Tab window a Dock
    click opens in it, and bring the window forward in its place."""
    ours = None  # the DevTools port of `pid`'s own Chrome, once checked
    while _alive(pid):
        try:
            port, browser = (profile / "DevToolsActivePort").read_text().split()[:2]
            # The port file outlives its Chrome: answer only the Chrome that wrote it, not one that took the port since.
            if ours != (port, browser) and _devtools(port, "version")["webSocketDebuggerUrl"].endswith(browser):
                ours = (port, browser)
            if ours == (port, browser):
                _close_new_tabs(port)
        except (OSError, ValueError, IndexError, KeyError):
            pass  # no DevTools port yet, or Chrome going
        time.sleep(every)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def _devtools(port: str, path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/{path}", timeout=2) as answer:
        body = answer.read()
    return json.loads(body) if path in ("version", "list") else body


def _close_new_tabs(port: str) -> None:
    pages = [p for p in _devtools(port, "list") if p.get("type") == "page"]
    stray = [p["id"] for p in pages if p.get("url", "").startswith(NEW_TAB)]
    for page in stray:
        _devtools(port, f"close/{page}")
    window = [p["id"] for p in pages if p["id"] not in stray]
    if stray and window:
        _devtools(port, f"activate/{window[0]}")  # unminimized and in front, as a click on Apply means


if __name__ == "__main__":  # the launcher, beside the window's Chrome: python -m apply.dock_app <pid> <profile>
    keep(int(sys.argv[1]), Path(sys.argv[2]))
