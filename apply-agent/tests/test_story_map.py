"""The story map: one Opus call tags each Story bank episode, code checks every
tag against the bank, and a stale entry never reaches a caller. Claude is
FakeClaude; the bank and the map are files in tmp_path."""

from datetime import date, datetime

import pytest
import yaml
from fakes import FakeClaude, FakeClock

from apply import home, story_map
from apply.adapters import Adapters
from apply.cli import main

BANK = """# Story bank

## How Lisul writes
- Open on something concrete, about 5 degrees of detail.

## Education
- TA for CSE 114, Spring 2026: ran his own weekly lab of about 20 students.

## Micromouse (IEEE Stony Brook; team captain)
- Hardest bug: turns overshot about 5 degrees because the IMU reports yaw about 40 ms late.
- Found the ToF sensor over-reads by about 17% and fit a line from 6 ruler-measured stops.

## Skills
- Languages: C++, C, Python.
"""

IMU = "Hardest bug: turns overshot about 5 degrees because the IMU reports yaw about 40 ms late."
TOF = "Found the ToF sensor over-reads by about 17%"


def episode(id: str, anchor: str, **given) -> dict:
    return {"id": id, "anchor": anchor, "types": ["failure"], "problem_kinds": ["embedded-control"],
            "skills": ["C++"], "numbers": [], "follow_ups": [], "never_claim": [], "related": []} | given


@pytest.fixture
def bank(tmp_path):
    path = tmp_path / "story-bank.md"
    path.write_text(BANK)
    return path


def built(bank, *episodes) -> dict:
    return story_map.build(FakeClaude(story_map=list(episodes)), bank=bank)


def test_an_entry_keeps_its_tags_and_a_hash_of_its_whole_anchor_line(bank):
    claude = FakeClaude(story_map=[episode("micromouse/imu-lag", "Hardest bug: turns overshot",
                                           numbers=["about 5 degrees", "about 40 ms"], related=["micromouse/tof"]),
                                   episode("micromouse/tof", TOF, numbers=["17%"])])

    result = story_map.build(claude, bank=bank)

    imu, tof = result["episodes"]
    assert imu["id"] == "micromouse/imu-lag" and imu["numbers"] == ["about 5 degrees", "about 40 ms"]
    assert imu["hash"] == story_map.line_hash("- " + IMU) and imu["area"] == "micromouse"
    assert imu["related"] == ["micromouse/tof"] and tof["numbers"] == ["17%"]
    assert result["dropped"] == []
    call = claude.calls[0]
    assert call["model"] == "opus" and "<document>" in call["prompt"] and BANK in call["prompt"]


def test_an_anchor_that_is_not_exactly_one_bank_line_drops_its_entry(bank):
    result = built(bank, episode("made-up", "Won the regional final"),
                   episode("too-wide", "about"),  # in more than one line
                   episode("voice", "Open on something concrete"),  # not an episode: a writing rule
                   episode("micromouse/tof", TOF))

    assert [e["id"] for e in result["episodes"]] == ["micromouse/tof"]
    assert len(result["dropped"]) == 3 and all("anchor" in reason for reason in result["dropped"])


def test_a_number_not_in_its_anchor_line_is_dropped_and_the_entry_kept(bank):
    result = built(bank, episode("micromouse/imu-lag", IMU, numbers=["about 40 ms", "2.75 to 1.01 degrees"]))

    assert result["episodes"][0]["numbers"] == ["about 40 ms"]
    assert any("2.75 to 1.01 degrees" in reason for reason in result["dropped"])


def test_an_unknown_type_or_problem_kind_is_dropped_and_an_entry_left_with_no_type_is_dropped(bank):
    result = built(bank, episode("micromouse/imu-lag", IMU, types=["failure", "hardest-bug"],
                                 problem_kinds=["embedded-control", "rocketry"], related=["nowhere"]),
                   episode("education/ta", "TA for CSE 114", types=["teaching"]))

    [imu] = result["episodes"]
    assert imu["types"] == ["failure"] and imu["problem_kinds"] == ["embedded-control"] and imu["related"] == []
    assert any("hardest-bug" in r for r in result["dropped"]) and any("rocketry" in r for r in result["dropped"])
    assert any("education/ta" in r for r in result["dropped"])


def test_a_second_entry_with_the_same_id_is_dropped(bank):
    result = built(bank, episode("micromouse/tof", TOF), episode("micromouse/tof", IMU))

    assert [e["anchor"] for e in result["episodes"]] == [TOF]


def write_map(path, bank, *episodes) -> None:
    path.write_text(yaml.safe_dump({"episodes": built(bank, *episodes)["episodes"]}, sort_keys=False))


def test_load_silently_drops_an_entry_whose_line_changed_or_is_gone_and_check_lists_them(bank, tmp_path):
    path = tmp_path / "story-map.yaml"
    write_map(path, bank, episode("micromouse/imu-lag", "Hardest bug: turns overshot"), episode("micromouse/tof", TOF),
              episode("education/ta", "TA for CSE 114", types=["about-me"]))
    bank.write_text(BANK.replace("about 40 ms late.", "about 40 ms late (measured).")
                        .replace("- TA for CSE 114, Spring 2026: ran his own weekly lab of about 20 students.\n", ""))

    assert [e.id for e in story_map.load(path, bank=bank)] == ["micromouse/tof"]
    assert story_map.check(path, bank=bank) == ["micromouse/imu-lag: its line in the story bank changed",
                                                 "education/ta: its line is no longer in the story bank"]


def test_with_no_map_load_and_check_find_nothing(bank, tmp_path):
    assert story_map.load(tmp_path / "none.yaml", bank=bank) == []
    assert story_map.check(tmp_path / "none.yaml", bank=bank) == []


def test_gaps_are_the_follow_ups_the_bank_cannot_answer_as_questions_md_lines(bank, tmp_path):
    path = tmp_path / "story-map.yaml"
    write_map(path, bank, episode("micromouse/imu-lag", IMU, follow_ups=[
        {"q": "Why not just tune the gains?", "bank": "the controller chased the lag"},
        {"q": "How did you find the 40 ms?", "bank": "none"}]),
        episode("education/ta", "TA for CSE 114", types=["about-me"],
                follow_ups=[{"q": "What did you change in the lab?", "bank": "none"}]))

    assert story_map.gaps(path, bank=bank, today=date(2026, 10, 22)) == [
        "- 2026-10-22 | micromouse | How did you find the 40 ms? | asked | story map: micromouse/imu-lag",
        "- 2026-10-22 | education | What did you change in the lab? | asked | story map: education/ta",
    ]


def test_the_prompt_block_names_each_episode_its_tags_and_only_the_follow_ups_to_avoid(bank, tmp_path):
    path = tmp_path / "story-map.yaml"
    write_map(path, bank, episode("micromouse/imu-lag", IMU, numbers=["about 40 ms"], related=["micromouse/tof"],
                                  never_claim=["a competition time caused by this fix"],
                                  follow_ups=[{"q": "Why not tune the gains?", "bank": "the controller chased the lag"},
                                              {"q": "How did you find the 40 ms?", "bank": "none"}]),
              episode("micromouse/tof", TOF))

    block = story_map.prompt_block(story_map.load(path, bank=bank))

    first, second = block.splitlines()
    assert first.startswith("micromouse/imu-lag (micromouse): ") and '"Hardest bug: turns overshot' in first
    for part in ("types: failure", "kinds: embedded-control", "numbers: about 40 ms",
                 "never claim: a competition time caused by this fix", "bank can't answer: How did you find the 40 ms?",
                 "related: micromouse/tof"):
        assert part in first
    assert "Why not tune the gains?" not in block
    assert second.startswith("micromouse/tof (micromouse): ") and "never claim" not in second
    assert story_map.prompt_block([]) == ""


@pytest.fixture
def files(bank, tmp_path, monkeypatch):
    """The command's bank and map, in tmp_path."""
    path = tmp_path / "story-map.yaml"
    monkeypatch.setattr(home, "STORY_BANK", bank)
    monkeypatch.setattr(story_map, "MAP", path)
    return path


def run(argv, *episodes) -> None:
    main(argv, adapters=Adapters(feed=None, tracker=None, site=None, claude=FakeClaude(story_map=list(episodes)),
                                 mailbox=None, usage=None, clock=FakeClock(datetime(2026, 10, 22, 9, 0))))


def test_apply_story_map_shows_the_diff_and_writes_the_map_with_yes(files, capsys):
    write_map(files, home.STORY_BANK, episode("micromouse/tof", TOF), episode("education/ta", "TA for CSE 114",
                                                                            types=["about-me"]))

    run(["story-map", "--yes"], episode("micromouse/tof", TOF, types=["failure", "best-project"]),
        episode("micromouse/imu-lag", IMU, follow_ups=[{"q": "How did you find the 40 ms?", "bank": "none"}]),
        episode("made-up", "Won the regional final"))

    out = capsys.readouterr().out
    for line in ("+ micromouse/imu-lag", "- education/ta", "~ micromouse/tof: types",
                 "    types: ['failure'] -> ['failure', 'best-project']", "    new gap: How did you find the 40 ms?",
                 "made-up: its anchor is not exactly one story-bank line"):
        assert line in out
    assert [e.id for e in story_map.load(files)] == ["micromouse/tof", "micromouse/imu-lag"]


def test_apply_story_map_writes_nothing_unless_lisul_says_yes(files, monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt: "n")

    run(["story-map"], episode("micromouse/tof", TOF))

    assert "+ micromouse/tof" in capsys.readouterr().out and not files.exists()


def test_apply_story_map_check_and_gaps_print_their_lines_with_no_model_call(files, capsys):
    write_map(files, home.STORY_BANK, episode("micromouse/imu-lag", "Hardest bug: turns overshot",
                                             follow_ups=[{"q": "How did you find the 40 ms?", "bank": "none"}]),
              episode("micromouse/tof", TOF))
    home.STORY_BANK.write_text(BANK.replace("about 17%", "about 17 percent"))

    run(["story-map", "--check"])
    assert capsys.readouterr().out == "micromouse/tof: its line is no longer in the story bank\n"
    run(["story-map", "--gaps"])
    assert capsys.readouterr().out.endswith(
        "| micromouse | How did you find the 40 ms? | asked | story map: micromouse/imu-lag\n")
