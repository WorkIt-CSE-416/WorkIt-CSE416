"""
How many Scout messages each account has sent today.

In memory on purpose: a restart or a second worker resets the count, which
errs toward letting people in. That is fine while the cap exists to stop a
runaway script from spending a free tier, not to bill anyone. Move it to the
database when it has to be exact.
"""

from collections import Counter
from collections.abc import Hashable
from datetime import UTC, date, datetime


class DailyQuota:
    def __init__(self) -> None:
        self._day: date | None = None
        self._used: Counter[Hashable] = Counter()

    def take(self, key: Hashable, limit: int) -> bool:
        """Spend one of `key`'s turns for today. False when none are left."""
        today = datetime.now(UTC).date()
        if today != self._day:
            self._day, self._used = today, Counter()
        if self._used[key] >= limit:
            return False
        self._used[key] += 1
        return True
