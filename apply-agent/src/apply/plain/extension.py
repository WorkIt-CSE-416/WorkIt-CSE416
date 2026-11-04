"""The worker extension (apply-agent/worker-extension/): its ID, and the files `prepare` writes.

The extension is private, never on the Store, and separate from the WorkIt extension. Its ID
is fixed by manifest.json's `key`. `prepare` writes its generated files into vendor/:

- engine.js: the Fill engine bundle, copied from the extension submodule's build
  (fill_engine.ENGINE), the very file the WorkIt extension and Apply's CDP Workers load;
- engine.json: that bundle's version and sha256, which the extension reports in its hello;
- injected.js: Playwright's own injected script (playwright-core's injectedScriptSource,
  Apache-2.0), from the installed Python package's driver, wrapped to set
  `globalThis.__applyPW` in the extension's isolated world.
"""

import base64
import hashlib
import json
import shutil
import subprocess
from functools import cache
from pathlib import Path

from playwright._impl._driver import compute_driver_executable

from apply import fill_engine
from apply.home import CODE

EXTENSION_DIR = CODE / "worker-extension"
VENDOR = EXTENSION_DIR / "vendor"
HOST_NAME = "com.workit.apply_worker"

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


def prepare(vendor: Path = VENDOR) -> dict:
    """Write vendor/engine.js, engine.json and injected.js, each only when it changed.
    Returns the engine's identity."""
    fill_engine._built()
    vendor.mkdir(parents=True, exist_ok=True)
    identity = engine_identity()
    if not (vendor / "engine.js").exists() or _sha256(vendor / "engine.js") != identity["sha256"]:
        shutil.copyfile(fill_engine.ENGINE, vendor / "engine.js")
    _write(vendor / "engine.json", json.dumps(identity, indent=1) + "\n")
    bundle = _driver_bundle()
    source = subprocess.run([_node(), "-e", EXTRACT, str(bundle)], capture_output=True, text=True, check=True).stdout
    _write(vendor / "injected.js", "// Playwright's injected script (Apache-2.0), from the installed playwright package.\n"
           "(() => {\nif (globalThis.__applyPW) return;\nconst module = {};\n" + source +
           f"\nglobalThis.__applyPW = new (module.exports.InjectedScript())(globalThis, {json.dumps(INJECTED_OPTIONS)});\n}})();\n")
    return identity


def _write(path: Path, text: str) -> None:
    if not path.exists() or path.read_text() != text:
        path.write_text(text)
