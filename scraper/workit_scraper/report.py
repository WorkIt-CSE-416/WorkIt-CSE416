"""Render the shortlist as one self-contained HTML file.

A row list, not a grid of facts. Providers disagree about what they will tell us --
Greenhouse sends no department, Lever no salary, Ashby most things -- so each row's
meta line prints whatever exists and omits the rest. A fixed grid would hold empty
slots open and read as broken data.

No external CSS or JS beyond a Google Fonts link, so the file opens from disk and
survives being emailed to someone.
"""

from __future__ import annotations

import html
from datetime import UTC, datetime
from pathlib import Path

from workit_scraper.shortlist import Role

_STYLE = """
:root{--ground:#F4F6F8;--surface:#fff;--ink:#141D26;--muted:#566876;--faint:#7C8C99;
--line:#DCE3E9;--accent:#0F5F5A;--accent-sm:#E1F0EE;--hot:#8A4B12;--hot-sm:#FBEEE0;
--f-display:Archivo,"Helvetica Neue",Arial,sans-serif;
--f-body:"IBM Plex Sans",system-ui,sans-serif;--f-data:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--ground:#0E141A;--surface:#161F28;--ink:#E7EDF2;--muted:#94A6B5;--faint:#6F8394;
--line:#26333F;--accent:#5CBBB0;--accent-sm:#14312F;--hot:#E0A86A;--hot-sm:#33240F}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--f-body);
font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:900px;margin:0 auto;padding:0 20px 80px}
header{padding:44px 0 20px;border-bottom:1px solid var(--line);margin-bottom:6px}
.eyebrow{font-family:var(--f-data);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
color:var(--accent);margin:0 0 10px}
h1{font-family:var(--f-display);font-weight:700;font-size:clamp(26px,5vw,38px);
letter-spacing:-.02em;margin:0 0 10px;text-wrap:balance}
.funnel{margin:0;color:var(--muted);font-family:var(--f-data);font-size:12.5px;
font-variant-numeric:tabular-nums}
.row{display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:baseline;
padding:15px 2px;border-bottom:1px solid var(--line)}
.row:hover{background:var(--surface)}
.tags{grid-column:1;grid-row:1;display:flex;gap:4px;flex-wrap:wrap}
.tag{font-family:var(--f-data);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
padding:2px 6px;border-radius:3px;background:var(--accent-sm);color:var(--accent);white-space:nowrap}
.tag.intern{background:var(--hot-sm);color:var(--hot)}
.title{grid-column:2;grid-row:1;font-family:var(--f-display);font-weight:600;font-size:15.5px}
.title a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}
.title a:hover{border-color:currentColor}
.apply{grid-column:3;grid-row:1;font-family:var(--f-data);font-size:11.5px;color:var(--faint);
text-decoration:none;white-space:nowrap}
.apply:hover{color:var(--accent)}
.meta{grid-column:2;grid-row:2;display:flex;flex-wrap:wrap;gap:2px 12px;font-size:13px;
color:var(--muted)}
.meta .co{color:var(--ink);font-weight:500}
.meta .src{font-family:var(--f-data);font-size:11.5px;color:var(--faint)}
footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;
color:var(--faint);max-width:72ch}
.empty{padding:60px 0;text-align:center;color:var(--faint)}
@media (max-width:640px){.row{grid-template-columns:1fr}
.tags,.title,.meta,.apply{grid-column:1}.apply{grid-row:3;text-align:left}}
"""


def _age(iso: str | None, *, now: datetime | None = None) -> str | None:
    """"12d ago" from an ISO timestamp, or None if there isn't one."""
    if not iso:
        return None
    try:
        then = datetime.fromisoformat(iso)
    except ValueError:
        return None
    days = ((now or datetime.now(UTC)) - then).days
    if days <= 0:
        return "today"
    if days == 1:
        return "1d ago"
    return f"{days}d ago"


def _row(role: Role) -> str:
    e = html.escape
    tags = "".join(
        f'<span class="tag {e(tag)}">{e(tag)}</span>' for tag in role.tags
    )
    title = (
        f'<a href="{e(role.apply_url)}" target="_blank" rel="noopener">{e(role.title)}</a>'
        if role.apply_url
        else e(role.title)
    )
    # Only facts that exist. A missing department or date prints nothing at all.
    bits = [f'<span class="co">{e(role.company)}</span>']
    for value in (role.location_label, role.department):
        if value:
            bits.append(f"<span>{e(value)}</span>")
    posted = _age(role.posted_at)
    if posted:
        bits.append(f"<span>posted {e(posted)}</span>")
    bits.append(f'<span class="src">via {e(role.ats)}</span>')
    apply_link = (
        f'<a class="apply" href="{e(role.apply_url)}" target="_blank" rel="noopener">Apply &#8599;</a>'
        if role.apply_url
        else ""
    )
    return (
        f'<div class="row"><div class="tags">{tags}</div>'
        f'<div class="title">{title}</div>{apply_link}'
        f'<div class="meta">{"".join(bits)}</div></div>'
    )


def render(roles: list[Role], stats: dict[str, int]) -> str:
    e = html.escape
    when = datetime.now(UTC).strftime("%b %d, %Y")
    funnel = (
        f"{len(roles)} distinct roles &middot; {stats.get('postings', 0):,} postings scanned "
        f"&middot; {stats.get('boards_ok', 0)} boards read"
    )
    if stats.get("boards_missing"):
        funnel += f" &middot; {stats['boards_missing']} not found"
    if stats.get("boards_skipped"):
        funnel += f" &middot; {stats['boards_skipped']} skipped by robots.txt"

    body = (
        "".join(_row(role) for role in roles)
        or '<p class="empty">No matching roles in this run.</p>'
    )
    return f"""<!doctype html>
<html lang="en"><meta charset="utf-8">
<title>Software internships &amp; new-grad roles</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<style>{_STYLE}</style>
<body><div class="wrap">
<header>
  <p class="eyebrow">WorkIt &middot; scraped {e(when)}</p>
  <h1>Software internships &amp; new-grad roles</h1>
  <p class="funnel">{funnel}</p>
</header>
{body}
<footer>
  Scraped directly from each employer's own job board via the Greenhouse, Lever and
  Ashby public APIs, honouring every board's robots.txt. Ages are the date the
  employer published the posting; <strong>first seen</strong> is our own clock and
  becomes the more trustworthy signal from the second run onward, because an employer
  can re-stamp a publish date but not someone else's observation of it.
</footer>
</div></body></html>
"""


def write_html(roles: list[Role], stats: dict[str, int], path: Path) -> Path:
    path.write_text(render(roles, stats), encoding="utf-8")
    return path
