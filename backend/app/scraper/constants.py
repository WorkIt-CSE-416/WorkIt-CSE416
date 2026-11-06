"""Shared scraper constants used by both the feed import and closure detection."""

# Closing more than this share of published scraped jobs in one run is refused.
MASS_CLOSE_SHARE = 0.5
# ...unless there are this few, as on a first import or a test database.
MASS_CLOSE_FLOOR = 20
