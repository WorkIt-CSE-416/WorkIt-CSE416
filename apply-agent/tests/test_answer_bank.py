"""The Answer bank: one answer per one-off question, kept in a YAML file Lisul edits."""

import threading
from datetime import date

import yaml

from apply import fill_engine
from apply.answer_bank import AnswerBank
from apply.model import Posting, Question
from apply.profile import ApplicantProfile
from apply.tracker import AnswerRow

HEARD = Question("q1", "Tell us how you heard about Zipline", "text", required=True)
SAMPLES = Question("q2", "Will you be including a link on your resume to samples of projects you've worked on?",
                   "select", required=True, options=("Yes", "No"))
DAY = date(2026, 10, 16)
POSTING = Posting("p1", "Roblox", "Software Engineer Intern", "https://job-boards.greenhouse.io/roblox/jobs/1")


def test_a_drafted_answer_is_saved_with_where_it_was_first_seen(tmp_path):
    path = tmp_path / "answer-bank.yaml"

    AnswerBank(path).add(SAMPLES, "Yes", "Zipline", DAY)

    saved = yaml.safe_load(path.read_text())
    assert saved == {"will you be including a link on your resume to samples of projects you've worked on?": {
        "question": SAMPLES.label, "answer": "Yes", "options": ["Yes", "No"], "source": "claude", "reviewed": False,
        "first_seen": {"date": DAY, "company": "Zipline"},
    }}
    entry = AnswerBank(path).get(SAMPLES.label)
    assert (entry.answer, entry.source, entry.reviewed, entry.company) == ("Yes", "claude", False, "Zipline")


def test_the_same_question_in_other_spacing_or_case_finds_its_answer(tmp_path):
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    bank.add(HEARD, "Through the Simplify internship list.", "Zipline", DAY)

    assert bank.get("  TELL us how you heard\nabout Zipline *").answer == "Through the Simplify internship list."
    assert bank.get("Tell us how you heard about Skydio") is None


def test_an_answer_already_in_the_bank_is_never_replaced_by_a_new_draft(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    path.write_text(
        "# Lisul's notes stay put\n"
        "Tell us how you heard about Zipline:\n"
        "  question: Tell us how you heard about Zipline\n"
        "  answer: A friend on the avionics team.  # mine\n"
        "  source: lisul\n"
        "  reviewed: true\n"
    )
    bank = AnswerBank(path)

    added = bank.add(HEARD, "From the Simplify list.", "Zipline", DAY)

    assert not added
    assert bank.get(HEARD.label).answer == "A friend on the avionics team."
    bank.add(SAMPLES, "Yes", "Zipline", DAY)
    text = path.read_text()
    assert text.startswith("# Lisul's notes stay put") and "# mine" in text
    assert AnswerBank(path).get(HEARD.label).source == "lisul"


def test_workers_drafting_at_once_lose_no_answer(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    questions = [Question(f"q{n}", f"One-off question number {n}?", "text", required=True) for n in range(24)]

    # A bank each, as separate runs have: only the file lock keeps them apart.
    threads = [threading.Thread(target=AnswerBank(path).add, args=(q, f"Answer {q.name}", "Acme", DAY)) for q in questions]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    bank = AnswerBank(path)
    assert [bank.get(q.label).answer for q in questions] == [f"Answer {q.name}" for q in questions]


def test_a_bank_with_no_file_keeps_its_answers_in_memory():
    bank = AnswerBank()

    bank.add(SAMPLES, "Yes", "Zipline", DAY)

    assert bank.get(SAMPLES.label).answer == "Yes"


def test_the_notes_atop_a_bank_with_no_answers_yet_stay_put(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    path.write_text("# The Answer bank\n# Edit an answer, then set source: lisul.\n")

    AnswerBank(path).add(SAMPLES, "Yes", "Zipline", DAY)

    assert path.read_text().startswith("# The Answer bank\n# Edit an answer, then set source: lisul.\n")
    assert AnswerBank(path).get(SAMPLES.label).answer == "Yes"


SKILLS = Question("q3", "Skill Areas (Select all that apply)", "multi_select", True, ("Finance", "Software", "Robotics"))


def listed(question: Question, answer: str, drafted: str, reviewed: bool = False) -> AnswerRow:
    """The question's row in the Answers tab, as Lisul left it."""
    return AnswerRow(question.label, answer, reviewed, drafted, question.options, "Zipline", DAY)


def test_lisuls_edit_in_the_answers_tab_becomes_the_banks_answer(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    bank = AnswerBank(path)
    for question, answer in ((SAMPLES, "Yes"), (HEARD, "From the Simplify list."), (SKILLS, ["Software"])):
        bank.add(question, answer, "Zipline", DAY)

    changed = bank.take_edits([
        listed(SAMPLES, "No", drafted="Yes"),  # edited
        listed(HEARD, "From the Simplify list.", drafted="From the Simplify list.", reviewed=True),  # ticked only
        listed(SKILLS, "Software; Robotics", drafted="Software"),
        listed(Question("q9", "Not in the bank?", "text"), "Whatever", drafted=""),
    ])

    assert changed == [SAMPLES.label, HEARD.label, SKILLS.label]
    saved = AnswerBank(path)
    samples, heard, skills = (saved.get(q.label) for q in (SAMPLES, HEARD, SKILLS))
    assert (samples.answer, samples.source, samples.reviewed) == ("No", "lisul", True)
    assert (heard.answer, heard.source, heard.reviewed) == ("From the Simplify list.", "claude", True)
    assert (skills.answer, skills.source) == (["Software", "Robotics"], "lisul")
    assert saved.get("Not in the bank?") is None


def test_an_answer_the_tab_still_shows_as_drafted_leaves_an_edit_made_in_the_file(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    AnswerBank(path).add(SAMPLES, "Yes", "Zipline", DAY)
    path.write_text(path.read_text().replace("answer: 'Yes'", "answer: 'No'"))

    assert AnswerBank(path).take_edits([listed(SAMPLES, "Yes", drafted="Yes")]) == []
    assert AnswerBank(path).get(SAMPLES.label).answer == "No"


# Lisul's own edits, from the Answers tab of the Apply window.

def test_lisuls_answer_in_the_window_replaces_the_draft_and_counts_as_reviewed(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    AnswerBank(path).add(SKILLS, ["Software"], "Zipline", DAY)
    bank = AnswerBank(path)

    bank.answer(SKILLS.label, ["Software", "Robotics"], DAY)

    skills = AnswerBank(path).get(SKILLS.label)
    assert (skills.answer, skills.source, skills.reviewed) == (["Software", "Robotics"], "lisul", True)
    assert (skills.options, skills.company, skills.first_seen) == (SKILLS.options, "Zipline", DAY)  # kept


def test_a_question_lisul_adds_himself_joins_the_bank_as_his(tmp_path):
    path = tmp_path / "answer-bank.yaml"

    AnswerBank(path).answer("Are you open to a hybrid schedule?", "Yes", DAY)

    entry = AnswerBank(path).get("are you open to a HYBRID schedule?")
    assert (entry.question, entry.answer, entry.source, entry.reviewed) == ("Are you open to a hybrid schedule?", "Yes", "lisul", True)
    assert (entry.first_seen, entry.company, entry.options) == (DAY, "", ())
    assert "answer: 'Yes'" in path.read_text()  # quoted: no YAML reader takes it for true


def test_marking_a_draft_reviewed_leaves_its_answer_and_source(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    AnswerBank(path).add(HEARD, "From the Simplify list.", "Zipline", DAY)

    assert AnswerBank(path).review(HEARD.label)
    assert not AnswerBank(path).review("Not in the bank?")

    heard = AnswerBank(path).get(HEARD.label)
    assert (heard.answer, heard.source, heard.reviewed) == ("From the Simplify list.", "claude", True)


def test_a_deleted_answer_leaves_the_bank_so_claude_drafts_it_again(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    bank = AnswerBank(path)
    bank.add(HEARD, "From the Simplify list.", "Zipline", DAY)
    bank.add(SAMPLES, "Yes", "Zipline", DAY)

    assert AnswerBank(path).delete(HEARD.label.upper())
    assert not AnswerBank(path).delete(HEARD.label)

    assert AnswerBank(path).get(HEARD.label) is None
    assert AnswerBank(path).add(HEARD, "A new draft.", "Skydio", DAY)  # drafted again next time
    assert AnswerBank(path).get(SAMPLES.label).answer == "Yes"


def test_a_bank_read_again_sees_what_another_run_added(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    window = AnswerBank(path)
    AnswerBank(path).add(HEARD, "From the Simplify list.", "Zipline", DAY)  # a Worker of another run

    assert window.entries() == []
    assert [e.question for e in window.read_again()] == [HEARD.label]


def test_lisuls_edits_and_workers_drafts_at_once_lose_nothing(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    questions = [Question(f"q{n}", f"One-off question number {n}?", "text", required=True) for n in range(16)]
    for q in questions[:8]:
        AnswerBank(path).add(q, "Draft", "Acme", DAY)

    edits = [threading.Thread(target=AnswerBank(path).answer, args=(q.label, f"Mine {q.name}", DAY)) for q in questions[:8]]
    drafts = [threading.Thread(target=AnswerBank(path).add, args=(q, f"Draft {q.name}", "Acme", DAY)) for q in questions[8:]]
    for thread in edits + drafts:
        thread.start()
    for thread in edits + drafts:
        thread.join()

    bank = AnswerBank(path)
    assert [bank.get(q.label).answer for q in questions] == \
        [f"Mine q{n}" for n in range(8)] + [f"Draft q{n}" for n in range(8, 16)]


def test_each_use_of_an_answer_is_counted_with_the_day_it_was_last_used(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    bank = AnswerBank(path)
    bank.add(HEARD, "From the Simplify list.", "Zipline", DAY)
    bank.add(SAMPLES, "Yes", "Zipline", DAY)

    bank.use([HEARD.label], date(2026, 10, 17))
    bank.use(["tell us how you heard about zipline *", SAMPLES.label, "Never asked before?"], date(2026, 10, 18))

    heard, samples = AnswerBank(path).get(HEARD.label), AnswerBank(path).get(SAMPLES.label)
    assert (heard.uses, heard.last_used) == (2, date(2026, 10, 18))
    assert (samples.uses, samples.last_used) == (1, date(2026, 10, 18))
    assert yaml.safe_load(path.read_text())[HEARD.label.casefold()]["uses"] == {"count": 2, "last": date(2026, 10, 18)}


def test_an_answer_never_used_again_has_no_count_in_the_file(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    path.write_text(
        "Tell us how you heard about Zipline:\n"
        "  question: Tell us how you heard about Zipline\n"
        "  answer: A friend on the avionics team.\n"
        "  source: lisul\n"
        "  reviewed: true\n"
    )
    before = path.read_text()
    bank = AnswerBank(path)

    bank.use([], DAY)
    bank.use(["Never asked before?"], DAY)

    assert path.read_text() == before
    assert (bank.get(HEARD.label).uses, bank.get(HEARD.label).last_used) == (0, None)


def test_a_draft_keeps_the_facts_it_drew_on_and_one_with_none_names_none(tmp_path):
    path = tmp_path / "answer-bank.yaml"
    bank = AnswerBank(path)

    bank.add(SAMPLES, "Yes", "Zipline", DAY, facts=["links.github_url"])
    bank.add(HEARD, "From the Simplify list.", "Zipline", DAY)

    saved = yaml.safe_load(path.read_text())
    assert saved[SAMPLES.label.casefold()]["facts"] == ["links.github_url"]
    assert "facts" not in saved[HEARD.label.casefold()]
    assert AnswerBank(path).get(SAMPLES.label).facts == ("links.github_url",)
    assert AnswerBank(path).get(HEARD.label).facts == ()


def test_none_of_a_multi_selects_options_is_an_answer(tmp_path):
    # Roblox's partner organizations (2026-11-02): Lisul is in none, and an empty answer read as no answer.
    path = tmp_path / "answer-bank.yaml"
    orgs = Question("q1", "Please select if you are a member of one or more of the following national organizations:",
                    "multi_select", False, ("Women in Computer Science (WICS)", "Society of Women Engineers (SWE)"))
    AnswerBank(path).answer(orgs.label, [], DAY)

    entry = AnswerBank(path).get(orgs.label)
    assert (entry.answer, entry.none, entry.source) == ([], True, "lisul")
    planned = fill_engine.plan([orgs], POSTING, ApplicantProfile({}, tmp_path, {}), AnswerBank(path))
    assert (planned.answers, planned.drafts, planned.missing) == ({}, [], [])
    assert planned.blanks == {"q1": "None of its options holds for you: every box stays unticked"}

    AnswerBank(path).answer(orgs.label, ["Society of Women Engineers (SWE)"], DAY)  # he joined one
    assert AnswerBank(path).get(orgs.label).none is False


def test_a_bare_date_is_filed_under_its_section_never_its_label_alone(tmp_path):
    # Arrowstreet (live, 2026-11-04): "from (mm/dd/yyyy)" held the internship's start, for every From on every form.
    bank = AnswerBank(tmp_path / "answer-bank.yaml")
    start = Question("q", "From (MM/DD/YYYY)", "text", True)

    assert bank.add(start, "06/01/2026", "Acme", date(2026, 11, 4), wording="work experience / From (MM/DD/YYYY)")

    assert bank.get("From (MM/DD/YYYY)") is None
    assert bank.get("work experience / From (MM/DD/YYYY)").answer == "06/01/2026"
    assert "work experience / from (mm/dd/yyyy):" in (tmp_path / "answer-bank.yaml").read_text()
