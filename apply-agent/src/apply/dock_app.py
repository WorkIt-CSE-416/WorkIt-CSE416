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

Generated, never committed: written again whenever Apply opens the window,
so it always points at the checkout and profiles that opened it last. Only
the main checkout writes ~/Applications/Apply.app; another worktree (a
scratch one, soon deleted) keeps a bundle of its own beside its profiles.
"""

import plistlib
import shlex
import subprocess
import sys
from pathlib import Path

APP = Path.home() / "Applications" / "Apply.app"
BUNDLE_ID = "local.apply.window"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
ICON = Path(__file__).with_name("Apply.icns")
# Beside the profiles: what `apply watch` printed when the Apply icon opened it.
LOG = "apply-window.log"

LAUNCHER = """#!/bin/sh
# Apply's window: Chrome on Apply's dashboard, under Apply's own name and icon in the Dock.
export APPLY_PROFILES={profiles}
case "$1" in
  --app=*) exec {chrome} "$@" ;;
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
