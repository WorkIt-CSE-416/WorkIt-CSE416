"""The live Clock."""

import time
from datetime import datetime

# A Mac asleep doesn't count down time.sleep, so sleep in short steps and
# check the wall clock after each.
STEP_SECONDS = 60


class SystemClock:
    def now(self) -> datetime:
        return datetime.now()

    def sleep_until(self, when: datetime) -> None:
        while (left := (when - datetime.now()).total_seconds()) > 0:
            time.sleep(min(left, STEP_SECONDS))
