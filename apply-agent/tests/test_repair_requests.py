"""Repair requests: what an Application that went wrong leaves for a Repair,
one per cause, kept in a folder."""

from pathlib import Path

from apply.model import Posting, Question, Status
from apply.records import Filled
from apply.repair import RepairRequests, requests_for
from apply.worker import Result

RIPPLING = Posting("request-ea9caf87ff1c", "Rippling", "Full Stack Software Engineer Intern",
                   "https://ats.rippling.com/rippling/jobs/f64b6158-9534-4bab-9457-45556166b262")
ARC = Posting("6e2de8e6", "Arc", "Software Engineer Intern", "https://job-boards.greenhouse.io/arc/jobs/5442881008")
ANDURIL = Posting("1b2c3d4e", "Anduril", "Software Engineer Intern", "https://job-boards.greenhouse.io/anduril/jobs/77")


def traceback_through(function: str, message: str) -> str:
    return (
        "Traceback (most recent call last):\n"
        '  File "/Users/test-person/work/apply/src/apply/orchestrator.py", line 218, in _apply\n'
        "    return by_filler(\n"
        f'  File "/Users/test-person/work/apply/src/apply/greenhouse.py", line 140, in {function}\n'
        "    box = page.locator(selector)\n"
        '  File "/Users/test-person/work/apply/.venv/lib/python3.12/site-packages/playwright/_impl/_sync_base.py", line 9, in wait\n'
        "    raise TimeoutError(message)\n"
        f"TimeoutError: {message}\n"
    )


def failed(message: str, function: str = "_pick_school") -> Result:
    return Result(Status.FAILED, f"TimeoutError: {message}", traceback=traceback_through(function, message))


SCHOOL = Question("q7", "What school or university are you currently attending?", "text", required=True)
GRADUATION = Question("q6", "Please provide your anticipated graduation date", "select", True,
                      ("Before January 2028", "Between January 2028 - May 2028"))
WORK = Question("q8", "Are you able to intern full time from mid May to August 2027?", "select", True, ("Yes", "No"))


def rippling_filled() -> Filled:
    return Filled(
        [GRADUATION, SCHOOL, WORK],
        {"q6": "Between January 2028 - May 2028", "q7": "May 2028"},
        {"q6": "Between January 2028 - May 2028", "q7": "May 2028"},
        b"",
    )


def test_a_failed_application_asks_for_a_repair_with_its_failure_line_and_traceback():
    result = failed("Timeout 30000ms exceeded.")

    [request] = requests_for(ARC, result)

    assert request.kind == "failure"
    assert request.failure == "TimeoutError: Timeout 30000ms exceeded."
    assert "greenhouse.py\", line 140, in _pick_school" in request.traceback
    assert (request.job_system, request.posting_url) == ("greenhouse", ARC.url)
    assert request.applications == [{"id": ARC.id, "url": ARC.url}]
    assert request.status == "open"


def test_a_failure_with_no_traceback_is_no_bug_of_apply():
    # Not a link to a job posting, a job system that answers 500: nothing to repair.
    assert requests_for(ARC, Result(Status.FAILED, "Not a link to a job posting: a careers home page")) == []


def test_one_error_in_one_place_is_one_cause_whatever_its_numbers_and_quotes():
    first = requests_for(ARC, failed("Timeout 30000ms exceeded waiting for 'Stony Brook'"))[0]
    again = requests_for(ANDURIL, failed("Timeout 45000ms exceeded waiting for 'MIT'"))[0]
    elsewhere = requests_for(ARC, failed("Timeout 30000ms exceeded waiting for 'MIT'", function="_upload"))[0]

    assert first.signature == again.signature
    assert first.signature != elsewhere.signature
    assert first.signature.startswith("timeouterror-greenhouse-pick-school-")


def test_a_traceback_from_a_workit_checkout_names_apply_s_own_frame():
    message = "Timeout 30000ms exceeded waiting for 'MIT'"
    traceback = traceback_through("_pick_school", message).replace("/work/apply/", "/workit/apply-agent/")
    request = requests_for(ARC, Result(Status.FAILED, f"TimeoutError: {message}", traceback=traceback))[0]
    assert request.signature.startswith("timeouterror-greenhouse-pick-school-")


def test_a_run_s_missing_fact_asks_whether_the_profile_already_answers_it():
    result = Result(Status.MISSING_FACT, "Missing fact: Email", missing_fact="Email")

    [request] = requests_for(ARC, result)

    assert request.kind == "missing fact"
    assert request.missing == ["Email"]
    assert request.signature.startswith("missing-email-")


def test_a_rehearsal_asks_once_for_each_missing_fact_with_the_question_set_and_answers():
    result = Result(Status.HELD, "Calibration run: Application 4 of 10", rippling_filled(),
                    missing=(WORK.label,))

    [request] = requests_for(RIPPLING, result)

    assert request.missing == [WORK.label]
    assert request.job_system == "rippling"
    assert request.questions[2] == {
        "label": WORK.label, "kind": "select", "required": True, "options": ["Yes", "No"],
        "planned": None, "on_page": None,
    }
    assert request.questions[1]["planned"] == "May 2028"


def test_an_answer_the_pre_submit_check_caught_wrong_asks_for_a_repair():
    problem = 'What school or university are you currently attending?: the answer is "May 2028", a date, not a school'
    result = Result(Status.HELD, f"Pre-submit review: {problem}", rippling_filled(), problems=(problem,))

    [request] = requests_for(RIPPLING, result)

    assert request.kind == "wrong answer"
    assert request.problems == [problem]
    assert request.signature.startswith("answer-rippling-what-school-or-university-")


def test_a_problem_with_an_essay_is_left_to_lisul():
    problem = "Why Rippling?: the essay states a fact about the applicant that the story bank doesn't"
    result = Result(Status.HELD, f"Pre-submit review: {problem}", rippling_filled(), problems=(problem,))

    assert requests_for(RIPPLING, result) == []


def test_one_cause_makes_one_request_however_many_applications_it_hits(tmp_path: Path):
    requests = RepairRequests(tmp_path)

    assert requests.add(requests_for(ARC, failed("Timeout 30000ms exceeded."))[0]) is True
    assert requests.add(requests_for(ANDURIL, failed("Timeout 45000ms exceeded."))[0]) is False

    [request] = RepairRequests(tmp_path).waiting()  # read back from its folder
    assert request.applications == [{"id": ARC.id, "url": ARC.url}, {"id": ANDURIL.id, "url": ANDURIL.url}]


def test_a_cause_already_repaired_or_judged_never_asks_again(tmp_path: Path):
    requests = RepairRequests(tmp_path)
    [request] = requests_for(ARC, Result(Status.MISSING_FACT, missing_fact="Favorite color"))
    requests.add(request)
    request.status = "not a bug"
    requests.save(request)

    requests.add(requests_for(ANDURIL, Result(Status.MISSING_FACT, missing_fact="Favorite color"))[0])

    assert requests.waiting() == []
