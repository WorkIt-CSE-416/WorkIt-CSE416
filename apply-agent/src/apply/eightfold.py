"""The Eightfold Filler (Netflix's explore.jobs.netflix.net, Lockheed Martin's
lockheedmartin.eightfold.ai): opens a Posting's form and has the Fill engine
(apply.fill_engine) read its Question set, fill it, attach the résumé and read
every field back. Submitting stays here.

Eightfold's question API answers only the page's own session (its CSRF token
and cookies), so the Question set is read in the Worker's browser: the engine
asks the page's own questions API again from the open form. A question that
shows only once another is answered (Lockheed's "Details" of each source,
Netflix's State after Country) comes back from a fill as MoreQuestions; each
fill opens the form afresh.

Checked live 2026-10-20 on Netflix's Software Engineer Intern - Summer 2027
and Lockheed Martin's Software Engineer Intern - Summer 2027 (Huntsville).
"""

import re

from playwright.sync_api import Page

from apply import fill_engine
from apply.accounts import Accounts
from apply.adapters import JobSite
from apply.confirmation import wait_for_confirmation
from apply.model import Answers, MoreQuestions, QuestionSet, Readback

UPLOAD_WAIT = 30_000  # ms for the résumé to upload and be parsed
SUBMIT = "Submit application"


def form_url(url: str) -> str:
    """The link of a Posting's form (the engine reads it from the Posting's link)."""
    return fill_engine.job_of(url)["form"]


def confirmed(page: Page) -> bool:
    return page.get_by_text(THANKS).first.is_visible()


THANKS = re.compile(r"thank you for (applying|your application)|application (has been |was )?(submitted|received)"
                    r"|successfully (applied|submitted)", re.IGNORECASE)


class EightfoldFiller:
    def __init__(self, accounts: Accounts | None = None, rescue=None):
        """Built per Application like Workday's (its form stays open from the Question set to the submit);
        a Rescue isn't used: the engine fills every field."""
        self._fields: list[dict] = []  # the questions API's questions, each with its section (see _parse)

    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        with site.open(form_url(url)) as page:
            return fill_engine.read_questions(page, "eightfold")

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        """The form afresh each time (a fill after MoreQuestions too)."""
        page.goto(form_url(page.url))
        return fill_engine.fill(page, "eightfold", questions, answers, {"uploadWait": UPLOAD_WAIT})

    def submit(self, page: Page) -> None:
        page.get_by_role("button", name=SUBMIT, exact=False).first.click()
        wait_for_confirmation(page, lambda: confirmed(page))

    def unasked(self, page: Page, questions: QuestionSet) -> list[str]:
        """Required questions the API lists that show on the page but the Question set lacks."""
        return fill_engine.unasked(page, "eightfold", questions)

    # The engine's reading of the questions API's answer, with no page (it reads the page's own in a fill).

    def _parse(self, answer: dict) -> list[dict]:
        """Every question with a field, each with its section's title."""
        self._fields = fill_engine.call_without_page("eightfoldQuestions.fields", answer)
        return self._fields

    def _questions(self) -> QuestionSet:
        """Every question read but those another answer brings on."""
        return fill_engine.question_set(fill_engine.call_without_page("eightfoldQuestions.questions", self._fields))

    def _more(self, page: Page | None, name: str, value, kinds: dict) -> None:
        """MoreQuestions for what answering `name` with `value` brings on that `kinds` doesn't name."""
        if new := fill_engine.call_without_page("eightfoldQuestions.brought", self._fields, name, value, list(kinds)):
            raise MoreQuestions(fill_engine.question_set(new))


def _dom_id(section: str, question_id: str) -> str:
    return fill_engine.call_without_page("eightfoldQuestions.domId", section, question_id)
