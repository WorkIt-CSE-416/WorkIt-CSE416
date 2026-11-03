"""Resume (KAN-551): a rehearsal that stops mid-form for Lisul waits on its
open page. He fixes the page himself and presses Resume, and Apply goes on
from the step the page shows, keeping his fix, to the form's last page.
Nothing is ever submitted. When the form's tab is gone, Resume says so."""

from fake_workday import EXPERIENCE_STEPS, FakeWorkdayServer
from fakes import RecordingBoard
from test_employer_accounts import XCEL_FORM, XCEL_URL
from test_rehearse import NeverSubmittingWorkday, adapters, experience_profile

from apply import rehearsal
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
