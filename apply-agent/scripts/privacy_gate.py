"""Privacy gate: fail when a folder holds the applicant's identifiers or a secret.

    python scripts/privacy_gate.py <dir-or-file>... [--identifiers FILE] [--allow FILE]

Run it on any copied tree before its first push. It prints `path:line  label`
for each hit, never the matched text, and exits 1 on any hit (2 on a usage
error, for example a missing identifiers file).

The identifiers file lives outside the repo, by default
`$APPLY_HOME/private-identifiers.txt` (APPLY_HOME defaults to
~/.config/apply). One entry per line: a label, a tab, then a Python regex,
matched without case. Blank lines and lines that start with # are skipped.

    phone #1<TAB>631[-. ]?555[-. ]?0142

The allow file holds known false positives, one per line: `path[:line]`, a
tab, then the label (or * for any label). Paths are as the gate prints them.

Secret patterns (API keys, tokens, private keys, cookies, ntfy topics, sheet
IDs) are built in and always checked. Binary files are skipped.
"""

import argparse
import os
import re
import sys
from pathlib import Path

SECRETS = [
    ("AWS access key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("Anthropic key", r"sk-ant-[A-Za-z0-9_-]{8,}"),
    ("GitHub token", r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    ("GitHub token", r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    ("Slack token", r"\bxox[abpr]-[A-Za-z0-9-]{10,}"),
    ("Google API key", r"\bAIza[0-9A-Za-z_-]{35}"),
    ("Google OAuth token", r"\bya29\.[0-9A-Za-z_-]{20,}"),
    ("private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("private key", r"\"private_key\"\s*:\s*\"-----"),
    ("LinkedIn cookie", r"\bli_at=[A-Za-z0-9_-]{10,}"),
    ("session cookie", r"\bJSESSIONID=\"?[A-Za-z0-9:_-]{10,}"),
    ("ntfy topic", r"ntfy\.sh/apply-[0-9a-f]{6,}"),
    ("sheet ID", r"spreadsheets/d/[A-Za-z0-9_-]{25,}"),
]

SKIP_DIRS = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache"}


def default_identifiers():
    home = os.environ.get("APPLY_HOME") or "~/.config/apply"
    return Path(home).expanduser() / "private-identifiers.txt"


def read_identifiers(path):
    rules = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        label, sep, pattern = line.partition("\t")
        if not sep or not pattern.strip():
            sys.exit(f"{path}:{n}: expected 'label<TAB>regex'")
        try:
            rules.append((label.strip(), re.compile(pattern.strip(), re.IGNORECASE)))
        except re.error as e:
            sys.exit(f"{path}:{n}: bad regex ({e.msg})")  # never echo the pattern
    return rules


def read_allow(path):
    allow = set()
    if path:
        for line in Path(path).read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                where, _, label = line.partition("\t")
                allow.add((where.strip(), label.strip() or "*"))
    return allow


def files(targets):
    """Yield (shown path, real path) for every file under the targets."""
    for target in targets:
        target = Path(target)
        if target.is_file():
            yield str(target), target
            continue
        for root, dirs, names in os.walk(target):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for name in sorted(names):
                path = Path(root) / name
                yield path.relative_to(target).as_posix(), path


def allowed(allow, shown, n, label):
    return any(
        (where, lab) in allow for where in (f"{shown}:{n}", shown) for lab in (label, "*")
    )


def scan(targets, rules, allow):
    hits = []
    for shown, path in files(targets):
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue
        for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            for label, rx in rules:
                if rx.search(line) and not allowed(allow, shown, n, label):
                    hits.append((shown, n, label))
    return hits


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("targets", nargs="+", help="folders or files to scan")
    ap.add_argument("--identifiers", type=Path, default=None)
    ap.add_argument("--allow", default=None, help="file of known false positives")
    args = ap.parse_args(argv)
    ids = args.identifiers or default_identifiers()
    if not ids.is_file():
        print(f"no identifiers file at {ids}", file=sys.stderr)
        return 2
    rules = read_identifiers(ids) + [(label, re.compile(p)) for label, p in SECRETS]
    hits = scan(args.targets, rules, read_allow(args.allow))
    for shown, n, label in hits:
        print(f"{shown}:{n}\t{label}")
    print(f"{len(hits)} hit(s)" if hits else "clean", file=sys.stderr)
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
