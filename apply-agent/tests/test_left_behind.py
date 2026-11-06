"""An answer that came after its step was saved without it (KAN-687): no browser, no network, no claude.

Bank of America's TAL.net (live 2026-11-05): "What is your native language?" was found on the Languages step
with no answer, and Save and Continue went on with it blank. Lisul's answer came while Apply filled later steps,
which never show its field, and the held form said nothing was left blank."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from apply import rehearsal, worker
from apply.model import Posting, Status

NATIVE = "What is your native language?"


def test_a_left_behind_answer_is_named_as_left_blank_and_kept_for_the_hold_to_fill():
    result = worker.Result(Status.HELD, "held", missing=("Military status",), left_behind=((NATIVE, "English"),))
    done = rehearsal._summary(Posting("1", "Bank of America", "Analyst", "https://example.tal.net/vx/1"), result,
                              MagicMock(), 0, 0.0)
    assert done.missing == ("Military status", NATIVE)  # the note and the window list it till it is filled
    assert done.left_behind == ((NATIVE, "English"),)


def test_the_worker_reads_what_a_filler_left_behind_and_says_why_it_is_not_on_the_form():
    assert worker._left_behind(SimpleNamespace(left_behind=[(NATIVE, "English")])) == ((NATIVE, "English"),)
    assert worker._left_behind(object()) == ()  # a Filler that fills every step at once leaves nothing behind
    assert "after the form saved its step without it" in worker.LEFT_BEHIND
