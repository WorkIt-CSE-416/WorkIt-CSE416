"""
A posting's start term as the season a student plans around: the Start Date
filter's options (GET /jobs/facets) and ?start_term= / a search's "summer
2027" (queries/jobs/search.py, services/search_facts.py). Pure: no database.
"""

import datetime

# A posting's start term ("Summer 2027", "January 2027", "2027") as the season a
# student plans around, for the Start Date filter: 32 different spellings in
# the feed on 2026-10-09 come down to a handful of seasons. A month joins the
# season it falls in, December the next year's Winter; a bare year is its own
# option ("2027", season not stated). A term naming no year ("Summer") is in
# no season: the scraper doesn't guess one, and neither does this.
MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}
SEASONS = ("winter", "spring", "summer", "fall")
# The season a month falls in, and the month each season starts.
_SEASON_OF_MONTH = {1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
                    6: "summer", 7: "summer", 8: "summer", 9: "fall", 10: "fall",
                    11: "fall", 12: "winter"}
_SEASON_START = {"winter": 1, "spring": 3, "summer": 6, "fall": 9}
_SEASON_END = {"winter": 3, "spring": 6, "summer": 9, "fall": 12}


def season_of(term: str) -> str | None:
    '''
    the Start Date option a term belongs to: "summer-2027", or "2027" for a year
    with no season, or None for a term naming no year
    '''
    words = term.lower().replace("autumn", "fall").split()
    years = [int(w) for w in words if w.isdigit() and len(w) == 4]
    if not years:
        return None
    year = years[0]
    season = next((w for w in words if w in SEASONS), None)
    if season is None:
        month = next((MONTHS[w] for w in words if w in MONTHS), None)
        if month is None:
            return str(year)
        season = _SEASON_OF_MONTH[month]
        if month == 12:
            year += 1
    return f"{season}-{year}"


def season_order(key: str) -> tuple[int, int]:
    '''calendar order, a bare year before its seasons'''
    if "-" not in key:
        return (int(key), 0)
    season, year = key.split("-")
    return (int(year), _SEASON_START[season])


def season_is_over(key: str, today: datetime.date) -> bool:
    '''
    true once a season has ended: an option for it would only find postings
    whose start date has passed. A bare year lasts to its end
    '''
    if "-" not in key:
        return int(key) < today.year
    season, year = key.split("-")
    # Each season ends where the next starts: winter (from January here, its
    # December counted as the year before) at spring's March, fall at December.
    end = datetime.date(int(year), _SEASON_END[season], 1)
    return end <= today
