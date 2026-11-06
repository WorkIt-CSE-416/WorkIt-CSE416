"""`apply preflight <links...>`: what a batch of postings will need, before any form opens (KAN-668).

It groups the links by job system and site, says for each site whether a sign-in or account will
probably be needed, whether Keychain has an item for it and whether a signed-in Worker profile
exists, then prints the sign-ins to do first and the order and pacing plan.

It opens no page and fetches nothing from a job site: the job system comes from the link and the
Fill engine's `jobOf`, which runs in Node with no fetch. Pacing means turns (Workers, one site to a
Worker), never timed waits: a delay only imitates a person (research note, 2026-11-03).
"""

from collections.abc import Collection
from dataclasses import dataclass, field
from enum import StrEnum
from urllib.parse import urlsplit

from apply import fill_engine, walls
from apply.adapters import SetupError
from apply.model import Posting


class Need(StrEnum):
    """Whether a site will probably ask for a sign-in or an account."""

    YES = "yes"
    MAYBE = "maybe"
    NO = "no"
    UNKNOWN = "can't tell"


# What each job system asks, from its Filler and the forms Apply has filled. Another name is "other".
NEEDS = {
    "workday": (Need.YES, "an Employer account for each tenant"),
    "oracle": (Need.YES, "your email and a code it mails"),
    "icims": (Need.YES, "an Employer account for each employer"),
    "TikTok": (Need.YES, "a TikTok account"),
    "ByteDance": (Need.YES, "a ByteDance account"),
    "taleo": (Need.YES, "an Employer account for each employer"),
    "successfactors": (Need.YES, "an Employer account for each employer"),
    "eightfold": (Need.MAYBE, "some employers ask for an account"),
    "greenhouse": (Need.NO, "no account; a code may come by mail after Submit"),
    "lever": (Need.NO, "no account"),
    "ashby": (Need.NO, "no account"),
    "workable": (Need.NO, "no account"),
    "smartrecruiters": (Need.NO, "no account"),
    "rippling": (Need.NO, "no account"),
    "jobvite": (Need.NO, "no account"),
    "bamboohr": (Need.NO, "no account"),
    "paylocity": (Need.NO, "no account"),
}
# Job systems that the engine and Posting don't name, by the end of the link's host.
BY_HOST = {"taleo.net": "taleo", "successfactors.com": "successfactors", "successfactors.eu": "successfactors",
           "jobvite.com": "jobvite", "bamboohr.com": "bamboohr", "paylocity.com": "paylocity"}
OTHER = "Claude fill opens the page to see"


@dataclass
class Site:
    """The links of one job site, and what Apply knows of its sign-in with no page read."""

    name: str
    job_system: str
    links: list[str] = field(default_factory=list)
    need: Need = Need.UNKNOWN
    why: str = OTHER
    keychain: bool | None = False  # None: Keychain could not be read
    profile: bool = False
    bot_checked: bool = False  # one of policies.yaml's plain_worker_hosts

    @property
    def ready(self) -> bool:
        """Whether Apply has what it needs to get past this site's sign-in with no one there."""
        return self.need == Need.NO or bool(self.keychain) or self.profile


def _on(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _engine_job(url: str) -> dict:
    """The engine's answer for the link, in Node: no page and no fetch. A Mac without the engine has the link alone."""
    try:
        return fill_engine.job_of(url) or {}
    except (SetupError, OSError, RuntimeError):
        return {}


def job_system(url: str) -> str:
    """The job system of a link, from the link alone."""
    host = (urlsplit(url).hostname or "").lower()
    if name := walls.wall(url):
        return "icims" if name == "iCIMS" else name
    if name := _engine_job(url).get("site"):
        return name
    if (name := Posting("", "", "", url).job_system) != "other":
        return name
    if "gh_jid=" in url:  # a careers page with a Greenhouse form in it
        return "greenhouse"
    return next((name for domain, name in BY_HOST.items() if _on(host, domain)), "other")


def site_of(url: str) -> str:
    """The site one sign-in covers, as Keychain and `apply sign-in` name it: a Workday tenant, a wall's domain, or the host."""
    return _engine_job(url).get("tenant") or walls.site(url)


def group(urls: list[str], keychain: Collection[str] | None, signed_in: Collection[str], profiles: bool,
          bot_checked: Collection[str] = ()) -> list[Site]:
    """Each site of `urls`, with its links in the order given. `keychain` is None when it could not be read."""
    sites: dict[str, Site] = {}
    for url in dict.fromkeys(urls):
        name = site_of(url)
        if name not in sites:
            system = job_system(url)
            need, why = NEEDS.get(system, (Need.UNKNOWN, OTHER))
            sites[name] = Site(name, system, need=need, why=why,
                               keychain=None if keychain is None else name in keychain,
                               profile=profiles and name in signed_in,
                               bot_checked=any(_on(name, host) for host in bot_checked))
        sites[name].links.append(url)
    return list(sites.values())


def in_order(sites: list[Site]) -> list[Site]:
    """Sites Lisul must sign in to first, while he is there; then those that may ask; then the rest. Most links first in each."""
    rank = {Need.YES: 0, Need.MAYBE: 1, Need.UNKNOWN: 2, Need.NO: 3}
    return sorted(sites, key=lambda s: (s.ready and s.need != Need.NO, rank[s.need], -len(s.links)))


def to_do_first(sites: list[Site], mail: bool, mode: str, google: bool = False) -> tuple[list[str], list[str]]:
    """The sign-ins Lisul does before the batch, and those Apply does by itself (with Gmail, or a password in Keychain)."""
    his, apply_does = [], []
    for site in in_order(sites):
        if site.need != Need.YES or site.ready:
            if site.need == Need.YES and site.keychain:
                apply_does.append(f"{site.name}: signs in with the password in Keychain")
            continue
        first = site.links[0]
        if google and site.job_system == "workday":
            his.append(f"{site.name}: sign in with Google on the form when it pauses; Apply then goes on")
        elif mail:
            apply_does.append(f"{site.name}: makes the account and reads its code from Gmail; "
                              "if the account exists already, the form pauses for you")
        elif mode == "cdp":
            his.append(f"{site.name} ({site.why}): uv run apply sign-in {first}")
        else:
            his.append(f"{site.name} ({site.why}): no Gmail set up; sign in on the form when it pauses, "
                       "in the Worker the plan gives it")
    return his, apply_does


def _yes(value: bool | None) -> str:
    return "can't read" if value is None else "yes" if value else "no"


def report(sites: list[Site], workers: int, mail: bool, mode: str, google: bool = False) -> str:
    """What `apply preflight` prints."""
    ordered = in_order(sites)
    count = sum(len(s.links) for s in sites)
    columns = [("Site", "Job system", "Links", "Sign-in", "Keychain", "Profile")] + [
        (s.name, s.job_system, str(len(s.links)), s.need.value, _yes(s.keychain), _yes(s.profile)) for s in ordered]
    widths = [max(len(row[i]) for row in columns) for i in range(len(columns[0]))]
    table = ["  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip() for row in columns]
    lines = [f"Preflight: {count} link{'s' * (count != 1)} on {len(sites)} site{'s' * (len(sites) != 1)}. "
             "It opened no page and read no job site.", "", *table, ""]
    lines += [f"{s.name}: {s.why}" for s in ordered if s.need != Need.NO]
    his, apply_does = to_do_first(sites, mail, mode, google)
    lines += ["", "Sign-ins to do first:"] + ([f"  {i}. {line}" for i, line in enumerate(his, 1)] or ["  None."])
    if apply_does:
        lines += ["Apply does these itself:"] + [f"  - {line}" for line in apply_does]
    return "\n".join(lines + ["", *_plan(ordered, workers, mode)])


def _plan(ordered: list[Site], workers: int, mode: str) -> list[str]:
    """The order and pacing: turns, not timed waits. A plain Worker keeps one site's sign-in for later links (KAN-645)."""
    workers = max(1, min(workers, len(ordered)))
    lines = [f"Order and pacing: {workers} Worker{'s' * (workers != 1)} at once, with no timed waits."]
    for i, site in enumerate(ordered, 1):
        where = f"Browser {(i - 1) % workers + 1}: " if mode != "cdp" else ""
        caution = "; bot-checked: it needs a plain Worker, and worker_mode is cdp" if site.bot_checked and mode == "cdp" else ""
        lines.append(f"  {i}. {where}{site.name} ({len(site.links)} link{'s' * (len(site.links) != 1)}){caution}")
    if mode == "cdp":  # each form gets its own browser: one command, in this order, sites taking turns
        links = [site.links[n] for n in range(max(len(s.links) for s in ordered)) for site in ordered if n < len(site.links)]
        return lines + ["", "Run:", f"  uv run apply rehearse --workers {workers} " + " ".join(links)]
    first = [site.links[0] for site in ordered[:workers]]
    lines += ["", "Start with one site in each Worker:", f"  uv run apply rehearse --workers {workers} " + " ".join(first)]
    later = [(i % workers + 1, link) for i, site in enumerate(ordered)
             for link in (site.links[1:] if i < workers else site.links)]
    if later:
        lines += ["Then, once a Worker's form has stopped, each next link in the same Worker, so its sign-in holds "
                  "(PORT is the window's):"]
        lines += [f"  uv run apply rehearse --into PORT:{browser} {link}" for browser, link in later]
    return lines


# --- `apply preflight --open` (KAN-721): the open forms' sign-ins, after `apply reopen`

SIGNING_IN = "needs sign-in"  # a tile's status at a sign-in (rehearsal.SIGN_IN)


def open_report(forms: list[dict], tiles: list[dict]) -> str:
    """Which open forms' sites wait on Lisul's sign-in. `forms` is the open-forms list (apply.batch); `tiles`, the
    captions of the running Apply windows' tiles. A tile at a sign-in waits on him now; a form no window shows yet
    says what its job system will probably ask. It opens no page."""
    if not forms:
        return "No open form on the list (apply.batch): nothing to sign in to."
    shown = {}
    for tile in tiles:
        for key in (tile.get("posting_url"), tile.get("application_id")):
            if key:
                shown[key] = tile
    now: dict[str, list[str]] = {}
    later: dict[str, list[str]] = {}
    for form in forms:
        tile = shown.get(form.get("posting_url")) or shown.get(form.get("application_id"))
        site = site_of(form.get("posting_url") or form["link"])
        where = f"Browser {int(form.get('worker') or 0) + 1}"
        name = f"{form.get('company') or form['link']} ({where})"
        if tile is not None:
            if tile.get("status") == SIGNING_IN:
                now.setdefault(site, []).append(name)
        elif NEEDS.get(form.get("job_system") or "", (Need.UNKNOWN, ""))[0] in (Need.YES, Need.MAYBE):
            later.setdefault(site, []).append(name)
    lines = [f"Open forms: {len(forms)}. It opened no page."]
    lines += ["", "Sign in now, on the form's own page; Apply goes on by itself once you are in:"]
    lines += [f"  {i}. {site}: {', '.join(names)}" for i, (site, names) in enumerate(now.items(), 1)] or ["  None."]
    if later:
        lines += ["", "No window shows these yet; their sites will probably ask you to sign in (apply reopen):"]
        lines += [f"  - {site}: {', '.join(names)}" for site, names in later.items()]
    return "\n".join(lines)
