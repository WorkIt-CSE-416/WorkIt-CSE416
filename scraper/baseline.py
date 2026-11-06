"""Baseline report for scraper coverage, performance and storage (KAN-605).

Reads local files only — no network, no database. Run from the scraper
directory after a live scrape has written its output files.

    python3 scraper/baseline.py
    python3 scraper/baseline.py --help
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JOBS_JSON = ROOT / "jobs.json"
FEED_JSON = ROOT / "feed.json"
METRICS_JSON = ROOT / "metrics.json"

# R2 pricing (us-east, standard, as of 2026-11): Class A (PUT) $4.50/M,
# Class B (GET) $0.36/M, storage $0.015/GB/month.
R2_PUT_PER_M = 4.50
R2_GET_PER_M = 0.36
R2_STORAGE_PER_GB_MONTH = 0.015
# The R2 estimate's assumptions, printed with it (`r2_estimate`).
IMPORTS_PER_DAY = 8  # scrape.yml's cron, every 3 hours
VIEWS_PER_MONTH = 10_000  # a placeholder until the site's traffic is measured
JOBS_PER_VIEW = 20


def _load_json(path: Path) -> object:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _utf8_len(s: str | None) -> int:
    return len(s.encode("utf-8")) if s else 0


# ---------------------------------------------------------------------------
# Coverage table
# ---------------------------------------------------------------------------


def coverage_table(metrics: dict) -> None:
    by_prov = metrics.get("by_provider", {})
    if not by_prov:
        print("  (no by_provider in metrics.json)")
        return
    cols = ("boards", "ok", "missing", "skipped", "failed", "deferred")
    print(f"\n{'provider':11s}" + "".join(f"{c:>9s}" for c in cols) + f"{'read%':>7s}")
    for ats in sorted(by_prov):
        row = by_prov[ats]
        boards = row.get("boards", 0)
        ok = row.get("ok", 0)
        pct = f"{100 * ok / boards:.0f}" if boards else "-"
        print(f"{ats:11s}" + "".join(f"{row.get(c, 0):>9,}" for c in cols) + f"{pct:>6s}%")


# ---------------------------------------------------------------------------
# Job inventory
# ---------------------------------------------------------------------------


def job_inventory(store: dict) -> None:
    jobs = store.get("jobs", [])
    boards = store.get("boards", {})
    total = len(jobs)

    def is_listed(j: dict) -> bool:
        bk = f"{j['ats']}/{j['token']}"
        br = boards.get(bk)
        if br is None:
            return True
        return j.get("last_seen_at") in (br.get("last_read_at"), br.get("prior_read_at"))

    active = sum(1 for j in jobs if is_listed(j))
    historical = total - active
    with_desc = sum(1 for j in jobs if j.get("page") and j["page"].get("description"))
    without_desc = total - with_desc
    print("\n--- Job inventory ---")
    print(f"  Total stored:       {total:>8,}")
    print(f"  Active (listed):    {active:>8,}")
    print(f"  Historical:         {historical:>8,}")
    print(f"  With description:   {with_desc:>8,}")
    print(f"  Without description:{without_desc:>8,}")


# ---------------------------------------------------------------------------
# Description sizing
# ---------------------------------------------------------------------------


def description_sizing(store: dict) -> None:
    sizes = []
    for j in store.get("jobs", []):
        page = j.get("page")
        if page and page.get("description"):
            sizes.append(_utf8_len(page["description"]))
    if not sizes:
        print("\n--- Description sizing ---\n  (no descriptions)")
        return
    sizes.sort()
    total_mb = sum(sizes) / 1_048_576
    p95 = sizes[int(len(sizes) * 0.95)] if len(sizes) >= 20 else sizes[-1]
    print(f"\n--- Description sizing (store, {len(sizes):,} descriptions) ---")
    print(f"  Min:    {min(sizes):>10,} B")
    print(f"  Max:    {max(sizes):>10,} B")
    print(f"  Mean:   {statistics.mean(sizes):>10,.0f} B")
    print(f"  Median: {statistics.median(sizes):>10,.0f} B")
    print(f"  P95:    {p95:>10,} B")
    print(f"  Total:  {total_mb:>10.2f} MB")


# ---------------------------------------------------------------------------
# Feed field sizes
# ---------------------------------------------------------------------------

FEED_FIELDS = (
    "description",
    "title",
    "company",
    "location",
    "apply_url",
    "logo_url",
    "company_domain",
    "id",
    "roles",
)


def feed_field_sizes(feed: list) -> None:
    if not feed:
        print("\n--- Feed field sizes ---\n  (no feed rows)")
        return
    totals: dict[str, int] = {}
    for row in feed:
        for field in FEED_FIELDS:
            val = row.get(field)
            if isinstance(val, list):
                val = json.dumps(val)
            totals[field] = totals.get(field, 0) + _utf8_len(val if isinstance(val, str) else None)
    print(f"\n--- Feed field sizes ({len(feed):,} rows) ---")
    for field in FEED_FIELDS:
        b = totals.get(field, 0)
        print(f"  {field:20s} {b:>12,} B  ({b / 1_048_576:.2f} MB)")
    total = sum(totals.values())
    print(f"  {'TOTAL':20s} {total:>12,} B  ({total / 1_048_576:.2f} MB)")


# ---------------------------------------------------------------------------
# Time efficiency
# ---------------------------------------------------------------------------


def time_efficiency(metrics: dict) -> None:
    by_prov = metrics.get("by_provider", {})
    if not by_prov:
        return
    print("\n--- Time efficiency ---")
    print(
        f"{'provider':11s}{'seconds':>9s}{'s/board':>9s}"
        f"{'s/kept':>9s}{'boards_s':>9s}{'pages_s':>9s}"
    )
    for ats in sorted(by_prov):
        row = by_prov[ats]
        secs = row.get("seconds", 0)
        boards = row.get("boards", 0)
        kept = row.get("kept", 0)
        s_board = f"{secs / boards:.1f}" if boards else "-"
        s_kept = f"{secs / kept:.1f}" if kept else "-"
        bs = row.get("boards_s")
        ps = row.get("pages_s")
        bs_str = f"{bs:.1f}" if bs is not None else "-"
        ps_str = f"{ps:.1f}" if ps is not None else "-"
        print(f"{ats:11s}{secs:>9.1f}{s_board:>9s}{s_kept:>9s}{bs_str:>9s}{ps_str:>9s}")
    timing = metrics.get("timing", {})
    if timing:
        for key in ("classify_s", "save_s", "total_s"):
            if key in timing:
                print(f"  {key}: {timing[key]}")
        if "peak_memory_kb" in timing:
            print(f"  peak_memory_kb: {timing['peak_memory_kb']:,}")


# ---------------------------------------------------------------------------
# R2 cost estimate
# ---------------------------------------------------------------------------


def r2_estimate(feed: list, store: dict) -> None:
    """A month of R2 for the feed, from this run's files. Every figure below rests
    on the assumptions it prints; the page views are a placeholder, not a measure."""
    if not feed:
        return
    # feed.json rows carry their descriptions, so the feed's size is the
    # descriptions' size too: adding jobs.json's descriptions would count them twice.
    feed_bytes = sum(_utf8_len(json.dumps(row)) for row in feed)
    n_feed = len(feed)
    # Rows first seen this run must be uploaded. Rows whose text changed must be
    # too, but one run cannot tell those apart, so this is a lower bound and
    # re-uploading every row is the upper one.
    scraped_at = store.get("scraped_at")
    feed_urls = {row.get("apply_url") for row in feed}
    new_rows = sum(
        1
        for j in store.get("jobs", [])
        if scraped_at and j.get("first_seen_at") == scraped_at and j.get("apply_url") in feed_urls
    )

    print("\n--- R2 cost estimate ---")
    print("  Assumptions:")
    print(f"    - {IMPORTS_PER_DAY} imports a day (scrape.yml, every 3 hours), 30 days a month;")
    print("    - one object per feed row, its description included, one PUT per upload;")
    print("    - PUTs: at least the rows first seen this run, at most every row, each import")
    print("      (rows edited since the last run are uploaded too; one run cannot count them);")
    print(
        f"    - GETs: {VIEWS_PER_MONTH:,} page views a month (a placeholder, not measured),"
        f" {JOBS_PER_VIEW} rows each;"
    )
    print("    - storage: this feed's rows only, no history or old versions kept.")
    low_puts = new_rows * IMPORTS_PER_DAY * 30
    high_puts = n_feed * IMPORTS_PER_DAY * 30
    low_put_cost = low_puts / 1_000_000 * R2_PUT_PER_M
    high_put_cost = high_puts / 1_000_000 * R2_PUT_PER_M
    print(f"  Feed rows:             {n_feed:>8,}")
    print(f"  New this run:          {new_rows:>8,}")
    print(f"  Feed size (JSON):      {feed_bytes / 1_048_576:>8.2f} MB")
    print(f"  PUTs/month:            {low_puts:>8,} to {high_puts:,}")
    print(f"  PUT cost/month:        ${low_put_cost:>8.4f} to ${high_put_cost:.4f}")

    gets_per_month = VIEWS_PER_MONTH * JOBS_PER_VIEW
    get_cost = gets_per_month / 1_000_000 * R2_GET_PER_M
    print(f"  GETs/month:            {gets_per_month:>8,}")
    print(f"  GET cost/month:        ${get_cost:>8.4f}")

    storage_gb = feed_bytes / 1_073_741_824
    storage_cost = storage_gb * R2_STORAGE_PER_GB_MONTH
    print(f"  Storage (feed):        {storage_gb:>8.4f} GB")
    print(f"  Storage cost/month:    ${storage_cost:>8.4f}")
    low = low_put_cost + get_cost + storage_cost
    high = high_put_cost + get_cost + storage_cost
    print(f"  Total estimated/month: ${low:>8.4f} to ${high:.4f}")


# ---------------------------------------------------------------------------
# Ranked coverage gaps
# ---------------------------------------------------------------------------


def coverage_gaps(metrics: dict) -> None:
    unread = metrics.get("unread", {})
    if not unread:
        return
    print("\n--- Coverage gaps: providers by boards unread ---")
    ranked = []
    for ats, reasons in unread.items():
        total = sum(r["boards"] for r in reasons.values())
        ranked.append((total, ats, reasons))
    ranked.sort(reverse=True)
    for total, ats, reasons in ranked:
        by_count = sorted(reasons.items(), key=lambda x: -x[1]["boards"])
        parts = ", ".join(f"{why} {r['boards']}" for why, r in by_count)
        print(f"  {ats:11s} {total:>5,} unread  ({parts})")


# ---------------------------------------------------------------------------
# Instrumentation summary
# ---------------------------------------------------------------------------


def instrumentation_summary(metrics: dict) -> None:
    reqs = metrics.get("requests")
    recv = metrics.get("received_bytes")
    retries = metrics.get("retries")
    if reqs is None and recv is None and retries is None:
        return
    print("\n--- Instrumentation (from this run) ---")
    if reqs is not None:
        print(f"  Requests:        {reqs:>10,}")
    if recv is not None:
        print(f"  Received bytes:  {recv:>10,}  ({recv / 1_048_576:.2f} MB)")
    if retries is not None:
        print(f"  Retries:         {retries:>10,}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="baseline",
        description="Scraper coverage, performance and storage baseline (KAN-605).",
    )
    parser.add_argument("--jobs", type=Path, default=JOBS_JSON, help="path to jobs.json")
    parser.add_argument("--feed", type=Path, default=FEED_JSON, help="path to feed.json")
    parser.add_argument("--metrics", type=Path, default=METRICS_JSON, help="path to metrics.json")
    args = parser.parse_args(argv)

    metrics = _load_json(args.metrics)
    store = _load_json(args.jobs)
    feed = _load_json(args.feed)

    found = []
    for name, obj, path in [
        ("metrics.json", metrics, args.metrics),
        ("jobs.json", store, args.jobs),
        ("feed.json", feed, args.feed),
    ]:
        if obj is None:
            print(
                f"  warning: {path} not found, some sections will be empty",
                file=sys.stderr,
            )
        else:
            found.append(name)

    if not found:
        print("No input files found. Run a live scrape first.", file=sys.stderr)
        return 1

    print("=== Scraper Baseline Report ===")
    print(f"  Files: {', '.join(found)}")

    if isinstance(metrics, dict):
        print(f"  Scraped at: {metrics.get('scraped_at', '?')}")
        coverage_table(metrics)
        time_efficiency(metrics)
        instrumentation_summary(metrics)
        coverage_gaps(metrics)

    if isinstance(store, dict):
        job_inventory(store)
        description_sizing(store)

    if isinstance(feed, list):
        feed_field_sizes(feed)

    if isinstance(feed, list) and isinstance(store, dict):
        r2_estimate(feed, store)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
