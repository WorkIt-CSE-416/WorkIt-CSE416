"""
Install Tectonic and warm its package cache into backend/vendor/tectonic/, so
the API compiles Jake's Resume offline (KAN-204, ADR 0002). Stdlib only: it
runs as Vercel's build command, before any dependency is installed.

    python3 scripts/fetch_tectonic.py           install and warm (Vercel, CI, laptops)
    python3 scripts/fetch_tectonic.py --check   compile once, offline, from the cache

On Linux x86_64 it downloads the pinned static build and refuses it unless
its SHA-256 matches. Elsewhere (a Mac) it uses the `tectonic` on PATH
(`brew install tectonic`). Warming compiles the fixed resume once with the
network on, which fetches every package and font file it uses (~40 MB).
"""

import argparse
import hashlib
import io
import platform
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "0.17.0"
ASSET = f"tectonic-{VERSION}-x86_64-unknown-linux-musl.tar.gz"
URL = f"https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{VERSION}/{ASSET}"
SHA256 = "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7"

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.resume_render import VENDOR, compile_pdf
from app.services.resume_render.sample import document


def install() -> None:
    binary = VENDOR / "tectonic"
    if binary.exists():
        return
    VENDOR.mkdir(parents=True, exist_ok=True)
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        if shutil.which("tectonic") is None:
            sys.exit("no tectonic on PATH: brew install tectonic")
        return  # the API falls back to the tectonic on PATH
    print(f"downloading {ASSET}")
    data = urllib.request.urlopen(URL, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        sys.exit("checksum mismatch: refusing to install tectonic")
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        binary.write_bytes(archive.extractfile("tectonic").read())
    binary.chmod(0o755)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="compile once, offline, from the cache")
    args = parser.parse_args(argv)
    cache = VENDOR / "cache"
    if not args.check:
        install()
        cache.mkdir(parents=True, exist_ok=True)
        compile_pdf(document(), cache=cache, offline=False)
    compile_pdf(document(), cache=cache, offline=True)
    size = sum(f.stat().st_size for f in VENDOR.rglob("*") if f.is_file()) / 1e6
    print(f"tectonic and its cache ready, offline compile ok: {VENDOR} ({size:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
