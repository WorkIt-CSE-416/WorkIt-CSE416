"""Bot signals: what a job system does when it seems to take a Worker's
browser for a bot. Each Tracker row a Worker filled notes how its Chrome ran
(headless or headed, policies.yaml: worker_headless) and the Bot signals it
met, so the two modes can be compared before one is chosen."""

from collections import Counter

# A captcha's picture or puzzle challenge, which a Worker never solves.
CAPTCHA = "captcha"
# Greenhouse's step asking for the code it emails, before it takes the form.
SECURITY_CODE = "security code"
# The job system refused the sent form, as Ashby does when reCAPTCHA scores the browser low.
REFUSED = "refused"
# A page that refused the browser outright, with nothing to solve (apply.captcha.BLOCKS): Tesla's, DataDome's, Lever's.
BLOCKED = "blocked"


def cell(headless: bool, signals: tuple[str, ...]) -> str:
    """The row's Bot signals cell: the mode, then any signals, as "headless: captcha"."""
    mode = "headless" if headless else "headed"
    return f"{mode}: {', '.join(signals)}" if signals else mode


def summary(rows) -> str:
    """`apply signals`: over the Tracker's rows, how many filled Applications
    each mode ran and how many met each Bot signal, overall and per job system."""
    counts: dict[str, dict[str, Counter]] = {}
    for row in rows:
        if not row.bot_signals:
            continue  # no browser filled its form
        mode, _, names = row.bot_signals.partition(":")
        for scope in ("", row.job_system):
            tally = counts.setdefault(mode.strip(), {}).setdefault(scope, Counter())
            tally[""] += 1  # the Applications
            tally.update(n.strip() for n in names.split(",") if n.strip())
    if not counts:
        return "No filled Applications in the Tracker yet, so no Bot signals to count."
    lines = ["Bot signals per filled Application, by how the Workers' Chrome ran:"]
    for mode in sorted(counts, key=lambda m: (m != "headless", m)):
        for scope, tally in sorted(counts[mode].items()):
            applications = tally.pop("")
            met = ", ".join(f"{name} {n}" for name, n in sorted(tally.items())) or "none"
            label = f"  {scope}" if scope else mode
            lines.append(f"{label}: {applications} Application{'s' * (applications != 1)}; {met}")
    return "\n".join(lines)
