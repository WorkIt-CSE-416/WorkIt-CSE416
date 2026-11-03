"""`apply login` and the WorkIt client, against a fake WorkIt (fake_workit.py).

The student signs in to WorkIt in a browser one time; Apply keeps the session
in the data folder and refreshes its access token by itself."""

import re
import stat

import pytest
from fake_workit import FakeWorkIt

from apply import workit
from apply.home import CODE
from apply.workit import LoginExpired, NotLoggedIn, Unreachable, WorkIt


def signs_in_with(cookies):
    """A browser where the student has signed in: it gives Apply the web app's cookies."""
    return lambda url, accept: accept(cookies)


def logged_in(fake, tmp_path) -> WorkIt:
    client = WorkIt(fake.site, tmp_path / "workit-login.json")
    workit.login(client, signs_in_with(fake.cookies(fake.session())))
    fake.requests.clear()
    return client


def test_login_keeps_the_session_in_the_data_folder_for_this_user_only(tmp_path):
    with FakeWorkIt() as fake:
        client = WorkIt(fake.site, tmp_path / "workit-login.json")
        account = workit.login(client, signs_in_with(fake.cookies(fake.session())))

        assert account.email == "test.person@example.com"
        saved = (tmp_path / "workit-login.json").read_text()
        assert "refresh-1" in saved
        assert stat.S_IMODE((tmp_path / "workit-login.json").stat().st_mode) == 0o600
        assert WorkIt(fake.site, tmp_path / "workit-login.json").me().email == "test.person@example.com"


def test_login_waits_while_the_browser_has_no_session(tmp_path):
    with FakeWorkIt() as fake:
        client = WorkIt(fake.site, tmp_path / "workit-login.json")
        pages = [{}, {"other": "cookie"}, fake.cookies(fake.session())]

        def browser(url, accept):
            assert url == f"{fake.url}/login"
            return next(found for found in map(accept, pages) if found)

        assert workit.login(client, browser).email == "test.person@example.com"


def test_an_expired_access_token_is_refreshed_without_a_new_sign_in(tmp_path):
    with FakeWorkIt() as fake:
        client = logged_in(fake, tmp_path)
        fake.expire()

        assert client.me().email == "test.person@example.com"
        # Supabase rotates the refresh token: the new one is kept, so the next refresh works too.
        assert "refresh-2" in (tmp_path / "workit-login.json").read_text()
        fake.expire()
        assert client.me().email == "test.person@example.com"
        assert "refresh-3" in (tmp_path / "workit-login.json").read_text()


def test_an_access_token_near_its_end_is_refreshed_before_it_is_sent(tmp_path):
    with FakeWorkIt() as fake:
        client = WorkIt(fake.site, tmp_path / "workit-login.json")
        workit.login(client, signs_in_with(fake.cookies(fake.session(expires_in=30))))
        fake.requests.clear()

        assert client.me().email == "test.person@example.com"
        assert [r.path for r in fake.requests] == ["/auth/v1/token?grant_type=refresh_token", "/auth/me"]


def test_a_revoked_login_is_expired(tmp_path):
    with FakeWorkIt() as fake:
        client = logged_in(fake, tmp_path)
        fake.revoke()

        with pytest.raises(LoginExpired):
            client.me()


def test_no_login(tmp_path):
    with FakeWorkIt() as fake, pytest.raises(NotLoggedIn):
        WorkIt(fake.site, tmp_path / "workit-login.json").me()


def test_workit_down_is_unreachable(tmp_path):
    with FakeWorkIt() as fake:
        client = logged_in(fake, tmp_path)
        fake.stop()

        with pytest.raises(Unreachable):
            client.me()


def test_the_supabase_project_is_the_one_the_extension_uses():
    """Apply signs in to the same Supabase project as the web app and the extension (public values)."""
    config = (CODE.parent / "autofiller_extension/src/shared/config.js").read_text()
    assert re.search(r'SUPABASE_URL = "([^"]+)"', config)[1] == workit.LIVE.auth
    assert re.search(r'SUPABASE_ANON_KEY =\s*"([^"]+)"', config)[1] == workit.LIVE.anon_key
    assert workit.LIVE.cookie == re.search(r'SUPABASE_SESSION_COOKIE_KEY = "([^"]+)"', config)[1]
    assert re.search(r'web: "([^"]+)", api: "([^"]+)"', config).groups() == (workit.LIVE.web, workit.LIVE.api)


def test_requests_name_apply_not_python(tmp_path):
    """Cloudflare, in front of WorkIt's API, refuses Python-urllib's user agent (error 1010, seen live 2026-11-02)."""
    with FakeWorkIt() as fake:
        logged_in(fake, tmp_path).me()
        agents = {r.headers.get("user-agent", "") for r in fake.requests}
    assert agents and not any(a.startswith("Python-urllib") for a in agents)
