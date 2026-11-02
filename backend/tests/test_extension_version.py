"""
The extension's version (KAN-466): the extension names its version on every
request (X-WorkIt-Extension). One below MIN_EXTENSION_VERSION gets 426, so
the panel says "Please update WorkIt" instead of a broken answer. A request
with no version (an older build, or the webapp) is let through.
"""

import logging

import httpx
import pytest

from app.config import get_settings
from app.main import app

pytestmark = pytest.mark.anyio


@pytest.fixture
def minimum(monkeypatch):
    monkeypatch.setenv("MIN_EXTENSION_VERSION", "0.3.0")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _health(headers: dict[str, str]) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as api:
        return await api.get("/health", headers=headers)


async def test_a_version_below_the_minimum_gets_426_with_the_minimum(minimum):
    for old in ("0.2.9", "0.1.0", "0.2.10"):
        response = await _health({"X-WorkIt-Extension": old})
        assert response.status_code == 426, old
        assert response.json()["detail"]["min_version"] == "0.3.0"


async def test_a_version_at_or_above_the_minimum_works(minimum):
    for current in ("0.3.0", "0.3", "0.3.1", "0.10.0", "1.0"):
        assert (await _health({"X-WorkIt-Extension": current})).status_code == 200, current


EXTENSION = {"Origin": "chrome-extension://cpklhdkoafegnndlafmiceehfloodjgi"}


async def test_a_request_with_no_version_is_let_through_and_an_extension_one_logged_at_debug(minimum, caplog):
    with caplog.at_level(logging.DEBUG, logger="app.main"):
        assert (await _health({})).status_code == 200
        assert (await _health(EXTENSION)).status_code == 200

    logged = [r for r in caplog.records if "no version" in r.getMessage()]
    # The webapp's server never names a version: only the extension's request is logged.
    assert [r.levelno for r in logged] == [logging.DEBUG]


async def test_the_extension_config_read_names_no_version_on_purpose_and_is_not_logged(database, minimum, caplog):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000") as api:
        with caplog.at_level(logging.DEBUG, logger="app.main"):
            await api.get("/extension/config", headers=EXTENSION)

    assert not [r for r in caplog.records if "no version" in r.getMessage()]


async def test_the_default_minimum_refuses_no_build():
    get_settings.cache_clear()
    assert (await _health({"X-WorkIt-Extension": "0.0.1"})).status_code == 200
