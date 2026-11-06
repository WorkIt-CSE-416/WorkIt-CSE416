"""The live JobSite's browsers, run headless on a local page (no network)."""

import json
import os
import threading
import urllib.request

import pytest

from apply.browsers import ProfileInUse, WorkerBrowsers, cdp_endpoint, google_account

REMEMBER = "localStorage.setItem('signed_in', 'yes')"
RECALL = "localStorage.getItem('signed_in')"


def test_each_worker_keeps_its_own_persistent_worker_profile(tmp_path):
    page_file = tmp_path / "page.html"
    page_file.write_text("<!doctype html><title>Posting</title>")
    url = page_file.as_uri()
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(url, worker=0) as page:
        page.evaluate(REMEMBER)
    seen = {}

    def look(worker: int):
        with browsers.open(url, worker=worker) as page:
            seen[worker] = page.evaluate(RECALL)

    threads = [threading.Thread(target=look, args=(n,)) for n in (0, 1)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert seen == {0: "yes", 1: None}
    assert sorted(p.name for p in (tmp_path / "profiles").iterdir()) == ["worker-1", "worker-2"]


def test_a_workers_open_form_can_be_driven_from_outside_over_cdp(tmp_path):
    # Claude fill's Playwright MCP attaches to the Worker's own
    # browser this way, to work the page the Worker opened.
    page_file = tmp_path / "form.html"
    page_file.write_text("<!doctype html><title>Form</title><input aria-label=Name>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    with browsers.open(page_file.as_uri(), worker=1) as page:
        endpoint = cdp_endpoint(page)
        targets = json.load(urllib.request.urlopen(f"{endpoint}/json/list"))
        assert browsers.endpoint(1) == endpoint  # what the dashboard, on a thread of its own, finds it by

    assert endpoint.startswith("http://127.0.0.1:")
    assert page_file.as_uri() in [t["url"] for t in targets if t["type"] == "page"]


@pytest.mark.parametrize("cut_short", [1, 2])
def test_a_first_load_another_navigation_interrupts_is_tried_again(tmp_path, monkeypatch, cut_short):
    # Chrome may navigate its first tab to about:blank as it starts (PDT Partners, 2026-11-04).
    from playwright.sync_api import Error, Page

    page_file = tmp_path / "page.html"
    page_file.write_text("<!doctype html><title>Posting</title>")
    real, tries = Page.goto, []

    def goto(page, url, **options):
        tries.append(url)
        if len(tries) <= cut_short:
            raise Error(f'Page.goto: Navigation to "{url}" is interrupted by another navigation to "about:blank"')
        return real(page, url, **options)

    monkeypatch.setattr(Page, "goto", goto)
    with WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None).open(page_file.as_uri()) as page:
        assert page.title() == "Posting"
    assert len(tries) == cut_short + 1


def test_a_first_load_cut_short_three_times_fails(tmp_path, monkeypatch):
    from playwright.sync_api import Error, Page

    def goto(page, url, **options):
        raise Error(f'Page.goto: Navigation to "{url}" is interrupted by another navigation to "about:blank"')

    monkeypatch.setattr(Page, "goto", goto)
    with pytest.raises(Error, match="interrupted by another navigation"):
        with WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None).open("about:blank"):
            pass


def test_apply_profiles_names_the_folder_of_worker_profiles(tmp_path, monkeypatch):
    # So any checkout can use the profiles Lisul signed in to Google.
    monkeypatch.setenv("APPLY_PROFILES", str(tmp_path / "signed-in"))
    page_file = tmp_path / "page.html"
    page_file.write_text("<!doctype html><title>Posting</title>")

    with WorkerBrowsers(headless=True, channel=None).open(page_file.as_uri(), worker=2):
        pass

    assert (tmp_path / "signed-in" / "worker-3").is_dir()


def test_a_worker_runs_headless_as_real_chrome_with_no_window(tmp_path):
    # Lisul watches the Workers in the dashboard, so their Chrome needs no window: a
    # minimized or off-screen window stops painting on macOS and its tile goes blank.
    options = WorkerBrowsers(tmp_path).launch_options(3)

    assert options["headless"] is True
    assert options["channel"] == "chrome"  # real Chrome's new headless mode, with the Worker profile's Google session
    assert options["chromium_sandbox"] is True  # no "unsupported command-line flag: --no-sandbox" bar
    assert options["viewport"] == {"width": 1280, "height": 800}  # shaped like a dashboard tile
    assert "Headless" not in options["user_agent"] and "Chrome/" in options["user_agent"]
    assert not any(a.startswith(("--window-position", "--window-size")) for a in options["args"])
    assert "--hide-crash-restore-bubble" in options["args"]
    assert "--disable-blink-features=AutomationControlled" in options["args"]  # Google refuses a webdriver


def test_a_worker_page_does_not_say_webdriver(tmp_path):
    # Chrome sets navigator.webdriver for any DevTools port or pipe, and Google's sign-in then
    # refuses Sign in with Google: "This browser or app may not be secure" (KLA, 2026-11-03).
    with WorkerBrowsers(tmp_path, headless=True, channel=None).open("about:blank") as page:
        assert page.evaluate("navigator.webdriver") is False


def test_headed_workers_remain_possible_for_debugging(tmp_path):
    assert WorkerBrowsers(tmp_path, headless=False).launch_options(0)["headless"] is False


def _profile(root, name, email=None, lock_pid=None):
    profile = root / name
    (profile / "Default" / "Cache").mkdir(parents=True)
    accounts = [{"email": email}] if email else []
    (profile / "Default" / "Preferences").write_text(json.dumps({"account_info": accounts}))
    (profile / "Default" / "Cookies").write_text(f"cookies of {name}")
    if lock_pid:
        os.symlink(f"host-{lock_pid}", profile / "SingletonLock")
    return profile


def test_seed_copies_a_signed_in_profile_into_each_one_without_google(tmp_path):
    _profile(tmp_path, "worker-1", "lisul@example.com")
    _profile(tmp_path, "worker-2", "lisul@example.com")
    _profile(tmp_path, "worker-4")  # made by an earlier rehearsal, never signed in

    seeded = WorkerBrowsers(tmp_path).seed(5)

    assert [p.name for p in seeded] == ["worker-3", "worker-4", "worker-5"]
    assert all(google_account(tmp_path / f"worker-{n}") == "lisul@example.com" for n in range(1, 6))
    assert (tmp_path / "worker-4" / "Default" / "Cookies").read_text() == "cookies of worker-1"
    assert not (tmp_path / "worker-4" / "Default" / "Cache").exists()


def test_seed_leaves_a_profile_a_browser_has_open(tmp_path):
    _profile(tmp_path, "worker-1", "lisul@example.com")
    _profile(tmp_path, "worker-2", lock_pid=os.getpid())  # open in a live browser

    assert WorkerBrowsers(tmp_path).seed(2) == []
    assert google_account(tmp_path / "worker-2") is None


def test_seed_does_nothing_without_a_signed_in_profile(tmp_path):
    _profile(tmp_path, "worker-1")

    assert WorkerBrowsers(tmp_path).seed(3) == []
    assert not (tmp_path / "worker-2").exists()


TIKTOK_SESSION = {"name": "sessionid", "value": "lisul", "domain": ".lifeattiktok.com", "path": "/",
                  "expires": 2_000_000_000, "httpOnly": True, "secure": True, "sameSite": "Lax"}


def _signs_in_by_hand(context):
    """Plays Lisul signing in to TikTok in the window: the site sets its session cookie."""
    context.add_cookies([TIKTOK_SESSION])


def _tiktok_cookies(browsers, worker, url):
    with browsers.open(url, worker=worker) as page:
        return [c["value"] for c in page.context.cookies("https://lifeattiktok.com")]


def test_a_site_lisul_signs_one_profile_in_to_by_hand_reaches_every_worker_profile(tmp_path):
    page_file = tmp_path / "page.html"
    page_file.write_text("<!doctype html><title>Posting</title>")
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)
    for worker in (0, 1, 2):  # three Worker profiles, as earlier runs left them
        with browsers.open(page_file.as_uri(), worker=worker):
            pass

    signed_in = browsers.sign_in(page_file.as_uri(), _signs_in_by_hand)
    shared = browsers.share(signed_in)

    assert signed_in.name == "worker-1"
    assert [p.name for p in shared] == ["worker-2", "worker-3"]
    assert [_tiktok_cookies(browsers, w, page_file.as_uri()) for w in (0, 1, 2)] == [["lisul"]] * 3


def test_signing_in_refuses_while_any_worker_profile_is_open_in_another_browser(tmp_path):
    _profile(tmp_path, "worker-1", "lisul@example.com")
    _profile(tmp_path, "worker-2", "lisul@example.com", lock_pid=os.getpid())  # a run's Worker has it open
    browsers = WorkerBrowsers(tmp_path, headless=True, channel=None)
    opened = []

    with pytest.raises(ProfileInUse, match="worker-2"):
        browsers.sign_in("about:blank", opened.append)
    with pytest.raises(ProfileInUse, match="worker-2"):
        browsers.share(tmp_path / "worker-1")

    assert opened == []
    assert (tmp_path / "worker-2" / "Default" / "Cookies").read_text() == "cookies of worker-2"


def test_sharing_a_profile_leaves_the_worker_extensions_folder_alone(tmp_path):
    _profile(tmp_path, "worker-1")
    _profile(tmp_path, "worker-2")
    (tmp_path / "worker-extension").mkdir()
    (tmp_path / "worker-extension" / "manifest.json").write_text("{}")
    browsers = WorkerBrowsers(tmp_path, headless=True, channel=None)

    assert [p.name for p in browsers.share(tmp_path / "worker-1")] == ["worker-2"]
    assert [p.name for p in tmp_path.joinpath("worker-extension").iterdir()] == ["manifest.json"]


def test_a_worker_never_opens_a_worker_profile_another_browser_has_open(tmp_path):
    # A second run or rehearsal must not break the browser of the one going.
    busy = _profile(tmp_path, "worker-2", "lisul@example.com", lock_pid=os.getpid())
    (busy / "DevToolsActivePort").write_text("61234\n/devtools/browser/the-run-going\n")
    browsers = WorkerBrowsers(tmp_path, headless=True, channel=None)

    with pytest.raises(ProfileInUse, match="worker-2"):
        with browsers.open("about:blank", worker=1):
            pytest.fail("opened a Worker profile another browser has open")

    assert (busy / "DevToolsActivePort").read_text().startswith("61234")  # the run going is still reachable
    assert browsers.endpoint(1) == "http://127.0.0.1:61234"


def test_the_profile_lisul_signs_in_never_offers_to_save_his_password_and_no_saved_one_is_copied(tmp_path):
    browsers = WorkerBrowsers(tmp_path / "profiles", headless=True, channel=None)

    profile = browsers.sign_in("about:blank", lambda context: None)
    (profile / "Default" / "Login Data").write_text("a password Chrome kept")
    _profile(tmp_path / "profiles", "worker-2")
    browsers.share(profile)

    preferences = json.loads((profile / "Default" / "Preferences").read_text())
    assert preferences["credentials_enable_service"] is False
    assert preferences["profile"]["password_manager_enabled"] is False
    assert not (tmp_path / "profiles" / "worker-2" / "Default" / "Login Data").exists()


def test_the_sites_lisul_signed_the_worker_profiles_in_to_are_remembered_beside_them(tmp_path):
    assert WorkerBrowsers(tmp_path).signed_in() == frozenset()

    WorkerBrowsers(tmp_path).signed_in_to("lifeattiktok.com")
    WorkerBrowsers(tmp_path).signed_in_to("careersus-shure.icims.com")
    WorkerBrowsers(tmp_path).signed_in_to("lifeattiktok.com")

    assert WorkerBrowsers(tmp_path).signed_in() == {"lifeattiktok.com", "careersus-shure.icims.com"}


def test_a_headed_workers_window_is_brought_forward_when_lisul_asks(tmp_path, monkeypatch):
    from apply import browsers
    brought = []
    monkeypatch.setattr(browsers, "chrome_pid", lambda profile: 4242 if profile.name == "worker-2" else None)
    monkeypatch.setattr(browsers.KEEPER, "bring", lambda pid: brought.append(pid) or True)

    assert WorkerBrowsers(tmp_path, headless=False).show(1)
    assert not WorkerBrowsers(tmp_path, headless=False).show(0)  # not open
    assert not WorkerBrowsers(tmp_path, headless=True).show(1)  # no window to show
    assert brought == [4242]
