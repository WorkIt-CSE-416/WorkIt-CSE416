"""The Filler for each job system. All share one shape."""

from typing import Protocol

from playwright.sync_api import Page

from apply.adapters import JobSite
from apply.ashby import AshbyFiller
from apply.eightfold import EightfoldFiller
from apply.greenhouse import GreenhouseFiller
from apply.lever import LeverFiller
from apply.model import (  # noqa: F401 (Fillers raise them)
    Answers,
    Handoff,
    MoreQuestions,
    QuestionSet,
    Readback,
)
from apply.rippling import RipplingFiller
from apply.workable import WorkableFiller
from apply.workday import WorkdayFiller


class Filler(Protocol):
    def question_set(self, url: str, site: JobSite) -> QuestionSet:
        """Every question the Posting's form asks, read before the form is opened."""
        ...

    def fill(self, page: Page, questions: QuestionSet, answers: Answers) -> Readback:
        """Fill the open form, attach files, and read every answered field back. Never submits.
        A form in steps raises MoreQuestions on reaching a step with questions not in `questions`."""
        ...

    def submit(self, page: Page) -> tuple[str, ...] | None:
        """Submit the filled form. Runs only after the Pre-submit check passes.
        Returns the Bot signals it met on the way to the confirmation, if any
        (apply.bot_signals: Greenhouse's security code step)."""
        ...

    # Optional: unasked(page, questions) -> list[str], the labels of the required
    # fields on the filled form that `questions` lacks; the Pre-submit check fails on any.


# A Filler, or a Filler class built per Application with the Application's
# Accounts (accounts.Accounts): one that signs in, and whose form stays open
# from its Question set to its submit.
FILLERS: dict[str, Filler | type] = {
    "greenhouse": GreenhouseFiller(),
    "ashby": AshbyFiller(),
    "lever": LeverFiller(),
    "workday": WorkdayFiller,
    "rippling": RipplingFiller(),
    "workable": WorkableFiller(),
    "eightfold": EightfoldFiller,
}
