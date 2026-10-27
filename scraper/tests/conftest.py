from __future__ import annotations

from dataclasses import replace

import pytest

from workit_scraper import providers


@pytest.fixture
def swap_provider(monkeypatch):
    """Change some of one provider's fields for one test: `swap_provider("greenhouse",
    describe=fake)`. A `Provider` holds its functions, so patching the module's
    `describe_greenhouse` would not reach it."""

    def swap(ats: str, **changes) -> None:
        monkeypatch.setitem(providers.PROVIDERS, ats, replace(providers.PROVIDERS[ats], **changes))

    return swap
