"""The dashboard: one window with a live tile per Worker, served on
127.0.0.1. Its frames come from a frame source; here a fake one."""

import base64
import json
import queue
import struct
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from apply import dashboard, rehearsal, worker
from apply.browsers import WorkerBrowsers
from apply.dashboard import (
    READY,
    CdpFrames,
    Dashboard,
    NoFrames,
    grid,
    is_view,
    jpeg_size,
    raise_window,
    summary,
    to_page,
    verdict,
)

JPEG = b"\xff\xd8\xff\xe0 a frame"


class FakeFrames:
    """Stands in for the dashboard's own CDP connection to each Worker's Chrome."""

    def __init__(self, frames: dict[int, bytes]):
        self.frames = frames
        self.inputs: list[tuple[int, dict]] = []

    def frame(self, worker: int) -> bytes | None:
        return self.frames.get(worker)

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        frame = self.frames.get(worker)
        return (frame, after + 1) if frame else (None, after)

    def input(self, worker: int, event: dict) -> None:
        self.inputs.append((worker, event))

    def chooser(self, worker: int) -> str | None:
        return None


class TickingFrames(FakeFrames):
    """A new frame for every Worker five times a second, as a busy screencast sends them."""

    def wait(self, worker: int, after: int, timeout: float) -> tuple[bytes | None, int]:
        tick = lambda: int(time.monotonic() * 5)
        if tick() <= after:
            time.sleep(min(timeout, 0.2))
        return self.frames.get(worker), tick()


@pytest.fixture
def window():
    """The dashboard's window: a page in a throwaway headless Chromium."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page(viewport={"width": 900, "height": 600})
        finally:
            browser.close()


def jpeg(width: int, height: int) -> bytes:
    """The start of a baseline JPEG of that size: SOI, then a SOF0 segment."""
    return b"\xff\xd8\xff\xe0\x00\x04ab\xff\xc0\x00\x11\x08" + height.to_bytes(2, "big") + width.to_bytes(2, "big") + b"\x03"


def get(url: str) -> tuple[int, str, bytes]:
    with urllib.request.urlopen(url) as response:
        return response.status, response.headers["Content-Type"], response.read()


@pytest.mark.parametrize("workers, cells", [(1, (1, 1)), (2, (2, 1)), (3, (2, 2)), (4, (2, 2)), (5, (3, 2)), (9, (3, 3))])
def test_tiles_make_a_grid_of_ceil_sqrt_columns(workers, cells):
    assert grid(workers) == cells


def test_the_page_has_a_tile_per_worker_in_its_grid():
    with Dashboard(3, FakeFrames({})) as board:
        status, kind, page = get(board.url + "/")

    assert (status, kind.split(";")[0]) == (200, "text/html")
    assert page.decode().count('class="tile"') == 3
    assert "repeat(2, minmax(0, 1fr))" in page.decode()  # 3 Workers: 2 columns, 2 rows


def test_the_window_says_sample_data_while_apply_runs_as_the_sample_applicant():
    with Dashboard(1, FakeFrames({}), sample=True) as board:
        assert ">Sample data<" in get(board.url + "/")[2].decode()
    with Dashboard(1, FakeFrames({})) as board:
        assert "Sample data" not in get(board.url + "/")[2].decode()


def test_each_workers_latest_frame_is_served_as_a_jpeg():
    with Dashboard(2, FakeFrames({0: JPEG})) as board:
        assert get(board.url + "/frame/0") == (200, "image/jpeg", JPEG)
        assert get(board.url + "/frame/1")[0] == 204  # no frame yet


def test_each_worker_streams_live_as_mjpeg():
    with Dashboard(2, FakeFrames({1: JPEG})) as board:
        with urllib.request.urlopen(board.url + "/stream/1") as response:
            kind = response.headers["Content-Type"]
            parts = response.read(3 * (len(JPEG) + 80)).split(b"--frame")

    assert kind == "multipart/x-mixed-replace; boundary=frame"
    assert parts[1].startswith(b"\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(JPEG) + JPEG)


def test_every_workers_frames_come_on_one_stream():
    with Dashboard(2, FakeFrames({0: JPEG, 1: JPEG + b"!"})) as board:
        with urllib.request.urlopen(board.url + "/frames") as response:
            data = response.read(2 * (8 + len(JPEG)) + 1)

    first, second = data[:8 + len(JPEG)], data[8 + len(JPEG):]
    assert first == struct.pack(">II", 0, len(JPEG)) + JPEG
    assert second == struct.pack(">II", 1, len(JPEG) + 1) + JPEG + b"!"


def test_a_tile_never_gets_more_frames_than_the_window_can_draw():
    # FakeFrames has a new frame on every call, as six busy screencasts can.
    with Dashboard(1, FakeFrames({0: JPEG})) as board:
        with urllib.request.urlopen(board.url + "/frames") as response:
            started = time.monotonic()
            response.read(10 * (8 + len(JPEG)))

    assert time.monotonic() - started >= 9 * dashboard.FRAME_GAP


def test_the_window_shows_the_frames_it_streams(window):
    shot = window.screenshot(type="jpeg")
    with Dashboard(2, TickingFrames({1: shot})) as board:
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('frame-1').naturalWidth > 0", timeout=10_000)


def test_captions_say_what_each_worker_is_on():
    with Dashboard(2, FakeFrames({})) as board:
        board.update(1, company="Arc Boat Company", role="Software Engineering Intern", job_system="greenhouse",
                     status="filling")
        board.update(1, status="ready to submit", line="Arc Boat Company | ... | ready to submit")
        _, kind, state = get(board.url + "/state")

    assert kind == "application/json"
    tiles = json.loads(state)["tiles"]
    assert tiles == [
        {"tone": "idle", "label": "Waiting for the next job", "detail": ""},
        {"company": "Arc Boat Company", "role": "Software Engineering Intern", "job_system": "greenhouse",
         "status": "ready to submit", "line": "Arc Boat Company | ... | ready to submit",
         "tone": "ready", "label": READY, "detail": dashboard.verdict({"status": "ready to submit"})["detail"],
         "kind": "ready to submit", "system": "Greenhouse"},
    ]


CALIBRATION = "Calibration run: Application 4 of 10, held so you can judge Claude's answers"


@pytest.mark.parametrize("caption, tone, label", [
    ({"status": "filling"}, "filling", "Filling"),
    ({"status": rehearsal.READY, "why": CALIBRATION}, "ready", "Filled, not sent"),
    ({"status": rehearsal.READY, "why": "", "missing": ["Pronouns", "Expected graduation term"]},
     "needs", "Answer a question only you know"),
    ({"status": rehearsal.READY, "why": f"Not filled: school--0: two Stony Brooks; {CALIBRATION}"},
     "needs", "Fix an answer before it's sent"),
    ({"status": rehearsal.READY, "why": "Pre-submit check failed. phone reads 555"},
     "needs", "Fix an answer before it's sent"),
    ({"status": rehearsal.READY, "why": f"Yours to tick: I certify that all of the above information is true; {CALIBRATION}"},
     "needs", "Tick or sign what is yours before it's sent"),
    ({"status": rehearsal.SIGN_IN, "why": "jobs.example.com wants a password", "company": "Zipline",
      "job_system": "workday"}, "needs", "Sign in to Zipline's Workday site once"),
    ({"status": "handoff", "why": "Claude fill can't finish this form: a captcha"}, "needs", "Finish this one yourself"),
    ({"status": "held", "why": "Target company: Stripe"}, "needs", "Review and approve before it's sent"),
    ({"status": "missing fact", "why": "Missing fact: Pronouns"}, "needs", "Answer a question only you know"),
    ({"status": rehearsal.FAILED, "why": "TimeoutError: page never loaded"}, "failed",
     "Couldn't finish: the page took too long to respond"),
    ({"status": rehearsal.FAILED, "why": "Not a job posting: a careers home page."}, "failed",
     "Couldn't finish: Not a job posting: a careers home page"),
    ({"status": "not eligible", "why": "Master's only"}, "ended", "Skipped: you don't qualify (Master's only)"),
    ({"status": "closed", "why": ""}, "ended", "Skipped: no longer taking applications"),
    ({"status": "submitted", "why": ""}, "submitted", "Sent"),
    ({"status": "submitted", "why": "", "missing": ["Pronouns"]}, "submitted", "Sent"),
    ({}, "idle", "Waiting for the next job"),
])
def test_each_tile_says_at_a_glance_how_its_application_went(caption, tone, label):
    assert (verdict(caption)["tone"], verdict(caption)["label"]) == (tone, label)


def test_a_failure_says_what_happened_in_plain_words_with_the_raw_error_kept_for_details():
    shown = verdict({"status": rehearsal.FAILED, "why": "TimeoutError: Page.goto: Timeout 30000ms exceeded"})

    assert shown["detail"] == "Nothing was sent. Apply keeps a note to fix this and tries again"
    assert shown["error"] == "TimeoutError: Page.goto: Timeout 30000ms exceeded"
    assert "error" not in verdict({"status": rehearsal.FAILED, "why": "Not a job posting."})


@pytest.mark.parametrize("key, name", [("greenhouse", "Greenhouse"), ("smartrecruiters", "SmartRecruiters"),
                                       ("workday", "Workday"), ("newsite", "Newsite")])
def test_a_job_system_shows_by_its_proper_name(key, name):
    assert verdict({"status": "filling", "job_system": key})["system"] == name


def test_another_tiles_file_bar_never_covers_the_enlarged_tile(window):
    with Dashboard(2, TickingFrames({0: jpeg(1280, 800), 1: jpeg(1280, 800)})) as board:
        window.goto(board.url + "/#workers")
        window.evaluate("document.getElementById('file-1').hidden = false")
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big[data-k='0']")

        assert not window.is_visible("#file-1")


def test_filled_not_sent_and_sent_never_share_a_colour(window):
    with Dashboard(2, FakeFrames({})) as board:
        board.update(0, status=rehearsal.READY)
        board.update(1, status="submitted")
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('banner-1').className.includes('submitted')", timeout=10_000)
        colours = [window.eval_on_selector(f"#banner-{k}", "e => getComputedStyle(e).backgroundColor") for k in (0, 1)]

        assert colours[0] != colours[1]


def test_the_enlarged_tile_keeps_a_failures_raw_error_behind_details(window):
    with Dashboard(1, TickingFrames({0: jpeg(1280, 800)})) as board:
        board.update(0, status=rehearsal.FAILED, why="TimeoutError: Page.goto: Timeout 30000ms exceeded")
        window.goto(board.url + "/#workers")
        window.wait_for_selector("#detail-0 details", state="attached")
        window.click(".tile[data-k='0'] img")

        assert window.inner_text("#detail-0 summary") == "Details"
        assert window.eval_on_selector("#detail-0 details", "e => e.open") is False
        window.click("#detail-0 summary")
        assert "Page.goto: Timeout 30000ms" in window.inner_text("#detail-0 details")


RAW = ["held", "missing fact", "handoff", "needs sign-in", "ready to submit", "not eligible", "Error", "Exception"]


@pytest.mark.parametrize("status, why", [
    ("held", "Target company: Stripe; High-stakes essay: 'Why Stripe?'"), ("missing fact", "Missing fact: Pronouns"),
    ("handoff", "a captcha"), (rehearsal.SIGN_IN, "jobs.example.com wants a password"), (rehearsal.READY, CALIBRATION),
    (rehearsal.FAILED, "TimeoutError: Page.goto: Timeout 30000ms exceeded"), ("not eligible", "Master's only"),
    (rehearsal.FAILED, "KeyError: 'name'"), ("paused", ""), ("closed", ""),
])
def test_no_tile_label_shows_a_raw_status_or_an_error_class(status, why):
    label = verdict({"status": status, "why": why})["label"]
    assert not [raw for raw in RAW if raw in label], label


def test_a_needs_you_tile_says_what_to_do_why_and_what_then_happens():
    held = verdict({"status": "held", "why": f"Target company: Stripe; High-stakes essay: 'Why Stripe?'; {CALIBRATION}"})

    assert (held["kind"], held["do"]) == ("held", "Review and approve before it's sent")
    assert held["why"] == ("Stripe is on your check-first list; it has an essay about the company ('Why Stripe?'); "
                           "it's one of your first 10 applications (4 of 10), so you can check Claude's answers")
    assert held["then"].startswith("Approve it here")
    asked = verdict({"status": "missing fact", "why": "Missing fact: Do you have a driver's license?"})
    assert (asked["kind"], asked["why"]) == ("missing fact", "Do you have a driver's license?")


def test_a_ready_tile_keeps_why_a_run_would_hold_it_for_its_detail():
    detail = verdict({"status": rehearsal.READY, "why": CALIBRATION})["detail"].splitlines()
    assert detail[0].startswith("Nothing has been sent. This page is yours now")
    assert detail[1] == ("In a real run this would wait for your OK: it's one of your first 10 applications (4 of 10), "
                         "so you can check Claude's answers")


DRAFTED = ["Do you have housing within 30 miles of our office? → Yes", "Skill areas → Software, Robotics"]


def test_a_tile_lists_what_claude_drafted_under_its_verdict():
    submitted = verdict({"status": "submitted", "why": "", "drafted": DRAFTED})
    held = verdict({"status": "held", "why": "Target company", "drafted": DRAFTED[:1]})

    assert (submitted["tone"], submitted["label"]) == ("submitted", "Sent")  # a draft needs no one by itself
    assert submitted["detail"] == f"{dashboard.DRAFTED}\n{DRAFTED[0]}\n{DRAFTED[1]}"
    assert held["detail"].splitlines() == ["Target company", held["then"], dashboard.DRAFTED, DRAFTED[0]]


def test_the_enlarged_tile_shows_each_drafted_answer_on_its_own_line(window):
    with Dashboard(2, TickingFrames({0: jpeg(1280, 800)})) as board:
        board.update(0, company="MetOx", status="submitted", why="", drafted=DRAFTED)
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('banner-0').className.includes('submitted')", timeout=10_000)
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big[data-k='0'] .detail", state="visible")

        assert window.inner_text("#detail-0").splitlines() == [dashboard.DRAFTED, *DRAFTED]


def test_a_hold_stays_listed_after_its_worker_takes_the_next_application():
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, company="Stripe", role="SWE Intern", posting_url="https://stripe.example/1", status="filling")
        board.update(0, status="held", why="Target company: Stripe")
        board.update(0, company="Arc", role="Intern", posting_url="https://arc.example/2", status="filling", why="")
        state = board.state()

    [held] = state["items"]
    assert (held["company"], held["status"], held["tone"], held["kind"]) == ("Stripe", "held", "needs", "held")
    assert state["tiles"][0]["company"] == "Arc" and not state["tiles"][0]["why"]
    assert state["summary"] == "nothing sent yet · 1 needs you · 1 filling"


def test_an_application_ending_again_takes_the_place_of_its_last_item():
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, company="Arc", role="Intern", posting_url="https://arc.example/2", status="filling")
        board.update(0, status=rehearsal.READY)
        board.update(0, status="submitted", why="you submitted it yourself")
        board.update(0, company="Rhombus", role="Intern", posting_url="https://rhombus.example/3", status="filling")
        board.update(0, status="submitted")
        items = board.state()["items"]

    assert [(i["company"], i["status"]) for i in items] == [("Rhombus", "submitted"), ("Arc", "submitted")]
    assert board.state()["summary"].startswith("2 sent")


def test_the_windows_title_counts_what_waits_on_lisul(window):
    with Dashboard(2, FakeFrames({})) as board:
        board.update(0, company="Stripe", status="held", why="Target company: Stripe")
        board.update(1, company="Cohere", status="missing fact", why="Missing fact: Pronouns")
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.title === 'Apply (2)'", timeout=10_000)


def test_a_line_on_top_sums_up_every_tile():
    tiles = [{"status": s} | verdict({"status": s}) for s in
             [rehearsal.READY] * 4 + ["handoff", rehearsal.FAILED, "filling", "not eligible", ""]]
    assert summary(tiles) == "nothing sent yet · 1 needs you · 1 filling · 4 filled, not sent · 1 couldn't finish · 1 skipped"
    assert summary([{"status": "held", "tone": "needs"}] * 2 + [{"status": "submitted", "tone": "submitted"}]) \
        == "1 sent · 2 need you"
    assert summary([{"tone": "idle"}]) == "nothing sent yet"


def test_the_window_shows_each_verdict_and_keeps_a_long_reason_inside_its_tile(window):
    why = "Claude fill can't finish this form: " + "the posting opened a sign-in page in a new tab " * 20
    window.set_viewport_size({"width": 480, "height": 320})  # a small window, six tiles
    with Dashboard(6, FakeFrames({})) as board:
        board.update(0, company="Rhombus", status=rehearsal.READY, why=CALIBRATION, filled=17, asked=18, missing=[])
        board.update(4, company="TikTok", status="handoff", why=why)
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('banner-4').className.includes('needs')", timeout=10_000)

        assert window.inner_text("#banner-0 .label") == READY
        assert window.inner_text("#banner-0 .fields") == "17 of 18 answers"
        assert window.get_attribute("#banner-4", "title") == f"Finish this one yourself\n{why.strip()}\n" \
            "Nothing was sent. Open it and finish the form, then press Submit"
        label = window.eval_on_selector("#banner-4 .label", "e => [e.scrollWidth > e.clientWidth, e.getBoundingClientRect().right]")
        tile = window.eval_on_selector(".tile[data-k='4']", "e => e.getBoundingClientRect().right")
        assert label[1] <= tile  # inside its tile, cut short with an ellipsis if need be
        assert window.evaluate("document.documentElement.scrollWidth <= innerWidth")
        assert window.inner_text("#runline") == "nothing sent yet"


def test_six_streaming_tiles_leave_the_window_room_to_ask_for_their_captions(window):
    # A browser opens at most six connections to one host: six MJPEG streams,
    # one per tile, took them all, and the window never heard how a tile ended.
    shot = window.screenshot(type="jpeg")
    with Dashboard(6, TickingFrames({k: shot for k in range(6)})) as board:
        board.update(5, company="Rhombus", status="ready to submit")
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('caption-5').textContent.includes('Rhombus')", timeout=10_000)
        assert window.inner_text("#banner-5 .label") == READY


def test_frames_are_taken_over_cdp_from_a_workers_own_browser(tmp_path):
    form = tmp_path / "form.html"
    form.write_text("<!doctype html><title>Form</title><h1>An application form</h1>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(form.as_uri(), worker=0) as page, CdpFrames(1, browsers.endpoint) as frames:
        deadline = time.monotonic() + 15
        while frames.frame(0) is None and time.monotonic() < deadline:
            page.wait_for_timeout(200)  # the Worker's own thread, meanwhile, keeps its page

    assert frames.frame(0).startswith(b"\xff\xd8")  # a JPEG


def test_a_workers_stream_keeps_moving_while_its_own_thread_is_busy(tmp_path):
    # A Worker thread blocks on `claude -p` for seconds at a time; its tile must stay live.
    form = tmp_path / "form.html"
    form.write_text("<!doctype html><title>Form</title><h1 id=h>Step 1</h1>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(form.as_uri(), worker=0) as page, CdpFrames(1, browsers.endpoint) as frames:
        first, seen = frames.wait(0, 0, 15)
        page.evaluate("setTimeout(() => { document.getElementById('h').textContent = 'Step 2 of the form' }, 500)")
        time.sleep(3)  # the Worker's thread is blocked: nothing pumps its Playwright
        later, moved = frames.wait(0, seen, 0)

    assert first and first.startswith(b"\xff\xd8")
    assert moved > seen and later != first


def test_the_tiles_come_back_after_the_frames_thread_hits_an_error(tmp_path, monkeypatch):
    # An error outside its own guards ended the frames thread for good: every tile froze, and took no input.
    form = tmp_path / "form.html"
    form.write_text("<!doctype html><title>Form</title><input id=name style='position:fixed;left:0;top:0;width:400px;height:40px'>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)
    follow, failed = CdpFrames._follow, []

    def fails_once(self, *args):
        if not failed:
            failed.append(True)
            raise RuntimeError("Browser.contexts: the connection closed")
        return follow(self, *args)

    monkeypatch.setattr(CdpFrames, "_follow", fails_once)
    with browsers.open(form.as_uri(), worker=0) as page, CdpFrames(1, browsers.endpoint) as frames:
        frame, _ = frames.wait(0, 0, 15)
        frames.input(0, {"type": "down", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "up", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "text", "text": "Lisul"})
        deadline = time.monotonic() + 15
        while page.input_value("#name") != "Lisul" and time.monotonic() < deadline:
            page.wait_for_timeout(200)

        assert failed and frame and frame.startswith(b"\xff\xd8")
        assert page.input_value("#name") == "Lisul"


@pytest.mark.parametrize("width, height, shown", [(1280, 800, True), (1440, 900, True), (1280, 4200, False)])
def test_a_tile_skips_the_tall_frames_of_a_workers_full_page_screenshot(width, height, shown):
    # While a Worker takes its Record's full-page screenshot, Chrome briefly lays the
    # whole form out at once; streamed, the tile would flash a thumbnail of it.
    assert is_view({"deviceWidth": width, "deviceHeight": height}) is shown


def test_a_jpegs_size_is_read_from_its_header():
    assert jpeg_size(jpeg(1280, 800)) == (1280, 800)


@pytest.mark.parametrize("x, y, page", [
    (0, 50, (0, 0)),  # the frame's top-left corner, under a 50 px band the tile letterboxes above it
    (320, 250, (640, 400)),  # its middle: the tile shows it at half size
    (640, 450, (1280, 800)),
    (320, 10, None),  # in the band above it: not on the page
])
def test_a_point_in_a_tile_maps_to_the_page_it_shows(x, y, page):
    # A 640x500 tile showing a 1280x800 frame, fitted (contained) and centred.
    assert to_page(x, y, 640, 500, 1280, 800) == page


def test_clicks_and_keys_in_a_tile_reach_the_workers_page_in_page_coordinates():
    frames = FakeFrames({1: jpeg(1280, 800)})
    with Dashboard(2, frames) as board:
        for event in (
            {"type": "down", "x": 320, "y": 250, "w": 640, "h": 500, "button": "left"},
            {"type": "up", "x": 320, "y": 250, "w": 640, "h": 500, "button": "left"},
            {"type": "wheel", "x": 320, "y": 250, "w": 640, "h": 500, "dx": 0, "dy": 120},
            {"type": "text", "text": "Lisul"},
            {"type": "key", "key": "Backspace"},
            {"type": "key", "key": "Tab", "modifiers": ["Shift", "Hyper"]},
            {"type": "down", "x": 320, "y": 10, "w": 640, "h": 500, "button": "left"},  # off the page: dropped
            {"type": "up", "x": 320, "y": 10, "w": 640, "h": 500, "button": "left"},  # let go off it: at its edge
        ):
            urllib.request.urlopen(urllib.request.Request(board.url + "/input/1", data=json.dumps(event).encode(),
                                                          method="POST", headers=_window(board)))

    assert frames.inputs == [
        (1, {"type": "down", "x": 640, "y": 400, "button": "left", "clicks": 1}),
        (1, {"type": "up", "x": 640, "y": 400, "button": "left", "clicks": 1}),
        (1, {"type": "wheel", "x": 640, "y": 400, "dx": 0, "dy": 120}),
        (1, {"type": "text", "text": "Lisul"}),
        (1, {"type": "key", "key": "Backspace"}),
        (1, {"type": "key", "key": "Tab", "modifiers": ["Shift"]}),
        (1, {"type": "up", "x": 640, "y": 0, "button": "left", "clicks": 1}),
    ]


def test_input_from_a_tile_types_into_a_workers_page_over_cdp(tmp_path):
    form = tmp_path / "form.html"
    form.write_text("<!doctype html><title>Form</title><input id=name style='position:absolute;left:0;top:0;width:400px;height:40px'>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(form.as_uri(), worker=0) as page, CdpFrames(1, browsers.endpoint) as frames:
        frames.input(0, {"type": "down", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "up", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "text", "text": "Lisul"})
        frames.input(0, {"type": "key", "key": "Backspace"})
        deadline = time.monotonic() + 15
        while page.input_value("#name") != "Lisu" and time.monotonic() < deadline:
            page.wait_for_timeout(200)

        assert page.input_value("#name") == "Lisu"


def test_cmd_a_selects_a_field_and_a_copy_reads_what_is_selected(tmp_path):
    form = tmp_path / "form.html"
    form.write_text("<!doctype html><input id=name value='Lisul Vitigala' style='position:absolute;left:0;top:0;width:400px;height:40px'>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(form.as_uri(), worker=0), CdpFrames(1, browsers.endpoint) as frames:
        frames.input(0, {"type": "down", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "up", "x": 20, "y": 20, "button": "left", "clicks": 1})
        frames.input(0, {"type": "key", "key": "a", "modifiers": ["Meta"]})
        copied = frames.input(0, {"type": "copy"})

    assert copied == {"text": "Lisul Vitigala"}


@contextmanager
def a_worker_on(tmp_path, html: str):
    """Worker 0's Chrome open on a page of `html`, kept by a thread of its own
    as a Worker keeps it; yields its browsers and a way to read the page."""
    form = tmp_path / "form.html"
    form.write_text(html)
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)
    asks, answers, ready = queue.Queue(), queue.Queue(), threading.Event()

    def keep():
        with browsers.open(form.as_uri(), worker=0) as page:
            ready.set()
            while (script := asks.get()) is not None:
                answers.put(script(page) if callable(script) else page.evaluate(script))

    thread = threading.Thread(target=keep, daemon=True)
    thread.start()
    assert ready.wait(30)

    def read(script: str):
        asks.put(script)
        return answers.get(timeout=10)

    try:
        yield browsers, read
    finally:
        asks.put(None)
        thread.join(10)


def until(read, script: str, expected, seconds: float = 10):
    """What `script` reads on the page once it is `expected`, or when `seconds` run out."""
    deadline = time.monotonic() + seconds
    while (value := read(script)) != expected and time.monotonic() < deadline:
        time.sleep(0.2)
    return value


def take_control(window, k: int) -> dict:
    """Click tile `k` to enlarge it and take its browser; returns where its frame now is."""
    window.click(f".tile[data-k='{k}'] img")
    window.wait_for_selector(f".tile.big[data-k='{k}'] .note", state="visible")
    window.wait_for_timeout(300)  # the enlarged tile laid out
    return window.locator(f"#frame-{k}").bounding_box()


TWO_FIELDS = ("<!doctype html><style>input { display: block; width: 90%; height: 45vh; font-size: 40px }</style>"
              "<input id=a><input id=b>")


def test_keys_typed_in_the_window_reach_the_workers_page(tmp_path, window):
    with a_worker_on(tmp_path, TWO_FIELDS) as (browsers, read), CdpFrames(1, browsers.endpoint) as frames, \
            Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('frame-0').naturalWidth > 0", timeout=10_000)
        frame = take_control(window, 0)
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.25)  # field a
        window.keyboard.type("Lisul O'Neil-Vitigala, #42 (SBU) & \"Q\"!?")
        window.keyboard.press("Backspace")
        window.keyboard.press("Tab")
        window.keyboard.type("BC")
        window.keyboard.press("ArrowLeft")
        window.keyboard.type("x")
        window.keyboard.press("Shift+Tab")
        window.keyboard.press("Meta+a")
        window.keyboard.press("Meta+c")
        window.keyboard.type("A")

        assert until(read, "[a.value, b.value]", ["A", "BxC"]) == ["A", "BxC"]


def test_a_select_pressed_in_the_window_opens_its_options_there_to_pick_from(tmp_path, window):
    # Headless Chrome draws no menu for a <select>: the tile draws its options instead.
    html = ("<!doctype html><select id=s style='width: 100%; height: 50vh; font-size: 40px'>"
            "<option>Choose one<option>Yes<option>No</select><script>s.onchange = () => document.title = 'changed'</script>")
    with a_worker_on(tmp_path, html) as (browsers, read), CdpFrames(1, browsers.endpoint) as frames, \
            Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('frame-0').naturalWidth > 0", timeout=10_000)
        frame = take_control(window, 0)
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.2)
        options = window.locator(".menu div")
        options.first.wait_for(timeout=10_000)
        assert options.all_inner_texts() == ["Choose one", "Yes", "No"]
        options.nth(2).dispatch_event("mousedown")

        assert until(read, "[s.value, document.title]", ["No", "changed"]) == ["No", "changed"]
        assert window.locator(".menu").count() == 0


def test_a_file_the_page_asks_for_is_picked_in_the_window(tmp_path, window):
    # Headless Chrome opens no file picker: the tile asks for the file instead.
    html = ("<!doctype html><input id=f type=file style='width: 100%; height: 50vh'>"
            "<script>f.onchange = () => document.title = f.files[0].name + ' ' + f.files[0].size</script>")
    resume = tmp_path / "Lisul Resume.pdf"
    resume.write_bytes(b"%PDF-1.4 a resume")
    with a_worker_on(tmp_path, html) as (browsers, read), CdpFrames(1, browsers.endpoint) as frames, \
            Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('frame-0').naturalWidth > 0", timeout=10_000)
        frame = take_control(window, 0)
        window.mouse.click(frame["x"] + frame["width"] / 2, frame["y"] + frame["height"] * 0.2)
        window.locator("#file-0").wait_for(timeout=10_000)
        window.set_input_files("#file-0 input", resume)

        assert until(read, "document.title", "Lisul Resume.pdf 17") == "Lisul Resume.pdf 17"
        window.wait_for_selector("#file-0", state="hidden", timeout=5_000)


def test_a_click_on_a_small_tile_only_enlarges_it_and_esc_hands_the_browser_back(window):
    # A click meant to pick a tile must never land on the page: it might be on Submit.
    frames = TickingFrames({0: jpeg(1280, 800)})
    with Dashboard(2, frames) as board:
        window.goto(board.url + "/#workers")
        assert not window.is_visible(".tile[data-k='0'] .note")
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big[data-k='0'] .note", state="visible")
        assert "You're controlling this browser — Esc to return" in window.inner_text(".tile[data-k='0'] .note")
        assert frames.inputs == []

        window.keyboard.press("Escape")
        window.wait_for_selector(".tile.big", state="detached")
        window.wait_for_timeout(500)

    assert frames.inputs == [(0, {"type": "key", "key": "Escape"})]


def test_cmd_v_in_the_window_pastes_the_macs_clipboard_into_the_page(window):
    window.context.grant_permissions(["clipboard-read", "clipboard-write"])
    frames = TickingFrames({0: jpeg(1280, 800)})
    with Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.evaluate("navigator.clipboard.writeText('Pasted from the Mac ✓')")
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big")
        window.keyboard.press("Meta+v")
        window.wait_for_timeout(500)

    assert frames.inputs == [(0, {"type": "text", "text": "Pasted from the Mac ✓"})]


class _Done:
    def __init__(self, stdout: str = "", returncode: int = 0):
        self.stdout, self.returncode = stdout, returncode


def test_raise_window_brings_the_dashboard_chrome_to_the_front(monkeypatch, tmp_path):
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        return _Done("4242\n") if cmd[0] == "pgrep" else _Done("true\n")

    monkeypatch.setattr(dashboard.subprocess, "run", run)
    assert raise_window(tmp_path / "dashboard")
    assert calls[0][-1].startswith("MacOS/Google Chrome --app=") and str(tmp_path / "dashboard") in calls[0][-1]
    assert calls[1][0] == "osascript" and "unix id is 4242" in calls[1][-1]


def test_raise_window_waits_for_the_window_to_be_drawn(monkeypatch, tmp_path):
    answers = iter(["false\n", "false\n", "true\n"])
    monkeypatch.setattr(dashboard.subprocess, "run",
                        lambda cmd, **kwargs: _Done("4242\n") if cmd[0] == "pgrep" else _Done(next(answers)))
    monkeypatch.setattr(dashboard.time, "sleep", lambda s: None)
    assert raise_window(tmp_path / "dashboard")


def test_raise_window_gives_up_when_the_window_never_appears(monkeypatch, tmp_path):
    monkeypatch.setattr(dashboard.subprocess, "run", lambda cmd, **kwargs: _Done())
    monkeypatch.setattr(dashboard.time, "sleep", lambda s: None)
    assert not raise_window(tmp_path / "dashboard", timeout=0)


def test_window_open_says_whether_the_windows_own_chrome_still_runs(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(dashboard.subprocess, "run", lambda cmd, **kwargs: seen.append(cmd) or _Done("4242\n"))
    assert dashboard.window_open(tmp_path / "answers")
    assert seen[0][0] == "pgrep" and f"--user-data-dir={tmp_path / 'answers'}" in seen[0][-1]

    monkeypatch.setattr(dashboard.subprocess, "run", lambda cmd, **kwargs: _Done(""))
    assert not dashboard.window_open(tmp_path / "answers")


def test_the_page_cannot_be_selected_into_a_blue_wash():
    assert "user-select: none" in dashboard.STYLE  # the tiles: the page served carries it


def test_the_workers_own_upload_still_gets_the_file_picker_while_the_window_watches(tmp_path, window):
    # Live, Claude fill's upload on Jobvite found no file picker: the window had caught it.
    html = ("<!doctype html><input id=f type=file>"
            "<script>f.onchange = () => document.title = f.files[0].name</script>")
    resume = tmp_path / "one-pager.pdf"
    resume.write_bytes(b"%PDF-1.4")

    def upload(page):
        with page.expect_file_chooser(timeout=5_000) as chosen:
            page.click("#f")
        chosen.value.set_files(resume)
        return page.title()

    with a_worker_on(tmp_path, html) as (browsers, read), CdpFrames(1, browsers.endpoint) as frames, \
            Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.wait_for_function("document.getElementById('frame-0').naturalWidth > 0", timeout=10_000)

        assert read(upload) == "one-pager.pdf"


def test_a_tile_serves_the_files_its_form_was_sent_and_nothing_else(tmp_path):
    letter = tmp_path / "Test_Person_Cover_Letter.pdf"
    letter.write_bytes(b"%PDF-1.4 a letter")
    (tmp_path / "secret.txt").write_text("not listed")
    with Dashboard(2, FakeFrames({})) as board:
        board.update(1, files=[{"label": "Cover Letter", "name": letter.name, "path": str(letter)}])
        _, kind, body = get(board.url + "/file/1/0")
        missing = [code for url in ("/file/1/1", "/file/0/0", "/file/1/x")
                   if (code := _status(board.url + url)) != 200]

    assert (kind, body) == ("application/pdf", b"%PDF-1.4 a letter")
    assert missing == [404, 404, 404]


def test_a_file_picked_in_a_tile_for_its_page_is_kept_by_its_name_and_listed_on_the_tile(tmp_path):
    resume = tmp_path / "Lisul_Elvitigala_Resume.pdf"
    resume.write_bytes(b"%PDF resume")
    frames = FakeFrames({})
    with Dashboard(1, frames, now=lambda: datetime(2026, 11, 2, 9)) as board:
        board.update(0, company="Appian Corporation", application_id="request-17", status="filling")
        event = {"type": "files", "files": [{"name": "Lisul_Elvitigala_Writing_Sample.pdf",
                                             "data": base64.b64encode(b"%PDF sample").decode()}]}
        urllib.request.urlopen(urllib.request.Request(board.url + "/input/0", data=json.dumps(event).encode(), method="POST",
                                                      headers=_window(board)))
        board.update(0, files=[{"label": "Resume", "name": resume.name, "path": str(resume)}])  # the plan's files, later
        files = board.state()["tiles"][0]["files"]

    [(_, given)] = frames.inputs
    [kept] = given["paths"]
    assert [f["name"] for f in files] == ["Lisul_Elvitigala_Resume.pdf", "Lisul_Elvitigala_Writing_Sample.pdf"]
    assert files[1]["path"] == kept
    assert Path(kept).read_bytes() == b"%PDF sample"
    assert Path(kept).parent == worker.SENT / "2026-11-02" / "appian-corporation-request-17"


def test_show_in_finder_reveals_a_listed_file_only_for_the_window_itself(tmp_path, monkeypatch):
    letter = tmp_path / "Test_Person_Resume.pdf"
    letter.write_bytes(b"%PDF")
    opened = []
    monkeypatch.setattr(dashboard.subprocess, "run", lambda args, **kw: opened.append(args))
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, files=[{"label": "Resume", "name": letter.name, "path": str(letter)}])
        reveal = lambda token: _status(board.url + "/reveal/0/0", data=b"", headers={"X-Apply-Token": token})
        codes = (reveal("wrong"), reveal(board.token))

    assert codes == (403, 204)
    assert opened == [["open", "-R", str(letter)]]


def test_the_window_lists_each_file_sent_with_view_and_show_in_finder(tmp_path, window):
    letter = tmp_path / "Test_Person_Cover_Letter.pdf"
    letter.write_bytes(b"%PDF")
    with Dashboard(2, FakeFrames({})) as board:
        board.update(1, files=[{"label": "Cover Letter", "name": letter.name, "path": str(letter)}])
        window.goto(board.url + "/#workers")
        window.wait_for_function("!document.getElementById('sent-1').hidden", timeout=10_000)
        row = window.locator("#sent-1")

        assert "Attached Test_Person_Cover_Letter.pdf" in row.inner_text()
        assert row.locator("a").get_attribute("href") == "/file/1/0"
        assert row.locator("button").inner_text() == "Show in Finder"
        assert window.locator("#sent-0").is_hidden()


def _status(url: str, data: bytes | None = None, headers: dict | None = None) -> int:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {})) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


# The Inbox: what waits on Lisul, kept after its Worker moves on.

def test_the_inbox_lists_each_ask_most_blocking_first_with_what_to_do_and_one_action(window):
    with Dashboard(3, FakeFrames({}), tracker_url="https://workitjobs.ai/applications", approve=lambda i: "ok") as board:
        board.update(0, company="Stripe", role="SWE Intern", job_system="greenhouse", posting_url="https://s.example/1",
                     application_id="s1", status="held", why="Target company: Stripe")
        board.update(1, company="Cohere", role="ML Intern", posting_url="https://c.example/2", status="missing fact",
                     why="Missing fact: Do you have a valid driver's license?")
        board.update(2, company="Zipline", role="Embedded Intern", job_system="workday", posting_url="https://z.example/3",
                     status=rehearsal.SIGN_IN, why="zipline.wd1.myworkdayjobs.com wants a password")
        board.update(2, company="Arc", posting_url="https://arc.example/4", status="filling")  # its Worker moved on
        window.goto(board.url)
        window.wait_for_selector("#inbox .item", timeout=10_000)
        rows = window.eval_on_selector_all("#inbox .item", "rs => rs.map(r => [r.querySelector('.kind').textContent, "
                                           "r.querySelector('.do').textContent])")
        held = window.locator("#inbox .item", has_text="Stripe")

        assert rows == [["Sign in", "Sign in to Zipline's Workday site once"], ["Question", "Answer a question only you know"],
                        ["Approve", "Review and approve before it's sent"]]
        assert "Stripe · SWE Intern · Greenhouse" in held.inner_text() and "Stripe is on your check-first list" in held.inner_text()
        assert held.locator("button.primary").inner_text() == "Approve"
        assert window.get_attribute("#inbox .item:has-text('Stripe') .who a", "href") == "https://s.example/1"
        assert window.inner_text("#tab-inbox") == "Needs you · 3"


def test_an_inbox_row_whose_page_is_still_open_offers_to_open_it(window):
    with Dashboard(1, TickingFrames({0: jpeg(1280, 800)})) as board:
        board.update(0, company="Harvey", posting_url="https://h.example/1", status="handoff", why="a captcha")
        window.goto(board.url)
        window.click("#inbox button:has-text('Fix here')")

        window.wait_for_selector(".tile.big[data-k='0']")
        assert window.is_visible("#workers") and not window.is_visible("#inbox")


def test_a_dismissed_row_leaves_the_inbox_and_undo_brings_it_back(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, company="Harvey", posting_url="https://h.example/1", status="handoff", why="a captcha")
        window.goto(board.url)
        window.click("#inbox button.close")

        window.wait_for_selector("text=Nothing needs you right now.")
        window.click("#toast button:has-text('Undo')")
        window.wait_for_selector("#inbox .item:has-text('Harvey')")


def test_failures_fold_away_below_the_asks(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, company="Harvey", posting_url="https://h.example/1", status="failed",
                     why="TimeoutError: Page.goto: Timeout 30000ms exceeded")
        window.goto(board.url)
        window.wait_for_selector("#inbox .failures", timeout=10_000)

        assert window.inner_text("#inbox .failures summary").startswith("1 couldn't finish · nothing was sent")
        assert not window.is_visible("#inbox .item:has-text('Harvey')")


def held_row(**more):
    from apply.model import Status
    from apply.tracker import Row
    return Row(**({"application_id": "a1", "company": "Stripe", "role": "SWE Intern", "posting_url": "https://s.example/1",
                   "job_system": "greenhouse", "status": Status.HELD, "reason": "Target company: Stripe"} | more))


def test_with_no_run_going_the_inbox_lists_what_the_tracker_says_still_waits(window):
    from apply.model import Status
    rows = [held_row(), held_row(application_id="a2", company="Done Co", approve=True),
            held_row(application_id="a3", company="Cohere", status=Status.MISSING_FACT, missing_fact="Pronouns", reason="")]
    approved = []
    with Dashboard(0, NoFrames(), past=lambda: rows, tracker_url="https://workitjobs.ai/applications",
                   approve=lambda i: approved.append(i) or "Approved.") as board:
        window.goto(board.url)
        window.wait_for_selector("#inbox .item", timeout=10_000)
        names = window.eval_on_selector_all("#inbox .item .name", "ns => ns.map(n => n.textContent)")

        assert names == ["Cohere · SWE Intern · Greenhouse", "Stripe · SWE Intern · Greenhouse"]  # not the approved Hold
        assert window.get_attribute("#history-tracker a", "href") == "https://workitjobs.ai/applications"
        window.click("#inbox .item:has-text('Stripe') button:has-text('Approve')")
        window.wait_for_function("() => !document.querySelector('#inbox .item .name')"
                                 " || ![...document.querySelectorAll('#inbox .item .name')].some(n => n.textContent.startsWith('Stripe'))")
        assert approved == ["a1"]


def post_approve(board, item, token=None, essays=None):
    body = json.dumps({"id": item["id"]} | ({"essays": essays} if essays is not None else {})).encode()
    return urllib.request.urlopen(urllib.request.Request(board.url + "/approve", body,
                                                         {"X-Apply-Token": token or board.token}))


def test_a_hold_is_approved_in_the_window_and_waits_no_more():
    # KAN-544: the Tracker Sheet is gone, so the window's button ticks Approve in Apply's Tracker.
    approved = []
    with Dashboard(0, NoFrames(), past=lambda: [held_row()], approve=lambda i: approved.append(i) or "Approved.") as board:
        [item] = board.state()["items"]
        assert item["kind"] == "held" and board.state()["context"]["approve"] is True
        reply = json.loads(post_approve(board, item).read())

        assert (reply["message"], approved) == ("Approved.", ["a1"])
        assert [i.get("answered") for i in board.state()["items"]] == [True]
        with pytest.raises(urllib.error.HTTPError) as gone:  # a second press: it no longer waits
            post_approve(board, item)
        assert gone.value.code == 404


# A held cell as essays.as_cell writes it: each essay's heading, its Plan line, then its text.
HELD_CELL = ("## Why Stripe?\nPlan: why-company | Hitachi Rail | Payments are infrastructure.\nClaude's draft\n\n"
             "## A project you're proud of?\nMy bus tracker.")


def test_a_held_essay_edited_in_the_window_is_approved_as_edited():
    # The retired Tracker Sheet let Lisul edit a held essay before he ticked Approve: the window does too,
    # one box per question with only its text. The heading and Plan line stay as Apply wrote them.
    approved = []
    approve = lambda i, essay=None: approved.append((i, essay)) or "Approved."
    with Dashboard(1, NoFrames(), past=lambda: [held_row(essay=HELD_CELL)], approve=approve) as board:
        [item] = board.state()["items"]
        assert item["essays"] == [{"question": "Why Stripe?", "text": "Claude's draft"},
                                  {"question": "A project you're proud of?", "text": "My bus tracker."}]
        post_approve(board, item, essays=["My own words", "My bus tracker."])
        board.update(0, company="Arc", role="Intern", posting_url="https://arc.example/1", application_id="arc-1",
                     status="held", why="High-stakes essay: Why Arc?", essay="## Why Arc?\nDraft")
        [live] = [i for i in board.state()["items"] if i["company"] == "Arc"]
        assert live["essays"] == [{"question": "Why Arc?", "text": "Draft"}]
        post_approve(board, live)  # not edited: the row's essay stays

    assert approved == [("a1", HELD_CELL.replace("Claude's draft", "My own words")), ("arc-1", None)]


def test_an_empty_held_essay_is_refused_and_not_approved():
    approved = []
    approve = lambda i, essay=None: approved.append((i, essay)) or "Approved."
    with Dashboard(0, NoFrames(), past=lambda: [held_row(essay=HELD_CELL)], approve=approve) as board:
        [item] = board.state()["items"]
        for essays, said in [(["  ", "My bus tracker."], 'The essay for "Why Stripe?" is empty.'),
                             (["Only one"], "The essays changed since the window showed them.")]:
            with pytest.raises(urllib.error.HTTPError) as refused:
                post_approve(board, item, essays=essays)
            assert refused.value.code == 400 and json.loads(refused.value.read())["error"].startswith(said)
        assert [i.get("answered") for i in board.state()["items"]] == [None]  # it still waits on him

    assert approved == []


def test_lisul_edits_a_held_essay_on_its_card_and_approve_sends_his_words(window):
    approved = []
    approve = lambda i, essay=None: approved.append((i, essay)) or "Approved."
    with Dashboard(0, NoFrames(), past=lambda: [held_row(essay=HELD_CELL)], approve=approve) as board:
        window.goto(board.url)
        card = "#inbox .item:has-text('Stripe')"
        window.wait_for_selector(f"{card} textarea")
        boxes = window.locator(f"{card} textarea")
        # One box per question, each with the essay's text only: no heading or Plan line to edit.
        assert [boxes.nth(i).input_value() for i in range(boxes.count())] == ["Claude's draft", "My bus tracker."]
        assert "Why Stripe?" in window.inner_text(card) and "Plan:" not in window.inner_text(card)
        boxes.first.fill("My own words")
        window.reload()  # the edit is kept until he approves
        assert window.locator(f"{card} textarea").first.input_value() == "My own words"
        assert "Approve sends your edit" in window.inner_text(card)
        window.click(f"{card} button:has-text('Approve')")
        window.wait_for_selector(card, state="detached")
        window.reload()  # approved: the edit is not kept any longer
        assert window.evaluate("sessionStorage.getItem('apply.essays')") == "{}"

    assert approved == [("a1", HELD_CELL.replace("Claude's draft", "My own words"))]


def test_an_approval_from_anywhere_but_the_window_is_refused():
    approved = []
    with Dashboard(0, NoFrames(), past=lambda: [held_row()], approve=approved.append) as board:
        [item] = board.state()["items"]
        with pytest.raises(urllib.error.HTTPError) as refused:
            post_approve(board, item, token="guessed")
    assert refused.value.code == 403 and approved == []


def test_a_tracker_missing_fact_brings_the_options_its_form_offered():
    from apply.model import Question, Status
    from apply.tracker import options_cell
    from apply.worker import choices
    asked = Question("q", "Which offices?", "multi_select", True, ("Select...", "Austin", "Denver"))
    rows = [held_row(status=Status.MISSING_FACT, missing_fact="Which offices?", reason="",
                     missing_fact_options=options_cell(choices(asked)))]
    with Dashboard(0, NoFrames(), past=lambda: rows) as board:
        [item] = board.state()["items"]

    assert item["choices"] == {"Which offices?": {"kind": "multi_select", "options": ["Austin", "Denver"]}}


def test_a_window_that_never_ran_says_what_apply_does_and_the_first_steps(window):
    with Dashboard(0, NoFrames(), past=list) as board:
        window.goto(board.url)
        window.wait_for_selector("#inbox .empty-state", timeout=10_000)
        text = window.inner_text("#inbox")

        assert text.startswith("Apply fills internship applications for you.")
        assert "apply rehearse <job link>" in text and "apply run" in text
        assert "Apply never sends without your OK" in text


def test_with_no_run_and_nothing_waiting_the_inbox_says_when_apply_runs_next(window):
    from datetime import date

    from apply.model import Status
    today = date.today()
    rows = [held_row(status=Status.SUBMITTED, date_applied=today, reason="")]
    with Dashboard(0, NoFrames(), past=lambda: rows, sweep_at="07:00") as board:
        window.goto(board.url)
        window.wait_for_selector("text=All done.", timeout=10_000)

        assert "Next daily check for new jobs at 07:00. 1 sent today." in window.inner_text("#inbox")


def test_a_tracker_that_cant_be_read_still_leaves_the_window_working():
    def unreachable():
        raise OSError("no network")

    with Dashboard(0, NoFrames(), past=unreachable) as board:
        state = board.state()

    assert state["items"] == [] and state["context"]["tracker_error"]


# The status bar: the run as a whole.

def test_a_run_paused_at_a_usage_limit_says_why_and_when_it_goes_on(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.run(mode="run", queued=18, today=7, cap=25)
        window.goto(board.url)
        window.wait_for_function("document.getElementById('runline').textContent.includes('18 queued')", timeout=10_000)
        assert window.inner_text("#mode") == "Live run"
        assert window.inner_text("#runline") == "18 queued · nothing sent yet · 7 of 25 today"

        board.run(paused_until="2026-10-20T14:05")
        window.wait_for_selector("#runline.paused")
        assert window.inner_text("#runline") == "Paused: Claude's usage limit is reached. Picks up again at 14:05."


def test_the_daily_cap_shows_in_the_status_bar(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.run(mode="run", cap=25, capped=True, tomorrow=11)
        window.goto(board.url)
        window.wait_for_selector("#runline.paused", timeout=10_000)

        assert window.inner_text("#runline") == "Today's limit reached (25). 11 more go tomorrow."


def test_a_practice_run_says_nothing_will_be_sent_and_what_apply_never_does_alone(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.run(mode="rehearsal", queued=1)
        window.goto(board.url)
        window.wait_for_selector("#mode.rehearsal", timeout=10_000)
        assert window.inner_text("#mode") == "Practice run · nothing is sent"



def test_with_no_run_the_status_bar_says_when_the_daily_check_runs(window):
    with Dashboard(0, NoFrames(), sweep_at="07:00") as board:
        window.goto(board.url)
        window.wait_for_function("document.getElementById('runline').textContent.length > 0", timeout=10_000)

        assert window.inner_text("#runline") == "Idle until the daily check at 07:00"
        assert not window.is_visible("#mode")


# Answering a question only Lisul can answer, from the Inbox.

def test_an_answer_typed_in_the_inbox_is_saved_and_its_row_leaves(window):
    saved = []

    def answer(item, question, text):
        saved.append((item["company"], question, text))
        return "Saved your answer for Cohere: it goes on at the next check."

    with Dashboard(1, FakeFrames({}), answer=answer) as board:
        board.update(0, company="Cohere", posting_url="https://c.example/2", application_id="c2", status="missing fact",
                     why="Missing fact: Do you have a valid driver's license?")
        window.goto(board.url)
        window.fill("#inbox input.answer", "Yes")
        window.press("#inbox input.answer", "Enter")

        window.wait_for_selector("text=Nothing needs you right now.", timeout=10_000)
        assert "Saved your answer for Cohere" in window.inner_text("#toast")
        assert saved == [("Cohere", "Do you have a valid driver's license?", "Yes")]
        assert window.title() == "Apply"


def test_a_question_with_options_is_answered_by_picking_them(window):
    saved = []

    def answer(item, question, text):
        saved.append((question, text))
        return "Saved to your facts: every form that asks it gets this answer."

    choices = {"Authorized to work in the US?": {"kind": "select", "options": ["Yes", "No"]},
               "Which offices?": {"kind": "multi_select", "options": ["Austin", "Boston", "Denver"]}}
    with Dashboard(1, FakeFrames({}), answer=answer) as board:
        board.update(0, company="Acme", posting_url="https://a.example/1", status=rehearsal.READY,
                     missing=list(choices), choices=choices)
        window.goto(board.url)
        window.select_option("#inbox .ask:has-text('Authorized') select", "Yes")
        window.click("#inbox .ask:has-text('Authorized') button:has-text('Save answer')")
        window.wait_for_selector("#inbox .ask:has-text('Authorized')", state="detached", timeout=10_000)
        window.check("#inbox .ask label:has-text('Austin') input")
        window.check("#inbox .ask label:has-text('Denver') input")
        window.click("#inbox .ask button:has-text('Save answer')")

        window.wait_for_selector("text=Nothing needs you right now.", timeout=10_000)
        assert saved == [("Authorized to work in the US?", "Yes"), ("Which offices?", "Austin; Denver")]


def test_a_file_question_offers_this_mac_dropbox_and_google_drive_and_attaches_the_file(window, tmp_path):
    sample = tmp_path / "Writing Sample.pdf"
    sample.write_bytes(b"%PDF-1.4 sample")
    choices = {"Writing sample": {"kind": "file", "options": []}}
    with Dashboard(1, FakeFrames({}), answer=lambda *a: "Saved.") as board:
        board.update(0, company="Appian", posting_url="https://a.example/1", status=rehearsal.READY,
                     missing=list(choices), choices=choices, required={"Writing sample": True})
        window.goto(board.url)
        window.wait_for_selector("#inbox .ask .file-options", timeout=10_000)
        offered = window.eval_on_selector_all("#inbox .ask .file-options button", "bs => bs.map(b => b.textContent)")
        window.click("#inbox .ask button:has-text('Google Drive')")  # picked on the form itself, in its tile
        assert window.is_visible("#workers .tile.big[data-k='0']")
        window.evaluate("tab('inbox')")
        with window.expect_file_chooser() as chooser:
            window.click("#inbox .ask button:has-text('Attach from this Mac')")
        chooser.value.set_files(sample)
        window.wait_for_selector("text=Nothing needs you right now.", timeout=10_000)
        (question, attached), = board.answered(0)

    assert offered == ["Attach from this Mac", "Dropbox", "Google Drive"]  # no Skip: the form requires it
    assert (question, attached.name, attached.read_bytes()) == ("Writing sample", "Writing Sample.pdf", b"%PDF-1.4 sample")


def test_a_file_claude_gave_the_form_stops_the_tile_asking_for_one():
    class Asking(FakeFrames):
        asked = "selectSingle"

        def chooser(self, worker):
            return self.asked

        def forget_chooser(self, worker):
            self.asked = None

    with Dashboard(1, Asking({})) as board:
        board.update(0, company="Appian", status="filling")
        assert board.state()["tiles"][0]["file"] == "selectSingle"
        board.file_given(0)

        assert "file" not in board.state()["tiles"][0]


def test_each_question_says_whether_its_form_requires_it(window):
    with Dashboard(1, FakeFrames({}), answer=lambda *a: "Saved.") as board:
        board.update(0, company="Point72", posting_url="https://p.example/1", status=rehearsal.READY,
                     missing=["Certifications", "Pronouns", "Essay fact: what did the robot do?"],
                     required={"Certifications": False, "Pronouns": True})
        window.goto(board.url)
        window.wait_for_selector("#inbox .ask", timeout=10_000)
        flags = window.eval_on_selector_all("#inbox .ask > label", "ls => ls.map(l => l.querySelector('.need')?.textContent)")

    assert flags == ["Optional", "Required", None]  # one with no flag read says neither


def test_each_question_card_says_where_it_sits_or_which_essay_it_is_for(window):
    from apply import essays, notify
    from apply.answer_bank import AnswerBank
    from apply.model import Question, Status

    step = "Application Questions 1 of 2"
    worked, start, end = (Question(f"{step} / {label}", label, kind, True) for label, kind in [
        ("Have you worked for a made-up fund before?", "select"), ("From (MM/DD/YYYY)", "text"), ("To (MM/DD/YYYY)", "text")])
    essay = essays.Essay(Question("e", "Tell us about a made-up robot", "textarea", True), "",
                         plan=essays.Plan("general", asks=("Essay fact: What did the robot do?",)))
    planned = worker._Planned.__new__(worker._Planned)
    planned.questions, planned.written, planned.lisuls, planned.found = [worked, start, end], [essay], {}, {}
    planned._rehearse, planned.missing, planned._on_missing = True, (), lambda *heard: None
    planned.profile = type("Profile", (), {"get": lambda self, key: None})()  # made up: it holds nothing
    planned._bank = AnswerBank()
    planned._missing([start], ["Essay fact: What did the robot do?"])

    assert planned.where == {
        "From (MM/DD/YYYY)": f"{step} · after 'Have you worked for a made-up fund before?' · paired with To (MM/DD/YYYY)",
        "Essay fact: What did the robot do?": "For the essay 'Tell us about a made-up robot': Claude writes it from "
                                              "your answer, which joins your Story bank"}
    with Dashboard(1, FakeFrames({}), answer=lambda *a: "Saved.") as board:
        board.update(0, company="Made-up Fund", role="Intern", posting_url="https://m.example/1", status=rehearsal.READY,
                     missing=list(planned.missing), required=planned.required, where=planned.where)
        window.goto(board.url)
        window.wait_for_selector("#inbox .ask .where", timeout=10_000)
        shown = window.eval_on_selector_all("#inbox .ask .where", "ws => ws.map(w => w.textContent)")
        assert "Made-up Fund · Intern" in window.inner_text("#inbox .item")
    assert shown == list(planned.where.values())
    planned._rehearse = False  # a run: its Tracker reason and the push carry the line too
    stopped = planned._missing([start])
    assert stopped.reason == f"Missing fact: From (MM/DD/YYYY); In: {planned.where['From (MM/DD/YYYY)']}"
    _, pushed = notify.waiting([(Status.MISSING_FACT, "Made-up Fund", "Intern", stopped.reason.removeprefix("Missing fact: "))])
    assert pushed.endswith(f"From (MM/DD/YYYY) ({step} · after 'Have you worked for a made-up fund before?' · "
                           "paired with To (MM/DD/YYYY))")


def test_a_refused_answer_keeps_the_draft_and_says_why(window):
    from apply.answers_tab import Refused

    def answer(item, question, text):
        raise Refused("That question looks like it asks for a password; answer it on the form.")

    with Dashboard(1, FakeFrames({}), answer=answer) as board:
        board.update(0, company="Acme", posting_url="https://a.example/1", status=rehearsal.READY, missing=["Password"])
        window.goto(board.url)
        window.fill("#inbox input.answer", "hunter2")
        window.click("#inbox button:has-text('Save answer')")

        window.wait_for_selector("#inbox .ask .status.error")
        assert "looks like it asks for a password" in window.inner_text("#inbox .ask .status")
        assert window.input_value("#inbox input.answer") == "hunter2"


def test_an_answer_from_anywhere_but_the_window_itself_is_refused():
    saved = []
    with Dashboard(1, FakeFrames({}), answer=lambda *a: saved.append(a) or "ok") as board:
        board.update(0, company="Cohere", status="missing fact", why="Missing fact: Pronouns")
        [item] = board.state()["items"]
        body = json.dumps({"id": item["id"], "question": "Pronouns", "answer": "he/him"}).encode()
        request = urllib.request.Request(board.url + "/answer", body, {"X-Apply-Token": "guessed"})
        with pytest.raises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(request)

    assert refused.value.code == 403 and saved == []


def post_answer(board, item, question, answer):
    body = json.dumps({"id": item["id"], "question": question, "answer": answer}).encode()
    return urllib.request.urlopen(urllib.request.Request(board.url + "/answer", body, {"X-Apply-Token": board.token}))


def test_a_form_still_filling_asks_its_missing_facts_at_once_and_not_again_once_it_ends():
    saved = []
    with Dashboard(1, FakeFrames({}), answer=lambda item, q, a: saved.append((item["status"], q, a)) or "ok") as board:
        board.update(0, company="Coinbase", posting_url="https://c.example/1", status="filling")
        board.update(0, missing=["Certifications", "Pronouns"])
        [item] = board.state()["items"]
        assert (item["kind"], item["questions"]) == ("missing fact", ["Certifications", "Pronouns"])
        assert [t["tone"] for t in board.state()["tiles"]] == ["filling"]  # the tile still fills
        post_answer(board, item, "Pronouns", "he/him")
        assert board.state()["items"][0]["questions"] == ["Certifications"]

        board.update(0, status=rehearsal.READY, why="")  # it ends: only what is still unanswered is asked
        [ended] = board.state()["items"]
        assert (ended["kind"], ended["questions"]) == ("missing fact", ["Certifications"])

    assert saved == [(dashboard.ASKING, "Pronouns", "he/him")]  # saved to his facts, not a Tracker row


def test_a_rehearsed_answer_goes_to_its_open_form_but_a_runs_and_an_essays_do_not():
    with Dashboard(2, FakeFrames({}), answer=lambda *a: "Saved.") as board:
        board.update(0, company="Point72", posting_url="https://p.example/1", status=rehearsal.READY,
                     missing=["Certifications", "Essay fact: what did the robot do?"])
        board.update(1, company="Cohere", posting_url="https://c.example/2", application_id="c2", status="missing fact",
                     why="Missing fact: Pronouns")
        rehearsed, run = sorted(board.state()["items"], key=lambda i: i["worker"])
        reply = json.loads(post_answer(board, rehearsed, "Certifications", "None").read())
        post_answer(board, rehearsed, "Essay fact: what did the robot do?", "It solved the maze")
        post_answer(board, run, "Pronouns", "he/him")

        assert reply["message"] == "Saved. Claude fills it in on the open form now."
        assert board.answered(0) == [("Certifications", "None")]
        assert board.answered(0) == board.answered(1) == []  # each given once; a run's goes on from its Tracker row


@pytest.mark.parametrize("answer_first", [False, True])
def test_a_form_sent_with_questions_open_shows_as_sent_and_leaves_needs_you(answer_first):
    # Saronic, 2026-11-04: Lisul sent the held form himself, and its tile still asked its Missing and Essay facts.
    with Dashboard(1, FakeFrames({}), answer=lambda *a: "Saved.") as board:
        board.update(0, company="Saronic", posting_url="https://s.example/1", status=rehearsal.READY,
                     missing=["Pronouns", "Essay fact: what did the boat do?", "Essay fact: who was it for?"],
                     required={"Pronouns": True}, where={"Pronouns": "About you"})
        [asking] = board.state()["items"]
        assert asking["kind"] == "missing fact"
        if answer_first:
            post_answer(board, asking, "Pronouns", "he/him")
        board.update(0, status="submitted", why="you submitted it; it is in the Tracker")
        [tile], items = board.state()["tiles"], board.state()["items"]
        with pytest.raises(urllib.error.HTTPError) as late:  # a question answered after the submit
            post_answer(board, items[0], "Essay fact: who was it for?", "The Navy")

    assert (tile["tone"], tile["label"], tile["detail"]) == ("submitted", "Sent", "you submitted it; it is in the Tracker")
    assert tile["missing"] == [] and "do" not in tile
    assert [(i["company"], i["tone"]) for i in items] == [("Saronic", "submitted")]  # no card waits on him
    assert late.value.code == 404


def test_an_optional_question_saved_blank_is_skipped_and_a_file_is_attached_but_neither_kept_as_a_fact():
    saved = []
    with Dashboard(1, FakeFrames({}), answer=lambda item, q, a: saved.append(q) or "Saved.") as board:
        board.update(0, company="Appian", posting_url="https://a.example/1", status=rehearsal.READY,
                     missing=["Certifications", "Writing sample", "Pronouns"],
                     required={"Certifications": False, "Writing sample": True, "Pronouns": True},
                     choices={"Writing sample": {"kind": "file", "options": []}})
        item = board.state()["items"][0]
        skipped = json.loads(post_answer(board, item, "Certifications", "").read())
        body = json.dumps({"id": item["id"], "question": "Writing sample", "answer": "",
                           "file": {"name": "../essay.pdf", "data": base64.b64encode(b"%PDF-1.4 essay").decode()}}).encode()
        attached = json.loads(urllib.request.urlopen(urllib.request.Request(
            board.url + "/answer", body, {"X-Apply-Token": board.token})).read())
        with pytest.raises(urllib.error.HTTPError) as blank:
            post_answer(board, item, "Pronouns", "")  # a required one can't be skipped

        assert skipped["message"].startswith("Skipped") and attached["message"].endswith("essay.pdf on the open form now.")
        assert blank.value.code == 400 and saved == []
        (q1, none), (q2, file) = board.answered(0)
        assert (q1, none, q2, file.name, file.read_bytes()) == ("Certifications", None, "Writing sample", "essay.pdf", b"%PDF-1.4 essay")
        assert board.state()["items"][0]["questions"] == ["Pronouns"]


# History: what Apply did, and why.

def test_history_lists_each_decision_newest_first_with_why(window, tmp_path):
    resume = tmp_path / "Lisul Resume.pdf"
    resume.write_bytes(b"%PDF-1.4 resume")
    clock = iter(datetime(2026, 10, 20, 9, m) for m in range(60))
    with Dashboard(1, FakeFrames({}), now=lambda: next(clock)) as board:
        board.update(0, company="Skydio", role="Autonomy Intern", job_system="ashby", posting_url="https://s.example/1",
                     status="filling", files=[{"label": "Résumé", "name": resume.name, "path": str(resume)}])
        board.update(0, status="submitted", why="", drafted=["Why drones? → I build them"])
        board.note("OpenAI", "Research Intern", "OpenAI takes at most 5 applications in any 180 days")
        window.goto(board.url + "/#history")
        window.wait_for_selector("#history .done", timeout=10_000)
        rows = window.eval_on_selector_all("#history .done", "rs => rs.map(r => r.innerText)")

        assert len(rows) == 2 and "OpenAI takes at most 5 applications" in rows[0]  # skips are listed too
        rows = rows[1:]
        assert "✓ Sent" in rows[0] and "Skydio · Autonomy Intern · Ashby" in rows[0]
        assert "Every answer was checked against your facts before it was sent" in rows[0]
        assert "1 answer written by Claude: check it in Saved answers" in rows[0]
        assert get(board.url + window.get_attribute(f"#history .links a:has-text('Sent: {resume.name}')", "href"))[2] == b"%PDF-1.4 resume"


def test_history_says_so_before_anything_ends(window):
    with Dashboard(1, FakeFrames({})) as board:
        window.goto(board.url + "/#history")
        window.wait_for_selector("#history .history-empty", timeout=10_000)

        assert window.inner_text("#history .history-empty").startswith("Nothing has ended yet.")


# The keyboard.


def test_while_a_tile_is_controlled_number_keys_go_to_the_page_not_the_tabs(window):
    frames = TickingFrames({0: jpeg(1280, 800)})
    with Dashboard(1, frames) as board:
        window.goto(board.url + "/#workers")
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big")
        window.keyboard.press("3")
        window.wait_for_timeout(300)

        assert window.is_visible("#workers")
    assert frames.inputs == [(0, {"type": "text", "text": "3"})]



def test_the_tile_s_ask_claude_box_sends_his_words_to_claude_not_to_the_page(window):
    """Ask Claude (KAN-638): typed in the tile's box, also while the tile is controlled, his message goes to the
    window, not as keys to the page; Claude's reply then shows in the tile's thread."""
    frames = TickingFrames({0: jpeg(1280, 800)})
    with Dashboard(1, frames) as board:
        board.update(0, company="Acme", posting_url="https://jobs.example.com/acme/1", status="ready to submit",
                     askable=True)
        window.goto(board.url + "/#workers")
        window.click(".tile[data-k='0'] img")
        window.wait_for_selector(".tile.big")
        window.fill("#ask-0 input", "page 2's GPA is wrong")
        window.click("#ask-0 button.go")
        window.wait_for_selector("#ask-0 .claude.working")
        [item] = board.asks(0)
        board.replied(0, item["id"], state="done", reply="Changed the GPA to 3.7.",
                      changed=[{"field": "GPA", "step": "page 2", "shown": "3.7", "read_back": "Claude's read-back"}],
                      offers=[{"question": "GPA", "answer": "3.7", "saved": False}])
        window.wait_for_selector("#ask-0 .offer button")

        assert item["message"] == "page 2's GPA is wrong"
        assert "Changed GPA (page 2) → 3.7" in window.inner_text("#ask-0")
    assert frames.inputs == []  # nothing he typed reached the page


# Notifications.

def test_new_asks_are_told_in_one_notification_a_minute_while_the_window_is_behind(monkeypatch):
    monkeypatch.setattr(dashboard, "NOTIFY_EVERY", 0.5)
    told = []
    with Dashboard(3, FakeFrames({}), notify=lambda title, message: told.append(message)) as board:
        board.update(0, company="Stripe", status="held", why="Target company: Stripe")
        board.update(1, company="Cohere", status="missing fact", why="Missing fact: Pronouns")
        board.update(2, company="Arc", status="submitted")  # nothing to do: never told
        time.sleep(0.8)

    assert told == ["1 application needs you: Stripe (Waiting for your OK)",
                    "1 application needs you: Cohere (Question only you can answer)"]


def test_nothing_is_told_while_the_window_is_in_front():
    told = []
    with Dashboard(1, FakeFrames({}), notify=lambda title, message: told.append(message)) as board:
        board.focused(True)
        board.update(0, company="Stripe", status="held", why="Target company: Stripe")

    assert told == []


def test_a_link_to_a_tab_opens_it_without_a_reload(window):
    with Dashboard(1, FakeFrames({})) as board:
        window.goto(board.url)
        window.wait_for_selector("#inbox", state="visible", timeout=10_000)
        window.evaluate("location.hash = '#history'")

        window.wait_for_selector("#history", state="visible")
        assert not window.is_visible("#inbox")



# Open in Chrome: a Worker's own window, for what the tile cannot do.

def post_show(board, k, token=None):
    request = urllib.request.Request(f"{board.url}/show/{k}", b"", {"X-Apply-Token": token or board.token}, method="POST")
    try:
        with urllib.request.urlopen(request) as reply:
            return reply.status
    except urllib.error.HTTPError as refused:
        return refused.code


def test_open_in_chrome_brings_the_workers_window_forward_only_for_the_window_itself():
    shown = []
    with Dashboard(2, FakeFrames({}), show=lambda k: shown.append(k) or k == 1) as board:
        assert post_show(board, 1) == 204
        assert post_show(board, 0) == 409  # no window: headless, or closed
        assert post_show(board, 1, token="guessed") == 403
        assert post_show(board, 7) == 404

    assert shown == [1, 0]


def test_a_sign_in_card_leads_with_open_in_chrome_and_a_fix_with_fix_here(window):
    shown = []
    with Dashboard(2, FakeFrames({}), show=lambda k: shown.append(k) or True) as board:
        board.update(0, company="Zipline", posting_url="https://z.example/1", status=rehearsal.SIGN_IN, why="wants a password")
        board.update(1, company="Harvey", posting_url="https://h.example/2", status="handoff", why="a captcha")
        window.goto(board.url)
        window.wait_for_selector("#inbox .item", timeout=10_000)
        buttons = lambda name: window.eval_on_selector_all(f"#inbox .item:has-text('{name}') .actions button",
                                                           "bs => bs.map(b => [b.textContent, b.className])")

        assert buttons("Zipline") == [["Open in Chrome", "primary"], ["Fix here", ""]]
        assert buttons("Harvey") == [["Fix here", "primary"], ["Open in Chrome", ""]]
        window.click("#inbox .item:has-text('Zipline') button:has-text('Open in Chrome')")
        window.wait_for_timeout(300)

    assert shown == [0]


def test_without_a_window_to_open_the_cards_offer_fix_here_alone(window):
    with Dashboard(1, FakeFrames({})) as board:
        board.update(0, company="Harvey", posting_url="https://h.example/2", status="handoff", why="a captcha")
        window.goto(board.url)
        window.wait_for_selector("#inbox .item", timeout=10_000)

        assert window.eval_on_selector_all("#inbox .actions button", "bs => bs.map(b => b.textContent)") == ["Fix here"]


def test_the_enlarged_tile_offers_open_in_chrome(window):
    shown = []
    with Dashboard(1, TickingFrames({0: jpeg(1280, 800)}), show=lambda k: shown.append(k) or True) as board:
        window.goto(board.url + "/#workers")
        window.click(".tile[data-k='0'] img")
        window.click(".tile.big .note button:has-text('Open in Chrome')")
        window.wait_for_timeout(300)

    assert shown == [0]


def test_start_holds_until_the_window_presses_it_and_only_the_window_may():
    with Dashboard(2, FakeFrames({})) as board:
        waited = threading.Thread(target=board.wait_for_start, args=(10,))
        waited.start()
        time.sleep(0.2)
        assert board.state()["run"]["start"] == "ready"
        assert _status(board.url + "/start", data=b"guessed") == 403
        time.sleep(0.2)
        assert waited.is_alive()
        assert _status(board.url + "/start", data=board.token.encode()) == 204
        waited.join(2)
        assert not waited.is_alive()
        assert board.state()["run"]["start"] == "started"


# A bot block (KAN-590): LinkedIn's SmartRecruiters form, refused by DataDome, finished in Lisul's own Chrome.
BLOCKED = {"company": "LinkedIn", "role": "Software Engineer Intern", "job_system": "other",
           "posting_url": "https://jobs.smartrecruiters.com/LinkedIn3/744000158394370", "status": "handoff",
           "blocked": True, "why": "LinkedIn blocked Apply's Chrome as a bot. "
                                   "Finish LinkedIn in your Chrome: the extension fills it"}


def post_everyday(board, key, token=None):
    body = json.dumps({"id": key}).encode()
    return urllib.request.urlopen(urllib.request.Request(board.url + "/everyday", body,
                                                         {"X-Apply-Token": token or board.token}))


def test_a_bot_block_waits_on_lisul_to_finish_it_in_his_own_chrome():
    shown = verdict(BLOCKED)

    assert (shown["tone"], shown["kind"]) == ("needs", "blocked")
    assert shown["do"] == "Finish LinkedIn in your Chrome: the extension fills it"
    assert "Open in my Chrome" in shown["then"]


def test_open_in_my_chrome_opens_the_posting_only_when_lisul_presses_it():
    opened = []
    with Dashboard(1, NoFrames(), everyday=opened.append) as board:
        board.update(0, **BLOCKED)
        board.update(0, status="")  # its Worker moved on: the item stays in Needs you
        [item] = [i for i in board.state()["items"] if i.get("kind") == "blocked"]
        assert opened == []  # a rehearsal never pops a window by itself

        with pytest.raises(urllib.error.HTTPError) as refused:
            post_everyday(board, item["id"], token="not the window's")
        assert refused.value.code == 403
        reply = json.loads(post_everyday(board, item["id"]).read())

    assert opened == [BLOCKED["posting_url"]]
    assert "your Chrome" in reply["message"]


def test_a_live_runs_bot_block_in_the_tracker_offers_open_in_my_chrome(window):
    # KAN-590: a live run opened it already; the window opens it again only on Lisul's press.
    from apply.model import Status
    row = held_row(company="LinkedIn", job_system="other", posting_url=BLOCKED["posting_url"], status=Status.HANDOFF,
                   reason=BLOCKED["why"], bot_signals="headed: blocked")
    opened = []
    with Dashboard(0, NoFrames(), past=lambda: [row], everyday=opened.append) as board:
        window.goto(board.url)
        window.wait_for_selector("#inbox .item", timeout=10_000)
        window.get_by_role("button", name="Open in my Chrome").click()
        window.wait_for_function("() => document.body.innerText.includes('the extension fills it there')", timeout=5_000)

    assert opened == [BLOCKED["posting_url"]]


# The Accounts tab (KAN-591): each Employer account, Copy password and Open sign-in page, no password in the page.

def test_the_accounts_tab_copies_a_password_it_never_shows(window):
    from datetime import date
    from types import SimpleNamespace

    from apply.accounts_tab import AccountsTab
    from apply.keychain import InMemoryKeychain
    from apply.tracker import EmployerAccount

    password, posting = "Fake-Keychain-Pw-7x!Q", "https://asml.wd3.myworkdayjobs.com/en-US/ASMLExternal/job/X_R1"
    account = EmployerAccount("ASML", "asml.wd3.myworkdayjobs.com", "lisul@example.com", date(2026, 11, 2))
    clipboard, opened = SimpleNamespace(text=""), []
    clipboard.put_secret = lambda text: setattr(clipboard, "text", text) or 1
    clipboard.clear = lambda written: setattr(clipboard, "text", "")
    tab = AccountsTab(lambda: [account], InMemoryKeychain({account.site: password}),
                      rows=lambda: [SimpleNamespace(posting_url=posting)], everyday=opened.append,
                      clipboard=clipboard, later=lambda seconds, then: None)
    with Dashboard(0, NoFrames(), accounts=tab) as board:
        window.goto(board.url)
        window.get_by_role("tab", name="Accounts").click()
        window.wait_for_selector("#accounts .account", timeout=10_000)
        assert "asml.wd3.myworkdayjobs.com" in window.inner_text("#accounts")
        window.get_by_role("button", name="Copy password").click()
        window.wait_for_function("() => document.body.innerText.includes('Paste it within a minute')", timeout=5_000)
        assert clipboard.text == password
        window.get_by_role("button", name="Open sign-in page").click()
        window.wait_for_function("() => document.body.innerText.includes('press Sign In there')", timeout=5_000)
        html = window.content()

    assert opened == [posting]
    assert password not in html


def test_a_window_with_no_accounts_tab_shows_none():
    with Dashboard(0, NoFrames()) as board:
        assert "tab-accounts" not in board.page()


@pytest.mark.parametrize("plain", [True, False])
def test_go_to_question_never_raises_a_plain_workers_window(monkeypatch, plain):
    shown, url = [], "https://jobs.lever.co/a/1/apply"
    monkeypatch.setattr(dashboard, "GO_TO_WAIT", 0.2)
    with Dashboard(1, NoFrames(), show=lambda k: shown.append(k) or True, quiet=lambda k: plain) as board:
        board.update(0, posting_url=url, status="ready to submit")
        with pytest.raises(dashboard.Refused):  # no held form answers here: only whether it came forward
            board.go_to({"worker": 0, "posting_url": url}, "Email")
    assert shown == ([] if plain else [0])  # a plain Worker's window comes forward only by Lisul's Show


def _window(board) -> dict:
    """The headers the Apply window's own page sends with a tile's input."""
    return {"X-Apply-Token": board.token, "Origin": board.url}


def test_a_tiles_input_comes_only_from_the_window_itself():
    """A press on /input/k counts as Lisul's, so another page's request, or one with no token, reaches no tab."""
    board_frames = FakeFrames({0: jpeg(1280, 800)})
    with Dashboard(1, board_frames, now=lambda: datetime(2026, 11, 2, 9)) as board:
        board.update(0, company="Acme", application_id="a-1", status="filling")
        press = json.dumps({"type": "down", "x": 10, "y": 10, "w": 640, "h": 500, "button": "left"}).encode()
        for headers in ({}, {"Origin": "https://evil.example", "Content-Type": "text/plain"},
                        {"X-Apply-Token": "guessed", "Origin": board.url},
                        {"X-Apply-Token": board.token, "Origin": "https://evil.example"}):
            assert _status(board.url + "/input/0", data=press, headers=headers) == 403
    assert not board_frames.inputs

