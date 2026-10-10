"""Render the shortlist as one self-contained HTML table.

Laid out as a data table -- numbered rows, one fact per column -- because that is what
makes a thousand roles scannable. Columns follow the order a job hunter reads them in:
what the role is, when it went up, how to apply, where, and who.

A cell is blank when the provider did not say. Greenhouse publishes no work model at
all, so that column is mostly empty for Greenhouse boards; printing "On site" there
would put a fact on the page no employer stated.

No webfonts and no external anything: the file renders identically with the network
off, which is the point of `--offline`.

The header carries one number an aggregator cannot honestly publish: `new today`. Sites
that re-report LinkedIn and Indeed know when *they* ingested a posting, not when it
appeared. `first_seen_at` is our own observation of the employer's own board, so once
there is an earlier read to compare against this number is a fact. `Store.is_new`
defines it; this module only prints it, with the time of the scrape it describes.
"""

from __future__ import annotations

import html
from datetime import UTC, datetime
from pathlib import Path

from workit_scraper.shortlist import Role, Tag
from workit_scraper.store import RunStats

#: Rows rendered before the "show all" control. At ~1,000 roles an uncapped page is
#: slow to scroll on a projector.
INITIAL_ROWS = 200

FILTERS = [
    ("all", "All"),
    (Tag.INTERN, "Internships"),
    (Tag.NEW_GRAD, "New grad"),
    (Tag.SOFTWARE, "Software"),
    (Tag.DATA_AI, "Data & AI"),
    (Tag.PRODUCT, "Product"),
    (Tag.QUANT, "Quant"),
    (Tag.HARDWARE, "Hardware"),
]

_STYLE = """
:root{--bg:#fff;--ink:#12161C;--grey:#5B6675;--faint:#98A2AE;--line:#E6EAEE;
--head:#F6F8F9;--mint:#0F9D58;--mint-bg:#E6F6EE;--hover:#F9FBFC;
--remote:#0E7C86;--remote-bg:#E2F4F5;--hybrid:#4B4ACF;--hybrid-bg:#ECECFB}
@media (prefers-color-scheme:dark){:root{--bg:#10141A;--ink:#EAEFF4;--grey:#9BA7B4;
--faint:#6C7885;--line:#222932;--head:#171D25;--mint:#4ED18C;--mint-bg:#123024;
--hover:#151B22;--remote:#63C9D1;--remote-bg:#0F2B2E;--hybrid:#9B9BF0;--hybrid-bg:#1D1D3A}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 18px 70px}
h1{font-size:23px;font-weight:800;letter-spacing:-.02em;margin:30px 0 4px}
.asof{margin:0 0 20px;font-size:13px;color:var(--faint)}
.tiles{display:flex;flex-wrap:wrap;gap:34px;margin:0 0 22px;padding:0;list-style:none}
.tiles div b{display:block;font-size:31px;font-weight:800;color:var(--mint);
letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1}
.tiles div span{font-size:13.5px;font-weight:700}
.tiles div small{display:block;font-size:12px;color:var(--faint);font-weight:400}
.bar{position:sticky;top:0;background:var(--bg);padding:11px 0;border-bottom:1px solid var(--line);
display:flex;flex-wrap:wrap;gap:7px;align-items:center;z-index:3}
.chip{font:13px inherit;padding:6px 13px;border-radius:999px;border:1px solid var(--line);
background:var(--bg);color:var(--grey);cursor:pointer}
.chip:hover{color:var(--ink)}
.chip[aria-pressed="true"]{background:var(--mint-bg);border-color:var(--mint);color:var(--mint);
font-weight:600}
.count{margin-left:auto;font-size:13px;color:var(--faint);font-variant-numeric:tabular-nums}
/* Fixed layout so the table fits any viewport: cells ellipsis instead of pushing the
   last column off-screen, which is what content-sized columns did at 1024px. */
table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:2px}
th:nth-child(1){width:42px}th:nth-child(3){width:112px}th:nth-child(4){width:86px}
th:nth-child(5){width:108px}th:nth-child(6){width:19%}th:nth-child(7){width:17%}
th{position:sticky;top:47px;background:var(--head);text-align:left;font-size:12px;
font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--grey);
padding:9px 10px;border-bottom:1px solid var(--line);z-index:2}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:hover td{background:var(--hover)}
tr[hidden]{display:none}
.n{color:var(--faint);font-size:12.5px;font-variant-numeric:tabular-nums;width:1%;
text-align:right;padding-right:4px}
.role{font-weight:650;color:var(--ink);text-decoration:none;display:block;
overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.role:hover{color:var(--mint)}
.kind{font-size:11px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em}
.when{color:var(--grey);font-size:13.5px;white-space:nowrap}
.new{color:var(--mint);font-weight:700}
.apply{display:inline-block;padding:5px 13px;border-radius:5px;background:var(--mint);
color:#fff;font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}
.apply:hover{filter:brightness(1.08)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;
white-space:nowrap}
.pill.Remote{background:var(--remote-bg);color:var(--remote)}
.pill.Hybrid{background:var(--hybrid-bg);color:var(--hybrid)}
.pill.Onsite{background:var(--head);color:var(--grey)}
.where,.co{color:var(--grey);font-size:13.5px;overflow:hidden;
text-overflow:ellipsis;white-space:nowrap}
.co{color:var(--ink);font-weight:600}
.more{display:block;width:100%;margin-top:18px;padding:13px;font:14px inherit;
border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--mint);
font-weight:700;cursor:pointer}
.more:hover{background:var(--hover)}
.more[hidden]{display:none}
footer{margin-top:24px;padding-top:15px;border-top:1px solid var(--line);font-size:12.5px;
color:var(--faint);max-width:78ch}
.empty{padding:54px 0;text-align:center;color:var(--faint)}
@media (max-width:1000px){.hide-sm{display:none}
th:nth-child(6),th:nth-child(7){width:auto}th:nth-child(7){width:26%}}
@media (max-width:620px){.tiles{gap:20px}.tiles div b{font-size:25px}}
"""

_SCRIPT = """
const rows=[...document.querySelectorAll('tbody tr')];
const countEl=document.getElementById('count'),moreEl=document.getElementById('more');
let filter='all',cap=%d;
function apply(){
  let n=0;
  for(const r of rows){
    const ok = filter==='all' || r.dataset.tags.split(' ').includes(filter);
    if(ok){ n++; r.firstElementChild.textContent = n; }
    r.hidden = !(ok && n<=cap);
  }
  countEl.textContent = n>cap ? `${cap} of ${n}` : `${n} roles`;
  moreEl.hidden = n<=cap;
  moreEl.textContent = `Show all ${n}`;
}
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
  filter=c.dataset.filter; cap=%d;
  document.querySelectorAll('.chip').forEach(o=>o.setAttribute('aria-pressed',String(o===c)));
  apply();
});
moreEl.onclick=()=>{cap=rows.length;apply();};
apply();
"""


def _ago(iso: str | None) -> str:
    """How long ago a posting went up, at the coarsest useful unit."""
    if not iso:
        return "—"
    try:
        then = datetime.fromisoformat(iso)
    except ValueError:
        return "—"
    seconds = (datetime.now(UTC) - then).total_seconds()
    if seconds < 3600:
        return f"{max(int(seconds // 60), 1)} min ago"
    if seconds < 86400:
        return f"{int(seconds // 3600)} hours ago"
    days = int(seconds // 86400)
    if days < 30:
        return f"{days} day{'s' if days > 1 else ''} ago"
    if days < 365:
        return f"{days // 30} month{'s' if days // 30 > 1 else ''} ago"
    return f"{days // 365} year{'s' if days // 365 > 1 else ''} ago"


def _stamp(iso: str) -> str:
    """ "Sep 28, 2026, 19:10 UTC". Built by hand: `%-d` is not portable to Windows."""
    at = datetime.fromisoformat(iso).astimezone(UTC)
    return f"{at:%b} {at.day}, {at:%Y, %H:%M} UTC"


def _row(role: Role, index: int) -> str:
    esc = html.escape
    kind = " · ".join(tag for tag in role.tags if tag != Tag.SOFTWARE)
    title = esc(role.title)
    kind_span = f'<span class="kind">{esc(kind)}</span>'
    role_cell = (
        (
            f'<a class="role" href="{esc(role.apply_url)}" target="_blank" rel="noopener" '
            f'title="{title}">{title}</a>{kind_span}'
        )
        if role.apply_url
        else f'<span class="role" title="{title}">{title}</span>{kind_span}'
    )
    when = "just added" if role.new else _ago(role.posted_at)
    style = role.facts.work_style or ""
    pill = f'<span class="pill {esc(style.replace(" ", ""))}">{esc(style)}</span>' if style else ""
    apply_cell = (
        f'<a class="apply" href="{esc(role.apply_url)}" target="_blank" rel="noopener">Apply</a>'
        if role.apply_url
        else ""
    )
    return (
        f'<tr data-tags="{esc(" ".join(role.tags))}">'
        f'<td class="n">{index}</td>'
        f"<td>{role_cell}</td>"
        f'<td class="when{" new" if role.new else ""}">{esc(when)}</td>'
        f"<td>{apply_cell}</td>"
        f'<td class="hide-sm">{pill}</td>'
        f'<td class="where hide-sm" title="{esc(role.location_label)}">'
        f"{esc(role.location_label)}</td>"
        f'<td class="co" title="{esc(role.company)}">{esc(role.company)}</td>'
        "</tr>"
    )


def render(roles: list[Role], stats: RunStats, scraped_at: str, *, counts_new: bool) -> str:
    """The page. `counts_new` is False until an earlier read exists to compare against,
    and then the tile says so instead of printing a number it has not earned."""
    esc = html.escape
    new_count = sum(role.new for role in roles)

    tiles = [
        (
            f"{new_count:,}" if counts_new else "—",
            "New Today",
            "first seen in the 24 h before this scrape"
            if counts_new
            else "counts start on the next run",
        ),
        (f"{len(roles):,}", "Open Roles", f"{len({r.company for r in roles}):,} companies"),
        (
            f"{stats.postings:,}",
            "Postings Scanned",
            f"across {stats.boards_ok:,} company job boards",
        ),
    ]
    tile_html = "".join(
        f"<div><b>{value}</b><span>{esc(label)}</span><small>{esc(sub)}</small></div>"
        for value, label, sub in tiles
    )
    chips = "".join(
        f'<button class="chip" data-filter="{key}" '
        f'aria-pressed="{"true" if key == "all" else "false"}">{esc(label)}</button>'
        for key, label in FILTERS
    )
    body = "".join(_row(role, i) for i, role in enumerate(roles, 1))
    table = (
        "<table><thead><tr>"
        '<th class="n"></th><th>Position Title</th><th>Date</th><th>Apply</th>'
        '<th class="hide-sm">Work Model</th><th class="hide-sm">Location</th><th>Company</th>'
        f"</tr></thead><tbody>{body}</tbody></table>"
        if roles
        else '<p class="empty">No matching roles in this run.</p>'
    )

    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8">
<title>Internships &amp; New Grad Roles</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{_STYLE}</style>
<body><div class="wrap">
<h1>Internships &amp; New Grad Roles</h1>
<p class="asof">Scraped {esc(_stamp(scraped_at))}</p>
<div class="tiles">{tile_html}</div>
<div class="bar">{chips}<span class="count" id="count"></span></div>
{table}
<button class="more" id="more" hidden></button>
<footer>
  Scraped straight from each employer's own job board through the Greenhouse, Lever and
  Ashby public APIs, honouring every board's robots.txt. Dates are when the employer
  published the posting; a blank work model means the employer did not state one.
  <b>New today</b> counts roles first seen in the 24 hours before this scrape, on boards
  we were already watching &mdash; our own observation, which is why it can be stated at
  all: a site that re-reports someone else's feed knows when it ingested a posting, not
  when it appeared. <b>Open roles</b> are those present the last time we read their
  board in full.
</footer>
</div>
<script>{_SCRIPT % (INITIAL_ROWS, INITIAL_ROWS)}</script>
</body></html>
"""


def write_html(
    roles: list[Role], stats: RunStats, path: Path, scraped_at: str, *, counts_new: bool
) -> None:
    path.write_text(render(roles, stats, scraped_at, counts_new=counts_new), encoding="utf-8")
