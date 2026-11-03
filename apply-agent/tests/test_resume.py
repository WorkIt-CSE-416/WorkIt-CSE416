"""Resume (KAN-551): a rehearsal that stops mid-form for Lisul waits on its
open page. He fixes the page himself and presses Resume, and Apply goes on
from the step the page shows, keeping his fix, to the form's last page.
Nothing is ever submitted. When the form's tab is gone, Resume says so."""

import json
import urllib.error
import urllib.request

import pytest
from fake_workday import EXPERIENCE_STEPS, FakeWorkdayServer
from fakes import RecordingBoard
from test_dashboard import NoFrames, window  # noqa: F401 (a fixture)
from test_employer_accounts import XCEL_FORM, XCEL_URL
from test_rehearse import NeverSubmittingWorkday, adapters, experience_profile

from apply import rehearsal
from apply.dashboard import Dashboard, verdict
from apply.fillers import FILLERS
from apply.profile import ApplicantProfile

XCEL = "xcelenergy.wd1.myworkdayjobs.com"


def handed_pages(monkeypatch) -> list:
    """Each page Apply hands to Lisul (lift), in order."""
    real, handed = rehearsal.lift, []

    def lift(page, **heard):
        real(page, **heard)
        handed.append(page)
    monkeypatch.setattr(rehearsal, "lift", lift)
    return handed


def pick_degree(page, degree: str) -> None:
    """Lisul picks the Education panel's Degree on the page, as a person does: the dropdown, then the choice."""
    page.locator("button[aria-haspopup=listbox]").first.click()
    page.get_by_role("option", name=degree, exact=True).click()


def test_resume_after_lisul_fixes_the_step_workday_wont_leave_fills_the_rest_and_never_submits(monkeypatch):
    # Snap's degree list has B.A. and B.S., not the profile's Bachelor's Degree: Workday won't leave My Experience.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)
    world = experience_profile()

    class Lisul(RecordingBoard):
        """He fixes the Degree on the paused page and presses Resume; once the form is filled, he closes it."""

        pressed = 0
        paused: dict = {}

        def resumed(self, worker):
            if self.pressed or not handed:
                return False
            self.paused = dict(self.captions[worker])
            pick_degree(handed[-1], "B.S.")
            self.pressed += 1
            return True

        def answered(self, worker):
            # Done (or gone wrong): he closes it, so the test never hangs on a page held open.
            ended = self.captions[worker].get("status") not in ("filling", "handoff")
            if ended and not handed[-1].is_closed():
                handed[-1].close()
            return []

    board, lines = Lisul(), []
    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        [first] = rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(world.profile), 1,
                                     keep_open=True, out=lines.append)

    # Paused where Workday wouldn't go on, with Resume offered on its card.
    assert first.outcome == "handoff" and "won't leave its 'My Experience' step" in first.why
    assert board.paused["status"] == "handoff" and board.paused["resume"] == {"ok": True}
    # Resumed on the same page: the rest of the form filled to Review, his Degree kept.
    assert board.pressed == 1 and len({id(page) for page in handed}) == 1
    shown = board.captions[0]
    assert shown["status"] == "ready to submit", shown["why"]
    assert shown["missing"] == []  # the Degree he picked waits on him no more
    saved = server.saved(XCEL)
    assert saved["education"][0]["degree"] == "B.S."
    assert [h.split(" ", 1)[1].split(":")[0] for h in shown["history"]] == ["Paused", "Resumed"]
    assert any("ready to submit" in line for line in lines)
    assert server.submissions == []


def test_a_paused_form_whose_tab_lisul_closed_says_resume_cannot_go_on(monkeypatch):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)

    class Lisul(RecordingBoard):
        def answered(self, worker):  # he closes the paused form's tab instead
            if handed and not handed[-1].is_closed():
                handed[-1].close()
            return []

    board, world = Lisul(), experience_profile()
    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        [done] = rehearsal.rehearse([XCEL_URL], adapters(server, board=board),
                                    ApplicantProfile.load(world.profile), 1, keep_open=True,
                                    out=lambda line: None)

    assert done.outcome == "handoff"
    assert board.captions[0]["resume"] == {"ok": False, "why": rehearsal.TAB_CLOSED}
    assert server.submissions == []


PAUSED = {"company": "Xcel Energy", "role": "Intern", "posting_url": XCEL_URL, "application_id": "xcel-1",
          "job_system": "workday", "status": "handoff", "why": "Workday won't leave its 'My Experience' step: Degree"}


def post_resume(board, key, token=None):
    body = json.dumps({"id": key}).encode()
    return urllib.request.urlopen(urllib.request.Request(board.url + "/resume", body,
                                                         {"X-Apply-Token": token or board.token}))


def test_a_paused_card_offers_resume_and_says_what_it_does():
    shown = verdict(PAUSED | {"resume": {"ok": True}, "history": ["10:12 Paused: Workday won't leave its step"]})

    assert (shown["tone"], shown["kind"]) == ("needs", "handoff")
    assert shown["resume"] == {"ok": True, "why": ""}
    assert "press Resume" in shown["then"] and "never presses Submit" in shown["then"]
    assert "10:12 Paused" in shown["detail"]


def test_resume_in_the_window_goes_to_the_paused_worker_once_and_its_item_waits_no_more():
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **PAUSED, resume={"ok": True})
        [item] = board.state()["items"]
        assert item["resume"] == {"ok": True, "why": ""}

        reply = json.loads(post_resume(board, item["id"]).read())

        assert "Resuming" in reply["message"]
        assert board.resumed(0) and not board.resumed(0)  # each press is given once
        board.update(0, **{k: v for k, v in PAUSED.items() if k != "status"}, status="filling")
        assert [i for i in board.state()["items"] if not i.get("answered")] == []  # the form fills again


def test_resume_says_why_when_the_tab_is_gone_and_refuses_another_site():
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **PAUSED, resume={"ok": False, "why": rehearsal.TAB_CLOSED})
        [item] = board.state()["items"]

        with pytest.raises(urllib.error.HTTPError) as gone:
            post_resume(board, item["id"])
        with pytest.raises(urllib.error.HTTPError) as other:
            post_resume(board, "tile-0", token="guessed")

    assert gone.value.code == 409 and json.loads(gone.value.read())["error"] == rehearsal.TAB_CLOSED
    assert other.value.code == 403
    assert not board.resumed(0)


def test_the_paused_card_and_tile_show_resume_and_a_gone_tab_says_why(window):
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **PAUSED, resume={"ok": True})
        window.goto(board.url)
        card = "#inbox .item:has-text('Xcel Energy')"
        window.wait_for_selector(f"{card} button.primary:has-text('Resume')", timeout=10_000)
        window.click(f"{card} button:has-text('Resume')")
        window.wait_for_selector("#toast:has-text('Resuming')", timeout=10_000)
        assert board.resumed(0)

        board.update(0, **PAUSED, resume={"ok": False, "why": rehearsal.TAB_CLOSED})
        window.wait_for_selector(f"{card} button:has-text('Resume'):disabled", timeout=10_000)
        assert window.locator(f"{card} .then").inner_text() == rehearsal.TAB_CLOSED
        assert window.locator("#resume-0 button").is_disabled()
        assert window.locator("#resume-0 .why").inner_text() == rehearsal.TAB_CLOSED
