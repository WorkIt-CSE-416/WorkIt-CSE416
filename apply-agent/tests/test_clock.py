from datetime import datetime, timedelta

from apply.clock import SystemClock


def test_sleeps_until_the_wall_clock_reaches_the_wake_up_time():
    clock = SystemClock()
    wake = clock.now() + timedelta(milliseconds=50)

    clock.sleep_until(wake)

    assert datetime.now() >= wake
