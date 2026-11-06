"""The worker extension (apply-agent/worker-extension/): its ID, and the files `prepare` writes.

The extension is private, never on the Store, and separate from the WorkIt extension. Its ID
is fixed by manifest.json's `key`. `prepare` writes its generated files into vendor/:

- engine.js: the Fill engine bundle, copied from the extension submodule's build
  (fill_engine.ENGINE), the very file the WorkIt extension and Apply's CDP Workers load;
- engine.json: that bundle's version and sha256, which the extension reports in its hello;
- injected.js: Playwright's own injected script (playwright-core's injectedScriptSource,
  Apache-2.0), from the installed Python package's driver, wrapped to set
  `globalThis.__applyPW` in the extension's isolated world;
- guards/*.js: the submit and drive guards' scripts (apply.plain.guards), which the extension
  registers as content scripts and refuses when their sha256 isn't Apply's;
- fixed.js: Apply's fixed page functions (apply.plain.fixed: Needs you's field, Resume's field
  error, the emailed code's boxes), which `fixed.call` runs with no eval (KAN-611).

The same files also go, write-once, into a set of their own: vendor/sets/<id>/, <id> a hash of
their bytes (`vendor_set`, KAN-645). The launcher writes the set into the folder the Worker
really loads the extension from (`loaded_folder`: the seed's Load unpacked folder, which may be
another checkout's), and names it in the welcome; the extension then reads every generated file
from there (ops/shared.js: vendor). A set is never changed or replaced, so an Apply process on
another engine, with Workers of its own on the same folder, keeps its own set, and no Worker is
refused for an engine another checkout prepared.

Workers load no checkout at all: each profiles folder has its own copy of the extension,
APPLY_PROFILES/worker-extension/ (`install`), which the seed's Load unpacked registers and Chrome
for Testing's --load-extension names. Apply replaces that copy only while none of that folder's
Workers runs (one Apply process drives a profiles folder, KAN-634), so a `git pull` in any checkout,
or an Apply on newer code, never changes the code of a Worker that is running: Chrome restarts an
MV3 service worker from disk, so a shared folder would (KAN-645).
"""

import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from functools import cache
from pathlib import Path

from playwright._impl._driver import compute_driver_executable

from apply import fill_engine
from apply.home import CODE
from apply.plain import fixed

EXTENSION_DIR = CODE / "worker-extension"
VENDOR = EXTENSION_DIR / "vendor"
HOST_NAME = "com.workit.apply_worker"
COPY = "worker-extension"  # APPLY_PROFILES/worker-extension/: the profiles folder's own copy (install)
STAMP = ".apply-code"  # in a copy: the code_hash of the code it holds
SETS = "sets"  # vendor/sets/<id>/: one write-once set of the generated files per Apply build
SET_DAYS = 7  # a set unused this long is removed when a new one is written
# The extension's own code: what `code_hash` reads to tell an extension running old code.
CODE_FILES = ("manifest.json", "background.js", "ops", "page")

# The injected script's options, as Playwright gives them for its utility world on Chromium.
INJECTED_OPTIONS = {"isUnderTest": False, "sdkLanguage": "python", "frameSeq": 0, "testIdAttributeName": "data-testid",
                    "stableRafCount": 1, "browserName": "chromium", "shouldPrependErrorPrefix": False,
                    "isUtilityWorld": True, "customEngines": []}
# Reads injectedScriptSource out of the driver's bundle: the string literal after its module marker.
EXTRACT = r"""const fs = require("fs");
const bundle = fs.readFileSync(process.argv[1], "utf8");
const at = bundle.indexOf('injectedScriptSource.ts"() {');
if (at < 0) throw new Error("no injectedScriptSource in " + process.argv[1]);
const start = bundle.indexOf("= '", at), end = bundle.indexOf("';\n", start);
process.stdout.write((0, eval)(bundle.slice(start + 2, end + 1)));"""
# The engine bundle's own version (FillEngine.version), read in Node.
VERSION = r"""const vm = require("vm"), fs = require("fs");
const context = vm.createContext({URL});
vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), context);
process.stdout.write(String(vm.runInContext("FillEngine.version", context)));"""


def extension_id(manifest: Path = EXTENSION_DIR / "manifest.json") -> str:
    """The ID Chrome gives the extension: the first 128 bits of the sha256 of its public key, as a-p."""
    key = base64.b64decode(json.loads(manifest.read_text())["key"])
    return "".join(chr(ord("a") + int(c, 16)) for c in hashlib.sha256(key).hexdigest()[:32])


EXTENSION_ID = extension_id()
EXTENSION_ORIGIN = f"chrome-extension://{EXTENSION_ID}/"


def engine_identity(engine: Path | None = None) -> dict:
    """The engine bundle's version and sha256, as the hello carries them."""
    engine = engine or fill_engine.ENGINE
    return {"version": _engine_version(engine, engine.stat().st_mtime_ns), "sha256": _sha256(engine)}


@cache
def _engine_version(engine: Path, _mtime: int) -> str:
    return subprocess.run([_node(), "-e", VERSION, str(engine)], capture_output=True, text=True, check=True).stdout


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _node() -> str:
    return compute_driver_executable()[0]


def _driver_bundle() -> Path:
    return Path(compute_driver_executable()[1]).parent / "lib" / "coreBundle.js"


def generated(identity: dict | None = None) -> dict[str, bytes]:
    """Each generated file's path under vendor/ and its bytes."""
    from apply.plain import guards

    fill_engine._built()
    identity = identity or engine_identity()
    bundle = _driver_bundle()
    source = subprocess.run([_node(), "-e", EXTRACT, str(bundle)], capture_output=True, text=True, check=True).stdout
    injected = ("// Playwright's injected script (Apache-2.0), from the installed playwright package.\n"
                "(() => {\nif (globalThis.__applyPW) return;\nconst module = {};\n" + source +
                f"\nglobalThis.__applyPW = new (module.exports.InjectedScript())(globalThis, {json.dumps(INJECTED_OPTIONS)});\n}})();\n")
    files = {"engine.js": fill_engine.ENGINE.read_bytes(), "engine.json": (json.dumps(identity, indent=1) + "\n").encode(),
             "injected.js": injected.encode(), "fixed.js": fixed.script().encode()}
    files |= {f"{guards.FOLDER}/{name}": text.encode() for name, text in guards.FILES.items()}
    return files


def prepare(vendor: Path = VENDOR) -> dict:
    """Write vendor/engine.js, engine.json, injected.js, fixed.js and guards/, each only when it changed.
    Returns the engine's identity."""
    identity = engine_identity()
    vendor.mkdir(parents=True, exist_ok=True)
    for name, data in generated(identity).items():
        path = vendor / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_bytes() != data:
            path.write_bytes(data)
    return identity


def set_id(files: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name in sorted(files):
        digest.update(name.encode() + b"\0" + hashlib.sha256(files[name]).digest())
    return digest.hexdigest()[:16]


def vendor_set(folder: Path, files: dict[str, bytes]) -> str:
    """`files` as the set vendor/sets/<id>/ of the extension folder `folder`, written once: a set that is
    there already is left as it is, and none is ever changed. Returns the set's root as the extension
    names it ("vendor/sets/<id>"). Sets unused for SET_DAYS go."""
    sets = folder / "vendor" / SETS
    sets.mkdir(parents=True, exist_ok=True)
    ident = set_id(files)
    done = sets / ident
    if not done.is_dir():
        building = Path(tempfile.mkdtemp(prefix=f".{ident}-", dir=sets))
        for name, data in files.items():
            (building / name).parent.mkdir(parents=True, exist_ok=True)
            (building / name).write_bytes(data)
        try:
            building.rename(done)  # whole or not at all: a Worker never reads half a set
        except OSError:  # another Apply wrote the same set first
            shutil.rmtree(building, ignore_errors=True)
    os.utime(done)  # in use: not old
    old = time.time() - SET_DAYS * 86400
    for other in sets.iterdir():
        try:
            if other != done and other.stat().st_mtime < old:
                shutil.rmtree(other, ignore_errors=True)
        except OSError:
            pass
    return f"vendor/{SETS}/{ident}"


def registration(profile: Path) -> dict | None:
    """The worker extension's entry in Chrome profile `profile`'s preference files, read only. None when
    neither file has one. Its `path` may name a folder that is gone."""
    for prefs in ("Secure Preferences", "Preferences"):
        try:
            settings = json.loads((profile / "Default" / prefs).read_text())["extensions"]["settings"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if isinstance(settings, dict) and isinstance(entry := settings.get(EXTENSION_ID), dict):
            return entry
    return None


def loaded_folder(profile: Path) -> Path | None:
    """The folder the worker extension is loaded from in Chrome profile `profile`: the path Load unpacked
    (or --load-extension) registered in its preferences. None when the profile has no such record."""
    for prefs in ("Secure Preferences", "Preferences"):
        try:
            settings = json.loads((profile / "Default" / prefs).read_text())["extensions"]["settings"]
            path = Path(settings[EXTENSION_ID]["path"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if path.is_absolute() and (path / "manifest.json").is_file():
            return path
    return None


def code_hash(folder: Path = EXTENSION_DIR) -> str:
    """A hash of the extension's own code in `folder` (not vendor/): it changes when the code on disk does."""
    digest = hashlib.sha256()
    for part in CODE_FILES:
        root = folder / part
        for path in sorted([root] if root.is_file() else root.rglob("*.js") if root.is_dir() else []):
            digest.update(str(path.relative_to(folder)).encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()[:16]


def install(dest: Path, files: dict[str, bytes], replace: bool, source: Path = EXTENSION_DIR) -> bool:
    """Make `dest` a copy of the extension in `source` (its code, the generated files and their vendor
    set), unless it holds that code already. A copy that holds other code is replaced only when
    `replace` (no Worker loads it now): whole, by a rename, its vendor sets kept. True when `dest`
    holds `source`'s code after."""
    code = code_hash(source)
    stamp = dest / STAMP
    held = stamp.read_text().strip() if stamp.is_file() else ""
    if held != code and (replace or not dest.exists()):
        dest.parent.mkdir(parents=True, exist_ok=True)
        building = Path(tempfile.mkdtemp(prefix=f".{dest.name}-", dir=dest.parent))
        for part in CODE_FILES:
            if (source / part).is_dir():
                shutil.copytree(source / part, building / part)
            elif (source / part).is_file():
                shutil.copy2(source / part, building / part)
        for name, data in files.items():  # the plain vendor/ files, for code that reads no set
            (building / "vendor" / name).parent.mkdir(parents=True, exist_ok=True)
            (building / "vendor" / name).write_bytes(data)
        if (dest / "vendor" / SETS).is_dir():
            shutil.copytree(dest / "vendor" / SETS, building / "vendor" / SETS)
        (building / STAMP).write_text(code + "\n")
        old = dest.with_name(f".{dest.name}-old-{os.getpid()}")
        if dest.exists():
            dest.rename(old)
        building.rename(dest)
        shutil.rmtree(old, ignore_errors=True)
        held = code
    if dest.exists():
        vendor_set(dest, files)
    return held == code


def guards_match(folder: Path) -> bool:
    """Whether `folder`'s plain vendor/guards/ files are this Apply's: code that reads no vendor set guards
    pages with those, and refuses any that differ."""
    from apply.plain import guards

    try:
        return all((folder / "vendor" / guards.FOLDER / name).read_text() == text for name, text in guards.FILES.items())
    except OSError:
        return False
