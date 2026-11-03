"""The Workable Filler: has the Fill engine (apply.fill_engine) read a
Posting's Question set from the form API Workable's own page reads (no login),
fill the form, attach
the résumé and read every field back. Opening the form fresh and submitting stay here.

A repeating section (Education, Experience) is asked the way the planner reads
Workday's: "Education (entries)" is how many entries to add, and "Education 1 /
School" a field of one entry (the engine names them so).
"""

import re

from playwright.sync_api import Page

from apply import fill_engine
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, QuestionSet, Readback

SUBMIT = "button[data-ui=apply-button]"
# What Workable's page says once the application is sent.
SUBMITTED = re.compile(r"application has been submitted|thank you for applying", re.IGNORECASE)
# The cookie banner, which covers the form until it is answered.
CONSENT = "[data-ui=cookie-consent]"
SHOWN_WAIT = 30_000  # ms for a file to be stored


class WorkableFiller:
    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        return fill_engine.fetched_question_set(url, site)

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        _fresh(page)
        return fill_engine.fill(page, "workable", questions, answers, {"uploadWait": SHOWN_WAIT})

    def submit(self, page: Page) -> None:
        page.locator(SUBMIT).click()
        wait_for_confirmation(page, page.get_by_text(SUBMITTED).first.is_visible)


def _fresh(page: Page) -> None:
    """Open the form again with no draft restored into it: the engine forgets
    the unsent form Workable keeps in local storage, then the page reloads."""
    page.locator(SUBMIT).wait_for()
    fill_engine.forget_drafts(page, "workable")
    page.reload()
    _ready(page)


def _ready(page: Page) -> None:
    """Wait for the form. The cookie banner covers it whenever it shows, so
    its optional cookies are declined before any click it would block (the submit's)."""
    consent = page.locator(CONSENT)
    page.remove_locator_handler(consent)  # one handler, however often the form is filled on this page
    page.add_locator_handler(consent, lambda banner: banner.get_by_role("button", name="Decline all").click())
    page.locator(SUBMIT).wait_for()
