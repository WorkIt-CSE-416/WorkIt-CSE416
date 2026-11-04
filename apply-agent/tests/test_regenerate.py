"""Add context and regenerate (KAN-599): one answer Claude wrote, written again
with context Lisul adds. No browser: the on-page button is in
test_rehearse.py -k regenerate."""

import json
import urllib.error
import urllib.request
from datetime import date

import pytest
from fakes import FakeClaude, RecordingBoard
from test_run_answers import profile_with

from apply import home, regenerate
from apply.answer_bank import CLAUDE, AnswerBank
from apply.dashboard import Dashboard, NoFrames
from apply.essays import Essay
from apply.model import Posting, Question
from apply.profile import ApplicantProfile
from apply.rehearsal import _Redo

TODAY = date(2026, 11, 4)
POSTING = Posting("p1", "Harvey", "Software Engineer Intern", "https://jobs.ashbyhq.com/harvey/1/application")
WHY = Question("why", "Why are you interested in working at Harvey?", "textarea", True)
CLUB = Question("club", "Which student club would you lead, and why?", "text", True)
FROM = Question("from", "From", "text", True)
CONTEXT = "Lead with the robotics club project; I led a team of 5 there."
EARLIER = (f"{FakeClaude.OPENINGS[0]}{FakeClaude.DRAFT[1:]} {FakeClaude.MORE[0]} {FakeClaude.MORE[1]}")
LATER = (f"{FakeClaude.OPENINGS[1]}{FakeClaude.DRAFT[1:]} {FakeClaude.MORE[2]} {FakeClaude.MORE[3]}")


def a_form(*written: regenerate.Written) -> regenerate.Form:
    return regenerate.Form(POSTING, [w.question for w in written], {w.question.name: w.text for w in written},
                           "", "Harvey builds AI for legal work.", list(written))


def test_an_essay_is_written_again_with_the_context_kept_in_the_story_bank(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    claude = FakeClaude(essays={"Why are you interested": LATER})
    form = a_form(regenerate.Written(WHY, EARLIER, regenerate.ESSAY, essay=Essay(WHY, EARLIER)))

    redone = regenerate.regenerate(claude, form, "why", CONTEXT, profile, AnswerBank(), TODAY)

    assert redone.text == LATER and not redone.why
    assert form.get("why").text == LATER and form.answers["why"] == LATER  # the plan, for the Record
    assert form.essay_cell().count(LATER) == 1
    # Kept with its question, never as a bare label: every later essay can quote it.
    line = f'- For "{WHY.label}" at Harvey: {CONTEXT} ({TODAY.isoformat()})'
    assert redone.kept in home.STORY_BANK.read_text() and line in home.STORY_BANK.read_text()
    assert regenerate.ADDED in home.STORY_BANK.read_text()
    # The plan and the draft both see the earlier answer and his context, as data in a <redo> block.
    planned, drafted = [c for c in claude.calls if "plan" in c["schema"]["properties"]], \
        [c for c in claude.calls if "essays" in c["schema"]["properties"]]
    for call in (planned[0], drafted[0]):
        redo = json.loads(call["prompt"].split("<redo>\n", 1)[1].split("\n</redo>", 1)[0])
        assert redo == {"q1": {"earlier_answer": EARLIER, "added_context": CONTEXT}}
        assert CONTEXT in call["prompt"].split("<story_bank>", 1)[1]  # in the sources too
    assert "added_context" in drafted[0]["system"] and "never state a fact" in drafted[0]["system"]


def test_the_same_context_twice_is_one_story_bank_line(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    form = a_form(regenerate.Written(WHY, EARLIER, regenerate.ESSAY, essay=Essay(WHY, EARLIER)))
    for _ in range(2):
        regenerate.regenerate(FakeClaude(essays={"Why are you interested": LATER}), form, "why", CONTEXT, profile,
                              AnswerBank(), TODAY)
    assert home.STORY_BANK.read_text().count(CONTEXT) == 1


def test_an_answer_over_the_forms_cap_or_with_an_invented_name_stays_off_the_form(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    capped = Question("why", "Why are you interested in working at Harvey? (max 20 words)", "textarea", True)
    form = a_form(regenerate.Written(capped, EARLIER, regenerate.ESSAY, essay=Essay(capped, EARLIER)))
    long = " ".join([LATER] * 3)

    redone = regenerate.regenerate(FakeClaude(essays={"Why are you interested": long}), form, "why", CONTEXT, profile,
                                   AnswerBank(), TODAY)
    assert not redone.text and "over the form's limit" in redone.why and "old one stays" in redone.why
    assert form.get("why").text == EARLIER  # the old answer stays

    invented = f"{LATER} He won the Zorblax Prize for it."
    form = a_form(regenerate.Written(WHY, EARLIER, regenerate.ESSAY, essay=Essay(WHY, EARLIER)))
    redone = regenerate.regenerate(FakeClaude(essays={"Why are you interested": invented}), form, "why", CONTEXT,
                                   profile, AnswerBank(), TODAY)
    assert not redone.text and "Zorblax" in redone.why
    assert form.get("why").text == EARLIER


def test_a_one_off_answer_is_drafted_again_and_replaces_its_draft_in_the_answer_bank(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    bank.add(CLUB, "The coding club", "Harvey", TODAY)
    form = a_form(regenerate.Written(CLUB, "The coding club", regenerate.DRAFT))

    redone = regenerate.regenerate(FakeClaude(drafts={"Which student club": "The robotics club, which I led"}), form,
                                   "club", "I led the robotics club", profile, bank, TODAY)

    assert redone.text == "The robotics club, which I led" and redone.banked
    entry = AnswerBank(tmp_path / "answer-bank.yaml").get(CLUB.label)
    assert entry.answer == "The robotics club, which I led" and entry.source == CLAUDE and not entry.reviewed
    assert entry.first_seen == TODAY and entry.company == "Harvey"


def test_lisuls_own_answer_and_a_bare_label_are_never_replaced_in_the_answer_bank(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    bank.answer(CLUB.label, "His own words", TODAY)
    form = a_form(regenerate.Written(CLUB, "His own words", regenerate.DRAFT))
    redone = regenerate.regenerate(FakeClaude(drafts={"Which student club": "Another club"}), form, "club", "say more",
                                   profile, bank, TODAY)
    assert redone.text == "Another club" and not redone.banked
    assert bank.get(CLUB.label).answer == "His own words"

    form = a_form(regenerate.Written(FROM, "May 2027", regenerate.DRAFT))
    redone = regenerate.regenerate(FakeClaude(drafts={"From": "June 2027"}), form, "from", "I start in June", profile,
                                   bank, TODAY)
    assert redone.text == "June 2027" and not redone.banked and bank.get("From") is None


def test_no_context_asks_for_some_and_changes_nothing(tmp_path):
    profile = ApplicantProfile.load(profile_with(tmp_path))
    form = a_form(regenerate.Written(WHY, EARLIER, regenerate.ESSAY, essay=Essay(WHY, EARLIER)))
    before = home.STORY_BANK.read_text()
    claude = FakeClaude()
    redone = regenerate.regenerate(claude, form, "why", "   ", profile, AnswerBank(), TODAY)
    assert not redone.text and "Type what Claude should know" in redone.why
    assert claude.calls == [] and home.STORY_BANK.read_text() == before


def test_only_answers_claude_wrote_into_a_text_field_can_be_regenerated():
    class Planned:
        posting, text, material = POSTING, "", None
        pick = Question("pick", "Which team?", "select", True, ("A", "B"))
        questions = [WHY, CLUB, pick, FROM]
        answers = {"why": EARLIER, "club": "The coding club", "pick": "A", "from": "May 2027"}
        written = [Essay(WHY, EARLIER)]
        drafted = [type("D", (), {"question": CLUB, "answer": "The coding club"}),
                   type("D", (), {"question": pick, "answer": "A"})]  # a pick from a list: not offered
        unbanked = []

        def known(self):
            return ""

    form = regenerate.form_of(Planned())
    assert [(w.question.name, w.kind) for w in form.written] == [("why", regenerate.ESSAY), ("club", regenerate.DRAFT)]
    assert not form.read  # no Company material yet: a regenerate of an essay reads it


def test_the_window_queues_a_regenerate_for_the_held_form_and_refuses_the_rest():
    written = [{"name": "why", "label": WHY.label, "text": EARLIER, "kind": "essay", "state": "", "why": ""}]
    with Dashboard(1, NoFrames()) as board:
        board.update(0, company="Harvey", posting_url=POSTING.url, status="ready to submit", written=written)
        item = board.state()["items"][0]

        def press(body: dict, token: str = board.token) -> tuple[int, dict]:
            request = urllib.request.Request(board.url + "/regenerate", json.dumps(body).encode(),
                                             {"X-Apply-Token": token, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(request) as reply:
                    return reply.status, json.loads(reply.read())
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read())

        assert press({"id": item["id"], "name": "why", "context": CONTEXT}, token="wrong")[0] == 403
        assert press({"id": item["id"], "name": "why", "context": " "})[0] == 400
        assert press({"id": item["id"], "name": "email", "context": CONTEXT})[0] == 404  # not Claude's
        status, reply = press({"id": item["id"], "name": "why", "context": CONTEXT})
        assert status == 200 and "nothing is sent" in reply["message"]
        assert board.regenerations(0) == [("why", CONTEXT)] and board.regenerations(0) == []
        board.update(0, written=[written[0] | {"state": "working"}])
        assert press({"id": "tile-0", "name": "why", "context": CONTEXT})[0] == 409  # already rewriting
        board.update(0, status="filling")  # Fill again: the held form is gone
        assert press({"id": item["id"], "name": "why", "context": CONTEXT})[0] == 409


def test_a_press_with_no_form_written_does_nothing():
    class Done:
        form = None
    redo = _Redo(lambda: Done(), None, None, 0, None, lambda line: pytest.fail(line))
    assert redo.written() == []
    redo(None, "why", CONTEXT)  # nothing to write again, and nothing said
    assert RecordingBoard().regenerations(0) == []
