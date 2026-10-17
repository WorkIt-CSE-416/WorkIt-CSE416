"""
Which job postings auto apply takes: the hiring systems the extension can
fill, read from the posting's apply_url host. Greenhouse only, for now
(auto-apply/architecture.md, "The batch"). Add a host here and the
Jobs page's Auto Apply buttons, the matches, a batch and a single queueing
all follow, since each reads this one rule.

Imports nothing of the app, so the job listing schema (app/schemas/jobs.py)
can use it without a cycle.
"""

import re

AUTO_APPLY_HOSTS = ("greenhouse.io",)

# The host is one of AUTO_APPLY_HOSTS or a subdomain of it
# (job-boards.greenhouse.io, boards.eu.greenhouse.io). Only the host counts:
# a company's own careers page with ?gh_jid= in its query is not Greenhouse's
# form. Written for both Python's re and Postgres's ~* (filters.py), so the
# SQL and the listing's flag agree.
AUTO_APPLY_URL_PATTERN = (
    r"^https?://([a-z0-9-]+\.)*("
    + "|".join(re.escape(host) for host in AUTO_APPLY_HOSTS)
    + r")([/:?#]|$)"
)
_AUTO_APPLY_URL = re.compile(AUTO_APPLY_URL_PATTERN, re.IGNORECASE)


def auto_apply_supported(apply_url: str) -> bool:
    """Whether auto apply takes the job posting at this apply_url."""
    return _AUTO_APPLY_URL.match(apply_url) is not None
