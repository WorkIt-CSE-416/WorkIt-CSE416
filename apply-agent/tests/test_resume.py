"""Resume (KAN-551): a rehearsal that stops mid-form for Lisul waits on its
open page. He fixes the page himself and presses Resume, and Apply goes on
from the step the page shows, keeping his fix, to the form's last page.
Nothing is ever submitted. When the form's tab is gone, Resume says so."""

import _thread
import json
import urllib.error
import urllib.request
from urllib.parse import parse_qs

import pytest
from fake_workday import EXPERIENCE_STEPS, FakeWorkdayServer
from fakes import RecordingBoard
from test_dashboard import NoFrames, window  # noqa: F401 (a fixture)
from test_employer_accounts import XCEL_FORM, XCEL_URL
from test_rehearse import GOOGLE, NeverSubmittingWorkday, adapters, experience_profile
from test_run_answers import profile_with

from apply import rehearsal, worker
from apply.dashboard import Dashboard, verdict
from apply.fillers import FILLERS
from apply.profile import ApplicantProfile
from apply.records import FolderRecords

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


def test_resume_on_a_sign_in_page_waits_for_lisul_to_sign_in_and_signs_in_no_more(monkeypatch, tmp_path):
    # Google asks for a password: Apply never types it, and Resume can't go on until he has signed in.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)

    class Lisul(RecordingBoard):
        pressed = 0

        def resumed(self, worker):
            self.pressed += 1
            return self.pressed == 1  # he presses Resume before he has signed in

        def answered(self, worker):
            if self.pressed > 1 and (self.captions[worker].get("resume") or {}).get("why") and not handed[-1].is_closed():
                handed[-1].close()
            return []

    board, lines = Lisul(), []
    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        [done] = rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(
            profile_with(tmp_path, GOOGLE)), 1, keep_open=True, out=lines.append)

    assert done.outcome == "handoff" and "Google asked for more than an account pick" in done.why
    assert board.captions[0]["resume"]["why"] == rehearsal.TAB_CLOSED  # then he closed the tab
    assert any("can't resume yet: The form isn't on an application step yet" in line for line in lines)
    assert len(handed) == 1 and server.created == [] and server.submissions == []


# A button that "sends" on the held page, by Lisul: a sign-in form's (Workday's Sign in with email names its
# button Submit), or one on no account form, as an application's own Submit is.
SIGN_IN_SUBMIT = """() => { const f = document.createElement('form'); f.onsubmit = (e) => e.preventDefault();
    f.innerHTML = '<input type=password><button type=button id=his-press>Submit</button>'; document.body.prepend(f); }"""
APPLICATION_SUBMIT = """() => { const b = document.createElement('button'); b.type = 'button'; b.id = 'his-press';
    b.textContent = 'Submit'; document.body.prepend(b); }"""


def signing_in_himself(monkeypatch, captcha: bool = False, press: str = ""):
    """Lisul at a Workday sign-in that Google paused (it asks for his password): on the held page, he signs in
    himself, and Google sends him back to Workday signed in. He never presses Resume. With `captcha`, a captcha
    shows on Google's page first; with `press` (a script that adds it), he presses a button that sends there.
    Once the fill ends, or he has waited a while, he closes the tab."""
    handed, back = handed_pages(monkeypatch), []
    real = FakeWorkdayServer._google_page

    def google_page(self, route, parts):
        if parts.path == "/v3/signin/accountchooser":
            back.append(parse_qs(parts.query)["continue"][0])  # where Google sends him once he is signed in
        return real(self, route, parts)
    monkeypatch.setattr(FakeWorkdayServer, "_google_page", google_page)

    class Lisul(RecordingBoard):
        turns, typed, resume = 0, [], {}

        def resumed(self, worker):
            return False  # he never presses it

        def answered(self, worker):  # each turn of the held page, on its own thread
            if not handed:
                return []
            page, self.turns = handed[-1], self.turns + 1
            if page.is_closed():
                return []
            history = " ".join(self.captions[worker].get("history") or [])
            if "Went on by itself" in history and self.captions[worker].get("status") != "filling" or self.turns > 40:
                page.close()
            elif "accounts.google.com" in page.url and self.turns == 2:
                if captcha:
                    page.evaluate("""() => { const f = document.createElement('iframe');
                        f.src = 'https://www.google.com/recaptcha/api2/bframe'; document.body.appendChild(f); }""")
                self.typed = [box.input_value() for box in page.locator("input[type=password]").all()]
                if press:
                    page.evaluate(press)
                    page.click("#his-press")
            elif "accounts.google.com" in page.url and self.turns == 3:
                self.resume = dict(self.captions[worker].get("resume") or {})  # as the window shows it after his press
            elif "accounts.google.com" in page.url and self.turns == 4:
                page.goto(back[0])  # he typed his password; Google sends him back
            return []
    return Lisul(), handed


def test_a_form_paused_at_sign_in_goes_on_by_itself_once_lisul_signs_in(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    board, handed = signing_in_himself(monkeypatch)
    lines = []
    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        [first] = rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(
            profile_with(tmp_path, GOOGLE)), 1, keep_open=True, out=lines.append)

    assert first.outcome == "handoff" and "Google asked for more than an account pick" in first.why
    history = board.captions[0]["history"]
    assert [h.split(" ", 1)[1].split(":")[0] for h in history][:2] == ["Paused", "Went on by itself"], history
    # With no Resume, the form was read and filled past sign-in, to a step that waits on him for its own reason.
    assert "Paused: Workday won't leave its 'My Information' step" in history[2]
    assert board.typed == [""]  # Apply typed nothing into Google's sign-in page
    assert len({id(page) for page in handed}) <= 2 and server.created == [] and server.submissions == []


def test_a_sign_in_forms_submit_pressed_on_the_held_page_still_lets_apply_go_on(monkeypatch, tmp_path):
    # NVIDIA's Workday, live (KAN-688): his press of the sign-in form's Submit was taken for the application's,
    # and neither Resume nor going on by itself ever happened again on that page.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    board, _ = signing_in_himself(monkeypatch, press=SIGN_IN_SUBMIT)
    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(
            profile_with(tmp_path, GOOGLE)), 1, keep_open=True, out=[].append)

    assert board.resume == {"ok": True}  # Resume is still offered after his press
    history = board.captions[0]["history"]
    assert [h.split(" ", 1)[1].split(":")[0] for h in history][:2] == ["Paused", "Went on by itself"], history
    assert server.created == [] and server.submissions == []


def test_his_own_submit_on_the_held_page_ends_resume_and_the_window_says_so(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    board, _ = signing_in_himself(monkeypatch, press=APPLICATION_SUBMIT)
    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(
            profile_with(tmp_path, GOOGLE)), 1, keep_open=True, out=[].append)

    assert board.resume == {"ok": False, "why": rehearsal.SENT}  # the window refuses Resume, saying why
    assert not any("Went on by itself" in h for h in board.captions[0]["history"])  # the form is his to send


def test_the_window_refuses_resume_once_he_pressed_submit():
    with Dashboard(1, NoFrames()) as board:
        board.update(0, **PAUSED, resume={"ok": False, "why": rehearsal.SENT})
        with pytest.raises(urllib.error.HTTPError) as sent:
            post_resume(board, "tile-0")
    assert sent.value.code == 409 and json.loads(sent.value.read())["error"] == rehearsal.SENT
    assert not board.resumed(0)


def test_a_captcha_on_the_sign_in_page_stops_apply_going_on_by_itself(monkeypatch, tmp_path):
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    board, _ = signing_in_himself(monkeypatch, captcha=True)
    lines = []
    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        rehearsal.rehearse([XCEL_URL], adapters(server, board=board), ApplicantProfile.load(
            profile_with(tmp_path, GOOGLE)), 1, keep_open=True, out=lines.append)

    assert any(rehearsal.CAPTCHA_SHOWED in line for line in lines)
    assert not any("Went on by itself" in h for h in board.captions[0]["history"])
    assert board.captions[0]["resume"]["why"] == rehearsal.TAB_CLOSED  # it waited for him, until he closed the tab
    assert server.created == [] and server.submissions == []


def test_a_filler_with_no_signed_in_check_never_goes_on_by_itself():
    class Plain:
        def resume_blocked(self, page):
            return ""
    check = worker.ResumeCheck(Plain())
    assert check.signed_in is None and check("page") == ""
    assert worker.ResumeCheck(object())("page") == ""


def test_a_paused_rehearsal_saves_its_record_while_its_page_is_held(monkeypatch, tmp_path):
    # HPE and Cohesity (2026-11-03): Workday wouldn't leave Application Questions, and the pause wrote no Record.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)
    records, seen = FolderRecords(tmp_path / "rehearsals"), []

    class Lisul(RecordingBoard):
        def answered(self, worker):  # the page is held for him: its Record is there already, then he closes it
            if handed and not handed[-1].is_closed():
                seen.extend(tmp_path.glob("rehearsals/*/*/form.png"))
                handed[-1].close()
            return []

    world = experience_profile()
    with FakeWorkdayServer(XCEL_FORM, steps=EXPERIENCE_STEPS) as server:
        [done] = rehearsal.rehearse([XCEL_URL], adapters(server, board=Lisul(), records=records),
                                    ApplicantProfile.load(world.profile), 1, keep_open=True, out=lambda line: None)

    assert done.outcome == "handoff" and "won't leave its 'My Experience' step" in done.why
    [png] = seen
    assert png.stat().st_size > 0
    assert "- Status: handoff" in (png.parent / "README.md").read_text()
    assert done.record == str(png.parent)
    assert server.submissions == []


def test_a_shutdown_while_a_page_is_held_keeps_its_records_screenshot(monkeypatch, tmp_path):
    # Visa, Northrop and Zillow (2026-11-03): held at sign-in, and the shutdown's Ctrl-C quit Chrome too. The
    # Record saved after it screenshotted no page, and an empty form.png took the place of the good one.
    monkeypatch.setitem(FILLERS, "workday", NeverSubmittingWorkday)
    handed = handed_pages(monkeypatch)
    records, at_pause = FolderRecords(tmp_path / "rehearsals"), []

    class Shutdown(RecordingBoard):
        def answered(self, worker):  # the page held: SIGTERM (rehearse hears it as Ctrl-C), and Chrome goes with it
            if handed and not handed[-1].is_closed():
                at_pause.extend(png.read_bytes() for png in tmp_path.glob("rehearsals/*/*/form.png"))
                handed[-1].context.close()
                _thread.interrupt_main()
            return []

    with FakeWorkdayServer(XCEL_FORM, google="password") as server:
        [done] = rehearsal.rehearse([XCEL_URL], adapters(server, board=Shutdown(), records=records),
                                    ApplicantProfile.load(profile_with(tmp_path, GOOGLE)), 1, keep_open=True,
                                    out=lambda line: None)

    [png] = tmp_path.glob("rehearsals/*/*/form.png")
    assert at_pause and at_pause[0] and png.read_bytes() == at_pause[0]
    assert done.saved.filled.screenshot == at_pause[0]  # the Record after the shutdown keeps what the pause saw
    assert "- Status: handoff" in (png.parent / "README.md").read_text()
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
