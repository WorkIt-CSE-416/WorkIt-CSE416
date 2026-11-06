"""
Install Tectonic and warm its package cache into backend/vendor/tectonic/, so
the API compiles Jake's Resume offline (KAN-204, ADR 0002). Stdlib only: it
runs as Vercel's build command, before any dependency is installed.

    python3 scripts/fetch_tectonic.py           install and warm (Vercel, CI, laptops)
    python3 scripts/fetch_tectonic.py --check   compile once, offline, from the cache

It downloads Tectonic's own pinned build for this computer (`BUILDS`: Linux
on x86_64 or ARM, macOS on Intel or Apple Silicon, Windows on x86_64) and
refuses it unless its SHA-256 matches. Only a system with no pinned build
uses the `tectonic` on PATH. Until 2026-11-05 only Linux downloaded; a Mac
needed `brew install tectonic` and Windows had no way at all, so every new
Windows worktree showed "This Resume Isn't Loading Right Now". Warming
compiles the fixed resume once with the network on, which fetches every
package and font file it uses (~40 MB).
"""

import argparse
import hashlib
import io
import platform
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

VERSION = "0.17.0"
RELEASE = f"https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{VERSION}/"
# (platform.system(), platform.machine()) -> (asset, SHA-256), from the
# release's own digests. Raising VERSION means new assets and digests here.
BUILDS = {
    ("Linux", "x86_64"): (
        f"tectonic-{VERSION}-x86_64-unknown-linux-musl.tar.gz",
        "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7",
    ),
    ("Linux", "aarch64"): (
        f"tectonic-{VERSION}-aarch64-unknown-linux-musl.tar.gz",
        "b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8",
    ),
    ("Darwin", "x86_64"): (
        f"tectonic-{VERSION}-x86_64-apple-darwin.tar.gz",
        "7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80",
    ),
    ("Darwin", "arm64"): (
        f"tectonic-{VERSION}-aarch64-apple-darwin.tar.gz",
        "a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667",
    ),
    ("Windows", "AMD64"): (
        f"tectonic-{VERSION}-x86_64-pc-windows-msvc.zip",
        "f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f",
    ),
}

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.resume_render import VENDOR, binary_name, compile_pdf
from app.services.resume_render.sample import warm_documents


def install() -> None:
    binary = VENDOR / binary_name()
    if binary.exists():
        return
    VENDOR.mkdir(parents=True, exist_ok=True)
    build = BUILDS.get((platform.system(), platform.machine()))
    if build is None:
        if shutil.which("tectonic") is None:
            sys.exit(f"no Tectonic build for {platform.system()} {platform.machine()}: install tectonic on PATH")
        return  # the API falls back to the tectonic on PATH
    asset, sha256 = build
    print(f"downloading {asset}")
    data = urllib.request.urlopen(RELEASE + asset, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != sha256:
        sys.exit("checksum mismatch: refusing to install tectonic")
    if asset.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            binary.write_bytes(archive.read(binary.name))
    else:
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            binary.write_bytes(archive.extractfile(binary.name).read())
    binary.chmod(0o755)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="compile once, offline, from the cache")
    args = parser.parse_args(argv)
    cache = VENDOR / "cache"
    if not args.check:
        install()
        cache.mkdir(parents=True, exist_ok=True)
        for tex in warm_documents():
            compile_pdf(tex, cache=cache, offline=False)
    for tex in warm_documents():
        compile_pdf(tex, cache=cache, offline=True)
    size = sum(f.stat().st_size for f in VENDOR.rglob("*") if f.is_file()) / 1e6
    print(f"tectonic and its cache ready, offline compile ok: {VENDOR} ({size:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
