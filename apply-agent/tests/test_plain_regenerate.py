"""S9 (KAN-615): Add context and regenerate (KAN-599) on a plain Worker's held page. The button, its
context box, the field's lock and the read-back are fixed functions (apply.plain.fixed), never eval,
and the Fill engine puts the new answer in. Runs the fake Ashby form (Harvey, an essay) in one plain
Worker (Chrome for Testing, no CDP), reused from a first rehearsal; skips without Chrome for Testing
(CI). Nothing is ever submitted."""

import json
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

import fakes
import pytest
from conftest import ARC_FORM, ARC_URL, HARVEY_FORM, HARVEY_URL
from fakes import FakeClaude, FakeJobServer, RecordingBoard
from plain_fakes import https_fake
from test_plain_routing import UPLOADS, _uploading, needs_chrome
from test_regenerate import CONTEXT, EARLIER, LATER
from test_rehearse import NeverSubmits, adapters, rehearsal_record
from test_run_answers import profile_with

from apply import fill_engine, home, regenerate, rehearsal
from apply.ashby import AshbyFiller
from apply.fillers import FILLERS
from apply.greenhouse import GreenhouseFiller
from apply.plain import fixed
from apply.plain.bridge import Bridge
from apply.plain.launcher import PlainWorkers
from apply.plain.site import PlainSite
from apply.profile import ApplicantProfile
from apply.records import FolderRecords

WHY = "Why are you interested in working at Harvey?"
# Written again from the window's card the second time.
AGAIN = f"{FakeClaude.OPENINGS[2]}{FakeClaude.DRAFT[1:]} {FakeClaude.MORE[1]} {FakeClaude.MORE[3]}"


def test_the_regenerate_page_code_is_fixed_functions_on_a_plain_page():
    for code in (regenerate.OFFER, regenerate.WORKING, regenerate.DONE, regenerate.SHOWN):
        assert fixed.lookup(code)[1] == "MAIN"  # where the page's __applyRegenerate binding is
    assert regenerate.script([{"name": "why", "text": "x", "kind": "essay"}]).startswith("((written) =>")


def test_a_plain_page_gets_no_init_script_and_skips_captcha_frames():
    calls = []

    class Frame:
        def __init__(self, url):
            self.url = url

        def evaluate(self, code, arg=None):
            calls.append((self.url, code, arg))
            return True

    page = Frame("https://jobs.ashbyhq.com/harvey/1/application")
    page.plain = True
    page.frames = [page, Frame("https://www.google.com/recaptcha/api2/anchor"), Frame("https://jobs.ashbyhq.com/x")]
    page.context = SimpleNamespace(add_init_script=lambda *a: pytest.fail("a plain page has no init script for it"))
    page.expose_binding = lambda name, callback: calls.append(("bound", name, None))
    regenerate.offer(page, [{"name": "why", "text": "x"}], lambda name, context: None)
    assert ("bound", "__applyRegenerate", None) in calls
    assert [url for url, code, _ in calls if code == regenerate.OFFER] == [page.url, "https://jobs.ashbyhq.com/x"]


@pytest.fixture
def plain_site(monkeypatch):
    """The fake Arc and Harvey forms from an HTTPS server every host resolves to, in one plain Worker."""
    monkeypatch.setattr(fakes._UploadStore, "url", property(lambda self: UPLOADS))
    folder = Path(tempfile.mkdtemp(prefix="apw-s9-", dir="/tmp"))  # short: a socket path is capped at 104 bytes
    with FakeJobServer(ARC_FORM, HARVEY_FORM) as fake, https_fake(_uploading(fake)) as port:
        flags = (f"--host-resolver-rules=MAP * 127.0.0.1:{port}", "--ignore-certificate-errors", "--disable-quic")
        site = PlainSite(PlainWorkers(folder, kind="testing", bridge=Bridge(folder / "w.sock"), test_flags=flags))
        site.fetch = fake.fetch
        try:
            yield site, fake
        finally:
            site.close()
            shutil.rmtree(folder, ignore_errors=True)


@needs_chrome
def test_add_context_and_regenerate_on_a_plain_worker(monkeypatch, tmp_path, plain_site):
    site, fake = plain_site
    monkeypatch.setitem(FILLERS, "greenhouse", NeverSubmits(GreenhouseFiller()))
    monkeypatch.setitem(FILLERS, "ashby", NeverSubmits(AshbyFiller()))
    profile = ApplicantProfile.load(profile_with(tmp_path))
    # A first Application in the Worker: the second reuses its Chrome.
    rehearsal.rehearse([ARC_URL], adapters(site), profile, 1, keep_open=False, out=lambda line: None)
    pid = site.workers.running[0].pid

    claude = FakeClaude(essays={WHY: [EARLIER, LATER, AGAIN]})
    refills, fill = [], fill_engine.fill

    def engine_fill(page, job, questions, answers, options=None):
        shown = fill(page, job, questions, answers, options)
        if len(questions) == 1 and questions[0].label == WHY:  # regenerate's refill, not the form's fill
            refills.append((job, page.plain, answers, shown))
        return shown
    monkeypatch.setattr(fill_engine, "fill", engine_fill)
    pages, seen = [], {}
    lift = rehearsal.lift
    monkeypatch.setattr(rehearsal, "lift", lambda page, **more: (pages.append(page), lift(page, **more))[1])

    class Board(RecordingBoard):
        step = "page"  # pressed on the page, then in the window
        window: list = []

        def regenerations(self, worker):  # the window's card (Dashboard.regenerate hands it here)
            asked, self.window = self.window, []
            return asked

        def answered(self, worker):  # on the held page's own thread, every half second
            if not pages:
                return []
            page, [written] = pages[0], [w for w in self.captions[worker]["written"] if w["label"] == WHY]
            field = page.locator(f'[data-apply-written="{written["name"]}"]')
            mine = page.locator(f'#apply-regenerate [data-for="{written["name"]}"]')
            if self.step == "page":
                field.wait_for(timeout=10_000)
                seen["before"], seen["plain"] = field.input_value(), page.plain
                field.scroll_into_view_if_needed()
                mine.get_by_role("button", name="Add context and regenerate").click()
                mine.locator("textarea").fill(CONTEXT)
                mine.get_by_role("button", name="Regenerate", exact=True).click()
                self.step = "pressed"
            elif self.step == "pressed" and not written["state"]:  # written again
                seen["after"], seen["editable"] = field.input_value(), field.is_editable()
                seen["note"] = mine.inner_text()
                self.window, self.step = [(written["name"], "Say it shorter.")], "window"
            elif self.step == "window" and not written["state"] and written["text"] == AGAIN:
                seen["again"] = field.input_value()
                page.close()  # Lisul is done with it
            return []

        def update(self, worker, **caption):
            for w in caption.get("written") or []:
                if w.get("state") == "working" and pages:
                    field = pages[0].locator(f'[data-apply-written="{w["name"]}"]')
                    seen.setdefault("locked", []).append(not field.is_editable())
            super().update(worker, **caption)

    board, lines = Board(), []
    rehearsal.rehearse([HARVEY_URL], adapters(site, claude, board=board, records=FolderRecords(tmp_path / "rehearsals")),
                       profile, 1, keep_open=True, out=lines.append)

    assert seen["plain"] is True and site.workers.running[0].pid == pid  # the same plain Chrome carried both
    assert seen["before"] == EARLIER
    assert len(seen["locked"]) >= 2 and all(seen["locked"])  # read-only while Claude wrote it, each time
    assert seen["after"] == LATER and seen["editable"] is True  # the new answer, read back, his to edit
    assert "New answer from your context" in seen["note"]
    assert seen["again"] == AGAIN  # pressed in the window: the same field, on the plain page
    # The Fill engine put each new answer in, on the plain page, and read it back.
    assert [(job, plain, list(answers.values()), list(shown.values())) for job, plain, answers, shown in refills] == \
        [("ashby", True, [LATER], [LATER]), ("ashby", True, [AGAIN], [AGAIN])]
    [written] = [w for w in board.captions[0]["written"] if w["label"] == WHY]
    assert (written["text"], written["kind"], written["state"]) == (AGAIN, "essay", "")
    assert sum(f"regenerated '{WHY}' with your context" in line for line in lines) == 2
    assert any(line.startswith(f'- For "{WHY}"') and CONTEXT in line for line in home.STORY_BANK.read_text().splitlines())
    record = rehearsal_record(tmp_path)
    [row] = [r for r in json.loads((record / "answers.json").read_text()) if r["question"] == WHY]
    assert row["planned"] == row["on_page"] == AGAIN  # the Record keeps the newest answer
    assert f"Regenerated '{WHY}' with your context" in (record / "README.md").read_text()
    assert AGAIN in (record / "essays.md").read_text()
    assert fake.submissions == []
