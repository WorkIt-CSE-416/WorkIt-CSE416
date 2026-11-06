"""A window answer whose field is on an earlier step of a held form (KAN-686): no browser, no network, no claude.

Bank of America's TAL.net (live 2026-11-05): held on its Declaration, Lisul's answers to the education step's
"Start date: Month" and "Start date: Year" came back "couldn't fill in place", since the Rescue looked only at
the step showing and its prompt forbade going to another."""

from unittest.mock import MagicMock

from apply import rehearsal, rescue
from apply.adapters import Drive


class _Claude:
    """Claude driving the page: each drive's output in turn, and every drive it was asked for."""

    def __init__(self, *outputs):
        self.outputs, self.calls = list(outputs), []

    def drive(self, **asked):
        self.calls.append(asked)
        return Drive(self.outputs.pop(0), 3, 1_000)


def _page(*titles):
    page = MagicMock()
    page.frames = []
    page.title.side_effect = list(titles)
    return page


def test_the_rescue_goes_back_for_a_field_on_an_earlier_step_only_when_told_where_the_form_is_held():
    claude = _Claude({"blocked": False, "why": "", "shown": ["August"]})
    helped = rescue.Rescue(claude)
    assert helped.field(_page(), "Start date: Month", "August", RuntimeError("left blank"),
                        elsewhere="Declaration - Bank of America")
    [asked] = claude.calls
    assert asked["system"] == rescue.SYSTEM_ELSEWHERE
    assert "<held>Declaration - Bank of America</held>" in asked["prompt"]
    assert asked["max_turns"] == rescue.MAX_TURNS_ELSEWHERE
    assert "Never click a button that sends the application" in rescue.SYSTEM_ELSEWHERE
    # The step showing, as before: it never leaves it.
    on_step = _Claude({"blocked": False, "why": "", "shown": ["August"]})
    assert rescue.Rescue(on_step).field(_page(), "Start date: Month", "August", RuntimeError("left blank"))
    assert on_step.calls[0]["system"] == rescue.SYSTEM and "<held>" not in on_step.calls[0]["prompt"]


def _fill(monkeypatch, *drives, titles=("Declaration - Bank of America",) * 3):
    claude = _Claude(*drives)
    filled, said = [], []
    monkeypatch.setattr(rehearsal, "_filled_in", lambda page, field, *rest: filled.append(field))
    adapters, profile, done = MagicMock(), MagicMock(), MagicMock()
    adapters.claude = claude
    profile.policy.return_value = None
    done.posting.company = "Bank of America"
    rehearsal._fill_answer(_page(*titles), "Start date: Month", "August", adapters, profile, 1, done, said.append)
    return claude, filled, said


def test_an_answer_not_on_the_held_step_is_filled_on_the_earlier_step_it_is_on(monkeypatch):
    claude, filled, said = _fill(monkeypatch, {"blocked": True, "why": "the field isn't on the page", "shown": []},
                                 {"blocked": False, "why": "", "shown": ["August"]})
    assert [c["system"] for c in claude.calls] == [rescue.SYSTEM, rescue.SYSTEM_ELSEWHERE]
    assert "<held>Declaration - Bank of America</held>" in claude.calls[1]["prompt"]
    assert filled == ["Start date: Month"]
    assert said == ["Bank of America | filled 'Start date: Month' with your answer"]


def test_an_answer_on_no_step_says_so_and_a_form_left_on_another_step_is_named(monkeypatch):
    _, filled, said = _fill(monkeypatch, {"blocked": True, "why": "not here", "shown": []},
                            {"blocked": True, "why": "on no earlier step", "shown": []},
                            titles=("Declaration - Bank of America", "Languages - Bank of America"))
    assert filled == []
    assert said[0].startswith("Bank of America | the form now shows 'Languages - Bank of America', not the step it was held on")
    assert "couldn't fill 'Start date: Month' in place" in said[1] and "or an earlier one" in said[1]
