"""A Posting whose own required qualifications ask for current graduate study
(a Master's, a PhD, a graduate program) is Not eligible for Lisul, an
undergraduate. Read with plain rules over the Posting's text: zero tokens."""

import json
from contextlib import contextmanager
from datetime import datetime

import pytest
from conftest import ARC_URL, FIXTURES
from fakes import FakeClaude, FakeClock, FakeMailbox, RecordingBoard, ScriptedUsage
from test_run_answers import profile_with

from apply import company, rehearsal
from apply.adapters import Adapters
from apply.cli import main
from apply.eligibility import graduate_only
from apply.feed import SimplifyFeed
from apply.profile import ApplicantProfile
from apply.tracker import InMemoryTracker

# Snap's "2027 Generative Media Research Intern" (Workday R0047179), as its CXS API sent it on 2026-10-16.
SNAP = """
<p><span> <b>What you&#39;ll do:</b></span></p><ul><li>Collaborate with world class researchers and engineers in your area of expertise</li>
<li>Work toward publishing and/or patenting your research</li></ul><br />
<p><span> <b>Knowledge, Skills, &amp; Abilities:</b></span></p><ul><li>Strong problem-solving skills</li>
<li>Proven ability solving tough technical challenges</li></ul><br />
<p><span> <b>Minimum Qualifications:</b></span></p><ul>
<li><span>Enrolled in a graduate program (PhD preferred) in a technical field, such as Computer Science, Graduating no sooner than May 2027</span></li>
<li>Experience conducting academic research and applying technical concepts to real-world problems</li>
<li>Must be able to work in office for a 13-16 week internship in 2027</li></ul><br />
<p><span> <b>Preferred Qualifications:</b></span></p><ul>
<li>Strong publication records in world’s top venues in our field: CVPR, ICCV, ECCV, NeurIPS, ICML, ICLR, SIGGRAPH and similar venues. </li>
<li>Previous experience with large generative models: large scale training and tuning, model efficiency.</li></ul>
<p>The base salary range for this position is $81,000-$121,000 annually.</p>
"""


def test_snaps_generative_media_research_internship_asks_for_graduate_study():
    assert graduate_only(company.text_of(SNAP)).startswith("Enrolled in a graduate program (PhD preferred)")


@pytest.mark.parametrize("text, needs", [
    ("Minimum Qualifications:\nCurrently pursuing a Master's or PhD in Computer Science\nPython experience",
     "Currently pursuing a Master's or PhD in Computer Science"),
    ("Basic Qualifications\nMust be a PhD student in Machine Learning or a related field\nStrong Python skills",
     "Must be a PhD student in Machine Learning or a related field"),
    ("Requirements\nMS/PhD candidate in Robotics, Computer Vision or a related field\nC++ and ROS",
     "MS/PhD candidate in Robotics, Computer Vision or a related field"),
    ("Required Qualifications:\nCurrently enrolled in a Ph.D. program in Computer Science, Statistics, or a related field.",
     "Currently enrolled in a Ph.D. program in Computer Science, Statistics, or a related field."),
    ("What You Need\nEnrolled in a master’s degree or PhD program — or advanced graduate study — in Data Science.",
     "Enrolled in a master’s degree or PhD program — or advanced graduate study — in Data Science."),
    ("Qualifications\nIn the process of completing the first year of a Master’s program in Computer Science",
     "In the process of completing the first year of a Master’s program in Computer Science"),
    ("Minimum Qualifications: Currently a graduate student in Electrical Engineering",
     "Currently a graduate student in Electrical Engineering"),
    # Walmart: a bachelor's outside the requirements (a benefit) offers no undergraduate a way in.
    ("Minimum Qualifications\nMust be enrolled in a PhD degree program currently\nExpected graduation date between"
     " December 2027-August 2028\nLive Better U is a Walmart-paid education benefit. Programs range from high school"
     " completion to bachelor's degrees, including English Language Learning.",
     "Must be enrolled in a PhD degree program currently"),
    # P&G and Amgen: a bachelor's already earned, on top of graduate study, is no undergraduate's way in.
    ("Required Qualifications:\nEducation: Working towards a PhD in Computer Science, Computer Engineering, or related field."
     " Additionally required is a Bachelor’s or Master’s degree in Computer Science, Data Science, or related field.",
     "Education: Working towards a PhD in Computer Science, Computer Engineering, or related field."),
    ("Basic Qualifications:\nGraduated with a bachelor’s degree from an accredited college or university\n"
     "Currently enrolled in an MBA program for an MBA internship OR a Master’s program for a Master’s internship",
     "Currently enrolled in an MBA program for an MBA internship OR a Master’s program for a Master’s internship"),
    # Vanguard: "What it takes" heads the requirements, and "senior leaders" are no undergraduates.
    ("In this internship you will:\nBuild relationships with program managers, alumni, senior leaders, and peers\n"
     "What it takes:\nEnrolled in a master’s degree or PhD program — or advanced graduate study — in Data Science.\n"
     "Additional Information:\nVanguard is not offering visa sponsorship for this position.",
     "Enrolled in a master’s degree or PhD program — or advanced graduate study — in Data Science."),
    # ICF: a bachelor's already completed, plus a Master's under way.
    ("Basic Qualifications:\nA completed bachelor’s degree plus enrollment verification or 9 credit hours complete in a"
     " Master’s degree program within data science or similar discipline",
     "A completed bachelor’s degree plus enrollment verification or 9 credit hours complete in a Master’s degree program"
     " within data science or similar discipline"),
    # Under no heading at all: an unambiguous sentence still says so.
    ("Join our research team for the summer.\nMust be enrolled in a PhD degree program currently\nYou will publish your work.",
     "Must be enrolled in a PhD degree program currently"),
    ("We build compilers.\nCurrently pursuing a Master's or PhD in Computer Science",
     "Currently pursuing a Master's or PhD in Computer Science"),
    ("Candidates should be pursuing a graduate degree in any of the following areas: Computer Science, Computer"
     " Engineering.\nRequired Experience: Candidates should demonstrate hands on experience with SQL",  # Nationwide
     "Candidates should be pursuing a graduate degree in any of the following areas: Computer Science, Computer Engineering."),
    ("Basic Qualifications:\nA minimum of 9 credit hours of completed graduate-level courses in Computer Science or a"
     " related field.\nA completed bachelor's degree.",  # ICF's AI Engineer Intern (Workday)
     "A minimum of 9 credit hours of completed graduate-level courses in Computer Science or a related field."),
    # A year of study or a plan for later that names a graduate degree as the study now.
    ("Requirements\nMust be a final-year PhD student in Computer Science",
     "Must be a final-year PhD student in Computer Science"),
    ("Requirements\nCurrently a second-year student in a Master's program in Data Science",
     "Currently a second-year student in a Master's program in Data Science"),
    ("Requirements\nMust be enrolled in a Master's program, planning to continue on to a PhD",
     "Must be enrolled in a Master's program, planning to continue on to a PhD"),
    ("Minimum Qualifications\nCurrently in the final year of a Master's program in Computer Science",
     "Currently in the final year of a Master's program in Computer Science"),
])
def test_required_qualifications_that_ask_for_graduate_study_rule_lisul_out(text, needs):
    assert graduate_only(text) == needs


@pytest.mark.parametrize("text", [
    # Undergraduates are one of the options.
    "Minimum Qualifications:\nCurrently pursuing a Bachelor's, Master's or PhD in Computer Science",
    "Requirements\nPursuing a BS, MS or PhD in Computer Science, Robotics, or a related technical field",
    "Requirements\nCurrently pursuing a B.S. or M.S. in Computer Science, or equivalent degree",
    "Qualifications\nMust be currently enrolled in an undergraduate or graduate degree program in Data Science",
    "Required:\nRising Junior, Senior, or Graduate student (MS/MA or Ph.D.) pursuing a degree in Computer Science",
    "Qualifications\nStudents entering their Junior, Senior, or Master's program at the start of the upcoming academic term.",
    "Basic Qualifications\nCurrently enrolled in a master's program, or in the third or fourth year of a bachelor's program.",
    "Requirements\nPursuing or obtained a Bachelor’s or Master’s degree.",  # Travelers
    "Qualifications\nCurrently pursuing or recently completed a bachelor's or graduate degree in Computer Science.",  # HP IQ
    # An undergraduate's year of study, or graduate study only as a plan for later (Roku, 2026-11-03).
    "Apply if\nYou are a penultimate-year student, or a final-year student planning to go on to a one-year master’s course.",
    "Requirements\nStudents in their penultimate year of study, or final-year students continuing on to a Master's degree",
    "Requirements\nPre-final year students or Master's students in Computer Science",
    "Requirements\nThird-year students, or final-year students moving on to an MSc",
    "Requirements\nYou are a second-year or third-year student, or a final-year student applying to a PhD program",
    "Requirements\nMust be a student planning to pursue a graduate degree after graduation",
    "Qualifications\nCurrent students who intend to go on to graduate school",
    "Minimum Qualifications\nCurrently enrolled in a 4-year degree program or a Master's program",
    # Undergraduates are offered elsewhere among the requirements.
    "Basic Qualifications\nPursuing a Bachelor's degree in Computer Science\nMS or PhD students must have one semester remaining",
    # A graduate degree only under Preferred, Nice to have or Bonus.
    "Minimum Qualifications\nPython and C++\nPreferred Qualifications\nCurrently pursuing a Master's or PhD in Computer Science",
    "Requirements:\nStrong CS fundamentals\nNice to Have:\nMS/PhD candidate in Machine Learning",
    "You Have:\nExperience with Go\nNice If You Have:\nEnrolled in a PhD program in distributed systems",
    "Required\nStrong CS fundamentals\nBonus Points\nCurrently a PhD student in Computer Vision",
    "Qualifications We Prefer:\nCurrently pursuing a Master's degree in Computer Science",
    "Preferred Qualifications\nMust have a 3.0 GPA or higher\nMS/PhD candidate in Machine Learning",  # a short bullet is no heading
    # Within the requirements, a graduate degree that is only preferred or welcome.
    "Minimum Qualifications\nMS or PhD students preferred\nStrong Python",
    "Requirements\nCurrently pursuing a degree in Computer Science; Master's students are also considered",
    "Qualifications\nA Master's or PhD in Computer Science is a plus",
    # A graduation window alone.
    "Minimum Qualifications:\nGraduating no sooner than May 2027\nStrong problem-solving skills",
    "Requirements\nMust be graduating between December 2027 and June 2028",
    # Graduate words that ask nothing of the applicant.
    "Top-performing interns are considered for our 2028 Graduate Program the following year.",
    "What are we looking for?\nThis internship is ideal for an innovative problem solver. Successful participants may have the"
    " opportunity to return full time as a member of our Technology Graduate Programme when they complete their studies.",
    "The estimated base salary range is $182,000 for Masters students and $234,000 for PhD students.",
    "Must be a US Citizen, permanent resident or be an MS student with work authorization (F1 Visa on CPT accepted only for masters-level students).",
    "Graduate students are also encouraged to apply.",
    "",
])
def test_lisul_stays_eligible_unless_the_requirements_ask_for_graduate_study(text):
    assert graduate_only(text) == ""


# --- A run and a rehearsal skip such a Posting before its form opens ------------------------

ARC_API = "https://boards-api.greenhouse.io/v1/boards/arcboatcompany/jobs/5442881008"


class JobBoard:
    """Greenhouse's Job Board API for the fixture Feed's one Posting (Arc's), whose
    text is `content` (None: the API sends its questions but not its text).
    A form opened in a browser fails the test."""

    def __init__(self, content: str | None):
        self.content = content
        self.posting = json.dumps({"title": "Software Engineer Intern", "company_name": "Arc", "content": content or ""}).encode()

    def fetch(self, url, body=None):
        if url.split("?")[0] != ARC_API or url == ARC_API and self.content is None:
            raise OSError(f"no page at {url}")
        return self.posting

    @contextmanager
    def open(self, url, worker=0):
        pytest.fail(f"opened the form at {url}")
        yield


GRADUATE_ONLY = "<h3>Minimum Qualifications</h3><ul><li>Currently pursuing a Master's or PhD in Computer Science</li></ul>"
WHY = "Posting requires graduate study: Currently pursuing a Master's or PhD in Computer Science"


def adapters(site, claude: FakeClaude, tracker: InMemoryTracker | None = None) -> Adapters:
    return Adapters(
        feed=SimplifyFeed((FIXTURES / "feed.json").read_bytes), tracker=tracker or InMemoryTracker(), site=site,
        claude=claude, mailbox=FakeMailbox(), usage=ScriptedUsage(), clock=FakeClock(datetime(2026, 10, 15, 9, 30)),
    )


def test_a_run_ends_a_graduate_only_posting_as_not_eligible_without_its_form_or_claude(tmp_path):
    claude, tracker = FakeClaude(), InMemoryTracker()

    main(["run", "--profile", str(profile_with(tmp_path))], adapters=adapters(JobBoard(GRADUATE_ONLY), claude, tracker))

    [row] = tracker.rows()
    assert (row.status, row.reason) == ("not eligible", WHY)
    assert claude.calls == []


def test_a_rehearsal_says_a_graduate_only_posting_is_not_eligible_without_its_form_or_claude(tmp_path):
    claude, lines = FakeClaude(), []

    [done] = rehearsal.rehearse([ARC_URL], adapters(JobBoard(GRADUATE_ONLY), claude),
                                ApplicantProfile.load(profile_with(tmp_path)), keep_open=False, out=lines.append)

    assert (done.outcome, done.why) == ("not eligible", WHY)
    assert f"| not eligible: {WHY} |" in lines[0]
    assert claude.calls == []


class PressesFillItAnyway(RecordingBoard):
    """Lisul presses the tile's Fill it anyway once it is offered."""

    def resumed(self, worker: int) -> bool:
        offered = (self.captions.get(worker, {}).get("resume") or {}).get("label") == rehearsal.ANYWAY
        self.pressed = getattr(self, "pressed", 0) + offered
        return offered and self.pressed == 1


def test_fill_it_anyway_on_a_graduate_only_posting_opens_its_form_and_says_why_it_was_ruled_out(tmp_path):
    claude, lines, board = FakeClaude(), [], PressesFillItAnyway()
    run = adapters(JobBoard(GRADUATE_ONLY), claude)
    run.board = board

    rehearsal.rehearse([ARC_URL], run, ApplicantProfile.load(profile_with(tmp_path)), out=lines.append)

    first, anyway = sorted(lines, key=lambda line: "not eligible" not in line)
    assert f"| not eligible: {WHY} |" in first
    assert "opened the form at" in anyway  # the fake's open() fails the test: the form opened all the same
    assert board.captions[0]["resume"] is None  # pressed: the button is gone


# Roku's "SW Engineer Intern, AI Engineering" (Greenhouse 8258241), its requirements as its API sent them on 2026-11-04.
ROKU = ("<p><strong>Apply if</strong></p><ul><li>You are a penultimate-year student, or a final-year student planning to go"
        " on to a one-year master’s course.</li></ul><ul><li>You hold a permanent right to work in the US.</li></ul>"
        "<p><strong>We’re excited if you have</strong></p><ul><li>Currently enrolled in a degree program in Artificial"
        " Intelligence, Computer Science, Engineering or a related field.</li></ul>")


@pytest.mark.parametrize("content", [
    "<h3>Minimum Qualifications</h3><ul><li>Currently pursuing a Bachelor's, Master's or PhD in Computer Science</li></ul>",
    ROKU,
    None,  # the Posting's text can't be read: its form decides, as before
])
def test_a_posting_open_to_undergraduates_goes_on_to_its_form(tmp_path, content):
    with pytest.raises(pytest.fail.Exception, match="opened the form"):
        main(["run", "--profile", str(profile_with(tmp_path))], adapters=adapters(JobBoard(content), FakeClaude()))
