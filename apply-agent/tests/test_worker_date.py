"""A Worker answers a question that asks for today's date with the date its Application runs."""

from contextlib import contextmanager
from datetime import date

from conftest import APPLY, FIXTURES
from fakes import FakeClaude

from apply.fillers import Handoff
from apply.model import Posting, Question
from apply.profile import ApplicantProfile
from apply.worker import apply_to

ACKNOWLEDGEMENT = Question(
    "ack", "Acknowledgement: you will promptly share changes with your recruiter. "
           "Please acknowledge this by entering today's date. (MM/DD/YYYY)", "text", True)


class OneQuestionFiller:
    def __init__(self):
        self.answers = {}

    def question_set(self, url, site):
        return [ACKNOWLEDGEMENT]

    def fill(self, page, questions, answers):
        self.answers = dict(answers)
        raise Handoff("stop after filling")


class Site:
    @contextmanager
    def open(self, url):
        yield object()


def test_a_question_for_todays_date_gets_the_date_the_worker_was_given():
    filler = OneQuestionFiller()
    posting = Posting("request-1", "", "", "https://wd1.myworkdaysite.com/recruiting/snapchat/snap/job/LA/Intern_R1")
    profile = ApplicantProfile.load(FIXTURES / "planner-profile.yaml", APPLY / "policies.default.yaml")
    apply_to(posting, filler, Site(), profile, FakeClaude(), today=date(2031, 3, 4))
    assert filler.answers == {"ack": "03/04/2031"}
