"""`PROVIDERS`, every hiring system's record keyed by its `ats`, and what reads
it: the URLs a board and a posting are read at, and `describe`."""

from __future__ import annotations

from workit_scraper.providers.model import Job, Provider

#: Every hiring system's record, keyed by the `ats` in boards.csv. Filled by
#: `workit_scraper.providers` once each system's module has loaded: one dict, so a
#: reader, the store and a test that swaps an entry all see the same records.
PROVIDERS: dict[str, Provider] = {}


def _parts(ats: str, token: str) -> dict[str, str]:
    """A Workday token's three parts: "nvidia.wd5/nvidiaexternalcareersite" is the
    tenant `nvidia`, on data centre `wd5`, careers site `nvidiaexternalcareersite`.
    A tenant can run several sites (Boeing has 40), each its own board. An Oracle
    token's two: "edbz.fa.us2/cx" is the host `edbz.fa.us2.oraclecloud.com` and the
    careers site `cx`."""
    if ats == "oracle":
        host, site = token.split("/")
        return {"host": host, "site": site}
    if ats != "workday":
        return {}
    host, site = token.split("/")
    tenant, wd = host.split(".")
    return {"tenant": tenant, "wd": wd, "site": site}


def listing_url(ats: str, token: str) -> str:
    return PROVIDERS[ats].listing_url.format(token=token, **_parts(ats, token))


def robots_urls(ats: str, token: str) -> list[str]:
    """Every URL robots.txt must allow before a board is read: its list, and its
    `careers_site` where it has one."""
    urls = [listing_url(ats, token)]
    if site := PROVIDERS[ats].careers_site:
        urls.append(site.format(**_parts(ats, token)))
    return urls


def job_url(ats: str, token: str, job_id: str) -> str:
    """A kept posting's own page; only for a provider with a `job_url`."""
    template = PROVIDERS[ats].job_url
    assert template is not None, f"{ats} has no page to read"
    return template.format(token=token, job_id=job_id, **_parts(ats, token))


def describe(job: Job) -> Job:
    """`job` with its own page read; only for a provider with a `describe`."""
    reader = PROVIDERS[job.ats].describe
    assert reader is not None, f"{job.ats} has no page to read"
    return reader(job)
