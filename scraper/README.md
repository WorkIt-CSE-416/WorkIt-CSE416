# scraper

Finds internship and new-grad software roles on company job boards (Greenhouse,
Lever, Ashby) and renders them as one self-contained HTML page.

```sh
cd scraper
python3 -m workit_scraper              # scrape live, then render
python3 -m workit_scraper --offline    # no network; render from jobs.json
```

Then open `internships.html` in any browser (double-click it in your file manager).

No install step: Python 3.12+ and the standard library only.

Board slugs are seeded from [SimplifyJobs/Summer2026-Internships](https://github.com/SimplifyJobs/Summer2026-Internships),
[SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions)
and [vanshb03/Summer2026-Internships](https://github.com/vanshb03/Summer2026-Internships);
postings are always read from the employer's own board.

Design and conventions: [`CLAUDE.md`](CLAUDE.md).
