"""Verifying a filled form: a fake form read back from its page, with problems planted in it."""

from datetime import date
from pathlib import Path

import pytest
from test_dashboard import window  # noqa: F401 (a fixture)

from apply import verify
from apply.model import Posting, Question
from apply.profile import ApplicantProfile

POSTING = Posting("p1", "Arc", "Software Engineer Intern", "https://job-boards.greenhouse.io/arc/jobs/1")
TODAY = date(2026, 11, 2)

FIRST = Question("first", "First name", "text", True)
WEBSITE = Question("site", "Personal website", "text")  # optional
AUTHORIZED = Question("auth", "Are you authorized to work in the US?", "select", True, ("Yes", "No"))
GRADUATION = Question("grad", "When do you graduate?", "select", True, ("May 2027", "May 2028"))
START = Question("start", "Earliest start date", "text")
WHY = Question("why", "Why Arc?", "textarea", True)
RESUME = Question("resume", "Resume/CV", "file", True)

CLEAN_ESSAY = ("I want to build the software that runs Arc's electric boats. At Hitachi Rail I wrote the tool "
               "that checks train schedules, and I want to bring that care to boats.")


@pytest.fixture
def person(tmp_path) -> ApplicantProfile:
    resume = tmp_path / "Test_Person_Resume.pdf"
    resume.write_bytes(b"%PDF-1.4 resume")
    facts = {"identity": {"legal_first_name": "Test", "preferred_first_name": "Test", "legal_last_name": "Person",
                          "pronouns": "they/them/theirs"},
             "education": {"expected_graduation": "2028-05"},
             "files": {"resume_pdf": str(resume)}}
    return ApplicantProfile(facts, tmp_path, {"compensation": {"fallback_hourly": 30}})


def filled(person, tmp_path, **shown):
    """The fake form, every answer filled as meant, with `shown` read back from the page instead."""
    questions = [FIRST, WEBSITE, AUTHORIZED, GRADUATION, START, WHY, RESUME]
    answers = {"first": "Test", "site": "https://test.example", "auth": "Yes", "grad": "May 2028",
               "start": "05/26/2027", "why": CLEAN_ESSAY, "resume": person.get("files.resume_pdf")}
    readback = {name: (a.name if isinstance(a, Path) else a) for name, a in answers.items()}
    for name, value in shown.items():
        if value is None:
            answers.pop(name)
            readback.pop(name)
        else:
            readback[name] = value
            if name == "why":
                answers[name] = value
    return questions, answers, readback


def verified(person, tmp_path, **shown):
    questions, answers, readback = filled(person, tmp_path, **shown)
    return verify.check(questions, answers, readback, person, POSTING, today=TODAY,
                        allowed="Hitachi Rail: wrote the schedule checker.")


def test_a_clean_form_is_verified(person, tmp_path):
    result = verified(person, tmp_path)

    assert result.flags == ()
    assert result.verified and result.label() == "Verified"


def test_a_blank_optional_field_is_flagged(person, tmp_path):
    [flag] = verified(person, tmp_path, site=None).flags

    assert (flag.field, flag.why, flag.kind) == ("Personal website", "left blank (optional)", verify.BLANK)
    assert flag.holds  # a blank optional is a bug (Lisul, 2026-11-02): it needs him, as a blank required one does


def test_a_blank_optional_self_id_question_is_flagged(person, tmp_path):
    questions, answers, readback = filled(person, tmp_path)
    questions.append(Question("vet", "Veteran status", "select", False, ("I am not a protected veteran", "Decline")))

    result = verify.check(questions, answers, readback, person, POSTING, today=TODAY, allowed="Hitachi Rail")

    assert [(f.field, f.why) for f in result.needs] == [("Veteran status", "left blank (optional)")]


def test_a_blank_required_field_needs_lisul(person, tmp_path):
    result = verified(person, tmp_path, first=None)

    assert [(f.field, f.why) for f in result.needs] == [("First name", "left blank (required)")]


def test_a_blank_field_lisul_is_asked_already_is_not_flagged_again(person, tmp_path):
    questions, answers, readback = filled(person, tmp_path, site=None)

    result = verify.check(questions, answers, readback, person, POSTING, today=TODAY, asked=["Personal website"],
                          allowed="Hitachi Rail")

    assert result.verified


def test_a_dropdown_the_page_shows_otherwise_is_flagged(person, tmp_path):
    [flag] = verified(person, tmp_path, auth="No").flags

    assert flag.field == "Are you authorized to work in the US?" and flag.kind == verify.READBACK


def test_a_dropdown_that_shows_no_option_of_its_own_is_flagged(person, tmp_path):
    flags = verified(person, tmp_path, auth="Maybe").flags

    assert any(f.kind == verify.CHOICE and "'Maybe'" in f.why for f in flags)


def test_an_essay_naming_another_company_is_flagged(person, tmp_path):
    flags = verified(person, tmp_path, why=CLEAN_ESSAY.replace("Arc's electric boats", "Stripe's payments")).flags

    assert [(f.field, f.kind) for f in flags] == [("Why Arc?", verify.COMPANY)]
    assert "Stripe" in flags[0].why


def test_a_company_his_own_sources_name_is_no_other_company(person, tmp_path):
    essay = CLEAN_ESSAY + " I used Google Cloud there."

    questions, answers, readback = filled(person, tmp_path, why=essay)
    result = verify.check(questions, answers, readback, person, POSTING, today=TODAY,
                          allowed="Hitachi Rail: ran the checker on Google Cloud.")

    assert result.verified


def test_a_wrong_pronoun_for_the_applicant_is_flagged(person, tmp_path):
    # An earlier essay plan called the they/them Test Person "he" (handoff, 2026-11-02).
    essay = "Test Person built the schedule checker at Hitachi Rail. He wants to build Arc's boat software next."

    [flag] = verified(person, tmp_path, why=essay).flags

    assert flag.kind == verify.PRONOUN and "'he'" in flag.why and "they/them" in flag.why


def test_a_wrong_name_in_a_cover_letter_is_flagged(person, tmp_path):
    essay = CLEAN_ESSAY + "\n\nSincerely,\nJordan Lee"

    [flag] = verified(person, tmp_path, why=essay).flags

    assert flag.kind == verify.NAME and "Jordan Lee" in flag.why


def test_a_graduation_that_is_not_the_profiles_is_flagged(person, tmp_path):
    flags = verified(person, tmp_path, grad="May 2027").flags

    assert any(f.kind == verify.DATE and f.field == "When do you graduate?" for f in flags)


def test_a_start_date_already_past_is_flagged(person, tmp_path):
    flags = verified(person, tmp_path, start="05/26/2025").flags

    assert any(f.kind == verify.DATE and "already past" in f.why for f in flags)


def test_pay_off_the_fallback_rate_is_flagged(person, tmp_path):
    pay = Question("pay", "Desired hourly rate", "text")
    result = verify.check([pay], {"pay": "$45"}, {"pay": "$45"}, person, POSTING, today=TODAY)

    [flag] = result.flags
    assert flag.kind == verify.PAY


def test_pay_inside_the_postings_range_passes(person, tmp_path):
    pay = Question("pay", "Desired hourly rate", "text")
    result = verify.check([pay], {"pay": "$45"}, {"pay": "$45"}, person, POSTING, today=TODAY,
                          posting_text="The hourly pay range for this role is $40 - $50 per hour.")

    assert result.verified


def test_a_cover_letter_in_the_resume_field_is_flagged(person, tmp_path):
    letter = tmp_path / "Test_Person_Cover_Letter.pdf"
    letter.write_bytes(b"%PDF-1.4 letter")
    questions, answers, readback = filled(person, tmp_path)
    answers["resume"], readback["resume"] = letter, letter.name

    [flag] = verify.check(questions, answers, readback, person, POSTING, today=TODAY, allowed="Hitachi Rail").flags

    assert flag.kind == verify.FILE and "cover letter" in flag.why


def test_the_profiles_own_file_for_a_field_is_never_flagged(person, tmp_path):
    # The sample profile's resume stands in for its transcript (Verkada, rehearsed 2026-11-02).
    person.set("files.unofficial_transcript_pdf", str(person.get("files.resume_pdf")))
    transcript = Question("transcript", "Undergraduate Transcript", "file")
    resume = person.get("files.resume_pdf")

    result = verify.check([transcript], {"transcript": resume}, {"transcript": resume.name}, person, POSTING, today=TODAY)

    assert result.flags == ()


def test_a_guess_is_noted_but_still_verified(person, tmp_path):
    questions, answers, readback = filled(person, tmp_path)

    result = verify.check(questions, answers, readback, person, POSTING, today=TODAY, allowed="Hitachi Rail",
                          guessed=[("Favorite language?", "Python")])

    assert result.verified and [f.kind for f in result.flags] == [verify.GUESSED]
    assert result.label() == "Verified · 1 note"


def test_a_flag_lisul_dismissed_holds_this_application_no_more(person, tmp_path):
    verify.dismiss("p1", "Personal website", "left blank (optional)")
    questions, answers, readback = filled(person, tmp_path, site=None)

    result = verify.check(questions, answers, readback, person, POSTING, today=TODAY, allowed="Hitachi Rail",
                          dismissed=verify.dismissed("p1"))

    assert result.verified and result.label() == "Verified"
    assert [(f.field, f.dismissed) for f in result.flags] == [("Personal website", True)]
    assert verify.dismissed("p2") == set()  # per application: another one still flags it


def test_every_planted_problem_is_flagged_at_once(person, tmp_path):
    essay = "Test Person built tools at Hitachi Rail. He wants to work at Stripe."

    result = verified(person, tmp_path, site=None, auth="No", why=essay)

    assert {f.kind for f in result.flags} == {verify.BLANK, verify.READBACK, verify.COMPANY, verify.PRONOUN}
    assert result.label() == "Verified with 4 items that need you"


def test_a_live_run_holds_a_flagged_application_and_never_submits_it(monkeypatch):
    from fakes import FakeClaude
    from test_claude_answers import ResearchForm, run

    form = ResearchForm("Varda Space")
    letter = "I build software that has to work the first time, and I want to bring that to Stripe."

    row = run(monkeypatch, form, FakeClaude(essays={"Cover Letter": letter}))

    assert row.status == "held"
    assert "Verify: Cover Letter: names Stripe, another company" in row.reason
    assert form.submitted == []


def test_a_flag_dismissed_before_holds_a_new_run_of_that_application_no_more(monkeypatch):
    from fakes import FakeClaude
    from test_claude_answers import ResearchForm, run

    letter = "I build software that has to work the first time, and I want to bring that to Stripe."
    verify.dismiss("posting-1", "Cover Letter", "names Stripe, another company (this form is Example Co's)")

    row = run(monkeypatch, ResearchForm("Varda Space"), FakeClaude(essays={"Cover Letter": letter}))

    assert "Verify: " not in row.reason


# The Apply window: a tile and a Needs you card say how verifying went.

FLAGGED = verify.Verification((verify.Flag("Why Arc?", "names Stripe, another company", verify.COMPANY),
                               verify.Flag("Website", "left blank (optional)", verify.BLANK, holds=False)), 7)


def test_a_tile_says_verifying_while_the_form_is_checked():
    from apply.dashboard import verdict

    shown = verdict({"status": "filling", **verify.verifying(None)})

    assert (shown["tone"], shown["label"]) == ("verifying", "Verifying…")


def test_a_verified_rehearsal_says_verified_and_not_sent():
    from apply.dashboard import verdict

    shown = verdict({"status": "ready to submit", "why": "", **verify.verifying(verify.Verification((), 7))})

    assert (shown["tone"], shown["label"], shown["verified"]) == ("ready", "Verified · filled, not sent", True)


def test_a_verified_and_submitted_application_says_so():
    from apply.dashboard import verdict

    shown = verdict({"status": "submitted", **verify.verifying(verify.Verification((), 7))})

    assert (shown["tone"], shown["label"]) == ("submitted", "Verified and sent")


def test_a_flagged_application_needs_lisul_with_each_flag_named():
    from apply.dashboard import verdict

    shown = verdict({"status": "held", "why": "Verify: Why Arc?: names Stripe, another company",
                     **verify.verifying(FLAGGED)})

    assert (shown["tone"], shown["kind"]) == ("needs", "check")
    assert shown["label"] == "Verified with 1 item that needs you"
    assert shown["flags"] == [{"field": "Why Arc?", "why": "names Stripe, another company"}]
    assert shown["notes"] == ["Website: left blank (optional)"]


def test_a_tracker_row_held_by_a_flag_still_needs_lisul():
    from apply.dashboard import verdict

    shown = verdict({"status": "held", "why": "Verify: Why Arc?: names Stripe, another company"})

    assert (shown["tone"], shown["kind"]) == ("needs", "check")
    assert "Why Arc?: names Stripe" in shown["why"]


def post_dismiss(board, item, flag, token=None):
    import json
    import urllib.request
    body = json.dumps({"id": item["id"], "field": flag["field"], "why": flag["why"]}).encode()
    return urllib.request.urlopen(urllib.request.Request(board.url + "/dismiss", body,
                                                         {"X-Apply-Token": token or board.token}))


def test_a_flag_dismissed_in_the_window_is_kept_past_a_reload_and_a_new_window():
    from test_dashboard import NoFrames, held_row

    from apply.dashboard import Dashboard

    why = "Verify: Why Arc?: names Stripe, another company"
    with Dashboard(1, NoFrames(), approve=lambda i: "Approved.") as board:
        board.update(0, company="Arc", role="Intern", posting_url="https://arc.example/1", application_id="arc-1",
                     status="held", why=why, **verify.verifying(FLAGGED))
        [item] = board.state()["items"]
        assert item["kind"] == "check" and item["flags"] == [{"field": "Why Arc?", "why": "names Stripe, another company"}]

        post_dismiss(board, item, item["flags"][0])

        [item] = board.state()["items"]  # what the window reads again on a reload
        assert item["kind"] == "held" and "flags" not in item  # every flag dismissed: his to approve
    assert verify.dismissed("arc-1") == {("Why Arc?", "names Stripe, another company")}

    # A new window, with the held row read from the Tracker: the flag stays dismissed.
    with Dashboard(0, NoFrames(), past=lambda: [held_row(application_id="arc-1", reason=why)]) as board:
        [item] = board.state()["items"]
        assert item["kind"] == "held"


def test_a_dismissal_from_anywhere_but_the_window_is_refused():
    import urllib.error

    from test_dashboard import NoFrames

    from apply.dashboard import Dashboard

    with Dashboard(1, NoFrames()) as board:
        board.update(0, company="Arc", application_id="arc-1", status="held",
                     why="Verify: Why Arc?: names Stripe, another company", **verify.verifying(FLAGGED))
        [item] = board.state()["items"]
        with pytest.raises(urllib.error.HTTPError) as refused:
            post_dismiss(board, item, item["flags"][0], token="guessed")
    assert refused.value.code == 403 and verify.dismissed("arc-1") == set()


def test_lisul_dismisses_a_flag_on_its_card_and_it_stays_gone_after_a_reload(window):
    from test_dashboard import NoFrames

    from apply.dashboard import Dashboard

    with Dashboard(1, NoFrames(), approve=lambda i: "Approved.") as board:
        board.update(0, company="Arc", role="Intern", posting_url="https://arc.example/1", application_id="arc-1",
                     status="held", why="Verify: Why Arc?: names Stripe, another company", **verify.verifying(FLAGGED))
        window.goto(board.url)
        card = "#inbox .item:has-text('Arc')"
        window.click(f"{card} .flags button:has-text('Dismiss')")
        window.wait_for_selector(f"{card} button:has-text('Approve')", timeout=10_000)
        window.reload()

        window.wait_for_selector(f"{card} button:has-text('Approve')", timeout=10_000)
        assert window.locator(f"{card} .flags li").count() == 0
