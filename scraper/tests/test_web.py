import urllib.error

import pytest

from workit_scraper import web


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self):
        return b"abc"


def test_stats_count_failed_requests_but_not_their_bytes(monkeypatch):
    def refuse(request, *, timeout):
        raise urllib.error.HTTPError(request.full_url, 429, "Too Many Requests", {}, None)

    before = web.stats()
    monkeypatch.setattr(web._OPENER, "open", refuse)
    with pytest.raises(urllib.error.HTTPError):
        web.get("https://boards.example.com/a", timeout=3)
    with pytest.raises(urllib.error.HTTPError):
        web.post("https://boards.example.com/b", {}, timeout=3)
    monkeypatch.setattr(web._OPENER, "open", lambda request, *, timeout: _Response())
    web.get("https://boards.example.com/c", timeout=3)

    after = web.stats()
    assert after["requests"] - before["requests"] == 3
    assert after["received_bytes"] - before["received_bytes"] == 3
