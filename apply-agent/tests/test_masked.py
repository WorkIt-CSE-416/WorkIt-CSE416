"""KAN-664: personal values stay out of Apply's output, and `apply data` shows shapes only."""

import json
import subprocess
from pathlib import Path

import pytest
import yaml

from apply import cli, data_command, home, masked
from apply.masked import Known, sized

HOOK = Path(__file__).parents[1] / "tools" / "block-apply-home-reads.sh"
EMAIL, PHONE = "pat.lee@mailhost.example", "+1 (631) 555-0142"
TOKEN_URL = "https://acme.tal.net/vx/lang-en-GB/user-36/xf-9a8b7c6d5e/candidate/so/pm/1/pl/3?token=abc123&page=2"
PROFILE = {
    "identity": {"legal_first_name": "Patience", "legal_last_name": "Leeward", "email": EMAIL, "phone": PHONE,
                 "home_address": {"line1": "12 Birch Lane", "state": "NY"}},
    "links": {"linkedin_url": "https://www.linkedin.com/in/patience-leeward"},
    "education": {"gpa": 3.91, "graduated": False, "graduation": "2028-05"},
    "answered_questions": {"Who referred you?": "Marigold Thimblewick", "Are you 18?": "Yes"},
}
BANK = {"why us?": {"question": "Why us?", "answer": "Because your robots fold laundry."}}
VALUES = ["Patience", "Leeward", "pat.lee", "mailhost", "555-0142", "631", "Birch", "patience-leeward", "3.91", "2028-05",
          "Marigold", "laundry"]


@pytest.fixture
def folder(tmp_path) -> Path:
    (tmp_path / "applicant-profile.yaml").write_text(yaml.safe_dump(PROFILE))
    (tmp_path / "answer-bank.yaml").write_text(yaml.safe_dump(BANK))
    (tmp_path / "tracker.json").write_text(json.dumps({"rows": [{"url": TOKEN_URL, "contact": EMAIL}]}))
    (tmp_path / "voice.md").write_text("Patience writes plainly.")
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "Cookies").write_text("secret cookie")
    return tmp_path


@pytest.fixture
def known(folder) -> Known:
    found = Known()
    found.learn(folder / "applicant-profile.yaml")
    return found


@pytest.mark.parametrize("line, gone, stays", [
    (f"Logged in as {EMAIL}", ["pat.lee", "mailhost"], "Logged in as <identity.email>"),
    ("Logged in as other@else.example", ["other", "else"], "Logged in as <email>"),
    (f"Call {PHONE} now", ["555-0142"], "Call"),
    ("Hello Patience Leeward!", ["Patience", "Leeward"], "Hello <identity.legal_first_name> <identity.legal_last_name>!"),
    ("hello PATIENCE", ["PATIENCE"], "hello <identity.legal_first_name>"),
    ("from Marigold Thimblewick", ["Marigold"], "from <answer>"),
    ("wrote: Because your robots fold laundry.", ["laundry"], "wrote: <answer>"),
    (TOKEN_URL, ["user-36", "xf-9a8b7c6d5e", "abc123"], "https://acme.tal.net/vx/lang-en-GB/<hidden>/<hidden>/candidate/<hidden>/pm/1/pl/3?token=<hidden>&page=2"),
    ("https://x.example/a?session=z&email=a%40b.example#frag", ["a%40b", "frag"], "https://x.example/a?session=<hidden>&email=<hidden>#<hidden>"),
    ("https://u:hunter2@x.example/a", ["hunter2"], "https://x.example/a"),
    ("https://www.linkedin.com/in/someone-else", ["someone-else"], "linkedin.com/in/<hidden>"),
])
def test_a_line_loses_its_private_values(known, line, gone, stays):
    said = known.scrub(line)
    assert not [g for g in gone if g in said]
    assert stays in said


@pytest.mark.parametrize("line", [
    "Acme | Software Intern | ready: 12 of 12 filled, 1,234 tokens at 2026-11-05",
    "https://jobs.lever.co/acme/8c850c75-081d-4d09-bebf-096379a93010/apply",
    "https://job-boards.greenhouse.io/acme/jobs/5442881008?gh_src=abc",
    "Records go to /Users/patience/.config/apply/rehearsals/",  # a word inside a path is no whole word
])
def test_a_line_with_nothing_private_stays(known, line):
    assert known.scrub(line) == line


def test_a_short_answer_is_not_masked_everywhere(known):
    assert known.scrub("Yes, NY") == "Yes, NY"


def test_a_typed_answer_prints_its_size_only():
    assert sized("Marigold") == "<answer, 8 chars>"
    assert sized("Marigold", "message") == "<message, 8 chars>"


def test_the_window_prints_no_answer_or_message():
    source = (Path(masked.__file__).parent / "dashboard.py").read_text()
    for raw in ("→ {answer}", "{entry['message']}", "→ {answer or"):
        assert raw not in source


def test_shell_output_is_scrubbed_whole_and_a_sys_exit_too(folder, capsys):
    masked.KNOWN.learn(folder / "applicant-profile.yaml")
    with pytest.raises(SystemExit) as leaving, masked.output():
        print(f"signed in as {EMAIL} on {TOKEN_URL}")
        print("Patience here", flush=True)
        raise SystemExit(f"stopped for {EMAIL}")
    out = capsys.readouterr().out
    assert "<identity.email>" in out and "<identity.legal_first_name> here" in out and "user-36" not in out
    assert leaving.value.code == "stopped for <identity.email>"


def everything(lines: list[str]) -> str:
    return "\n".join(lines)


def test_data_keys_lists_files_and_shapes_with_no_value(folder):
    masked.KNOWN.learn(folder / "applicant-profile.yaml")
    said = everything(data_command.keys(home=folder))
    assert "identity.email  <email>" in said and "education.gpa  <number>" in said
    assert "identity.legal_first_name  <text, 8 chars>" in said and "education.graduated  <yes or no>" in said
    assert "profiles/  <folder, not listed>" in said and "Cookies" not in said
    assert not [v for v in VALUES if v in said]


def test_data_show_key_shows_a_masked_value_or_tree(folder):
    assert data_command.show_key("identity.phone", home=folder) == ["identity.phone  <phone>"]
    assert data_command.show_key("links.linkedin_url", home=folder) == ["links.linkedin_url  https://<host>.com/<2 path parts>"]
    assert data_command.show_key("identity.home_address", home=folder) == [
        "identity.home_address.line1  <text, 13 chars>", "identity.home_address.state  <text, 2 chars>"]


def test_data_show_key_masks_a_url_with_ids_and_tokens(folder):
    said = everything(data_command.show_key("rows.0.url", "tracker.json", home=folder))
    assert said == "rows.0.url  https://<host>.net/<10 path parts>?<2 params>"


def test_a_key_that_is_itself_private_is_scrubbed(tmp_path):
    masked.KNOWN.learn(tmp_path / "none.yaml")
    (tmp_path / "accounts.json").write_text(json.dumps({EMAIL: {"site": "x"}}))
    assert everything(data_command.keys("accounts.json", home=tmp_path)) == "<email>.site  <text, 1 chars>"


def test_data_never_leaves_the_folder(folder, tmp_path_factory):
    outside = tmp_path_factory.mktemp("other") / "x.yaml"
    outside.write_text("secret: value")
    with pytest.raises(data_command.Refused, match="outside"):
        data_command.keys(str(outside), home=folder)
    with pytest.raises(data_command.Refused, match="outside"):
        data_command.show_key("secret", f"../{outside.parent.name}/x.yaml", home=folder)


def test_an_unknown_key_says_so_without_a_value(folder):
    with pytest.raises(data_command.Refused, match="No key"):
        data_command.show_key("identity.nope", home=folder)


def test_the_command_prints_shapes(folder, capsys, monkeypatch):
    monkeypatch.setattr(data_command.show_key, "__defaults__", (None, folder))
    monkeypatch.setattr(cli, "DEFAULT_PROFILE", folder / "applicant-profile.yaml")
    cli.main(["data", "show-key", "identity.email"])
    assert capsys.readouterr().out == "identity.email  <email>\n"
    assert home.HOME.is_dir()


def hook(command: str, tool: str = "Bash") -> subprocess.CompletedProcess:
    return subprocess.run([str(HOOK)], input=json.dumps({"tool_name": tool, "cwd": "/x/.config/apply", "tool_input": {"command": command}}),
                          capture_output=True, text=True)


@pytest.mark.parametrize("command", [
    "cat ~/.config/apply/applicant-profile.yaml",
    "cd ~/.config/apply && grep -r phone .",
    "sed -n 1,5p $HOME/.config/apply/answer-bank.yaml",
    "/bin/cat /Users/me/.config/apply/tracker.json | head",
    "python3 -c \"print(open('/Users/me/.config/apply/x').read())\"",
    "uv run python -c \"from pathlib import Path; print((Path.home()/'.config'/'apply'/'x').read_text())\"",
    "python3 - <<E\nimport yaml\nyaml.safe_load(open('$APPLY_HOME/x'))\nE",
    "jq . ${APPLY_HOME}/tracker.json",
    "rg email ~/.config/apply",
])
def test_the_hook_blocks_a_raw_read(command):
    done = hook(command)
    assert done.returncode == 2 and "apply data" in done.stderr


@pytest.mark.parametrize("command", [
    "uv run apply data keys",
    "ls ~/.config/apply",
    "cat README.md",
    "grep -r phone src/",
    "APPLY_HOME=~/workit-work/scratch uv run apply doctor",
    "git log -- .config/applyish",
])
def test_the_hook_lets_the_rest_through(command):
    assert hook(command).returncode == 0, command


def test_the_hook_ignores_the_folder_it_runs_in():
    assert hook("cat README.md").returncode == 0  # the fixture's cwd is under .config/apply
