"""The privacy gate: scans a folder for the applicant's identifiers and for
secrets, and fails without ever printing what it found."""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "privacy_gate.py"

PHONE = "631 555 0142"
EMAIL = "jane.doe.private@example.org"
TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"

IDENTIFIERS = (
    "phone #1\t631[-. ]?555[-. ]?0142\n"
    "email #1\tjane\\.doe\\.private@example\\.org\n"
    "# comment lines and blank lines are skipped\n"
    "\n"
)


def gate(folder, identifiers, *extra):
    ids = folder.parent / "ids.txt"
    ids.write_text(identifiers)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(folder), "--identifiers", str(ids), *extra],
        capture_output=True,
        text=True,
    )


def tree(tmp_path, files):
    folder = tmp_path / "copy"
    for name, text in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return folder


def test_a_clean_folder_passes(tmp_path):
    folder = tree(tmp_path, {"a.py": "print('hi')\n", "docs/b.md": "Test Person, +15550100199\n"})
    result = gate(folder, IDENTIFIERS)
    assert result.returncode == 0, result.stdout


def test_a_planted_phone_fails_and_names_the_line_not_the_number(tmp_path):
    folder = tree(tmp_path, {"src/x.py": "a = 1\nCALL = '631-555-0142'\n"})
    result = gate(folder, IDENTIFIERS)
    assert result.returncode != 0
    assert "src/x.py:2" in result.stdout
    assert "phone #1" in result.stdout
    assert "0142" not in result.stdout + result.stderr


def test_a_planted_email_fails(tmp_path):
    folder = tree(tmp_path, {"notes.md": f"mail {EMAIL.upper()}\n"})
    result = gate(folder, IDENTIFIERS)
    assert result.returncode != 0
    assert "notes.md:1" in result.stdout and "email #1" in result.stdout
    assert "jane" not in result.stdout.lower()


def test_a_planted_token_fails_with_no_identifiers_file_entries(tmp_path):
    folder = tree(tmp_path, {"cfg.env": f"GH={TOKEN}\n"})
    result = gate(folder, "")
    assert result.returncode != 0
    assert "cfg.env:1" in result.stdout
    assert TOKEN[4:12] not in result.stdout + result.stderr


def test_an_allowlisted_line_passes(tmp_path):
    folder = tree(tmp_path, {"src/x.py": "CALL = '631-555-0142'\n"})
    allow = tmp_path / "allow.txt"
    allow.write_text("src/x.py:1\tphone #1\n")
    result = gate(folder, IDENTIFIERS, "--allow", str(allow))
    assert result.returncode == 0, result.stdout


def test_a_missing_identifiers_file_is_an_error_not_a_pass(tmp_path):
    folder = tree(tmp_path, {"a.py": "x = 1\n"})
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(folder), "--identifiers", str(tmp_path / "nope.txt")],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
