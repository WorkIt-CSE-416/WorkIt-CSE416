"""The code gates every final essay passes before it ships (apply.gates;
research/sources/answer-types/g-quality.md, section 2.1)."""

import pytest

from apply import gates
from apply.model import Question

WHY = Question("a", "Why Figma?", "textarea", True)
SOURCES = ("<story_bank>## Hitachi Rail: Software Engineer Intern\nI led 13 interns on a depot bus tracker.\n"
           "## WorkIt\nA job app on FastAPI and PostgreSQL.</story_bank>\n"
           "<company>\n- **Dev Mode** (2026-06): Dev Mode hands designs to engineers.\n</company>")


@pytest.fixture(autouse=True)
def briefs(monkeypatch):
    """Briefs for Figma and Notion in the data folder: the companies gate (c) knows."""
    for company in ("Figma", "Notion"):
        (gates.BRIEFS / f"{company.lower()}.md").write_text(f"# {company}\n")
    gates.companies.cache_clear()
    yield
    gates.companies.cache_clear()


def words(n: int, word: str = "word") -> str:
    return " ".join([word] * n) + "."


# (a) Length, in the form's own unit.

def test_the_length_comes_from_the_form_else_the_types_default():
    assert gates.bounds(WHY, "why-company") == (70, 120, "words")
    assert gates.bounds(Question("a", "Why Figma? (100-150 words)", "textarea"), "why-company") == (100, 150, "words")
    assert gates.bounds(Question("a", "Why Figma?", "textarea", description="Max 200 words."), "why-company") == (150, 200, "words")
    assert gates.bounds(Question("a", "Why Figma? Answer in a few sentences.", "textarea"), "why-company") == (3, 4, "sentences")
    assert gates.bounds(Question("a", "Why Figma? (2-3 sentences)", "textarea"), "why-company") == (2, 3, "sentences")
    # Twitch's (seen live): a hyphenated limit, read as the type's default 120 words before
    assert gates.bounds(Question("a", "Why Twitch? (500-word limit)", "textarea"), "why-company") == (375, 500, "words")
    assert gates.bounds(Question("a", "Why Figma? (1,000 characters)", "textarea"), "why-company") == (800, 1000, "characters")
    assert gates.bounds(Question("a", "Why Figma?", "textarea", max_length=500), "why-company") == (400, 500, "characters")
    assert gates.bounds(Question("a", "Why Figma?", "text"), "why-company") == (0, 255, "characters")
    assert gates.bounds(Question("a", "Cover letter", "textarea", description="Word limit: 260"), "cover-letter") == (
        195, 260, "words")
    # a sentence range read first still leaves its word cap in force (caps)
    both = Question("a", "Why Figma? (2-3 sentences) (max 30 words)", "textarea")
    assert gates.over_cap(words(31), both) == ["too long: 31 words, the most is 30"]


def test_an_answer_over_the_upper_bound_fails_and_one_far_under_the_lower_fails():
    assert gates.length(words(80), WHY, "why-company") == []
    assert gates.length(words(121), WHY, "why-company") == ["too long: 121 words, the most is 120"]
    assert gates.length(words(41), WHY, "why-company") == ["too short: 41 words, at least 42 (60% of 70)"]
    assert gates.length(words(42), WHY, "why-company") == []
    few = Question("a", "Why Figma? Answer in a few sentences.", "textarea")
    assert gates.length("One. Two. Three. Four. Five.", few, "why-company") == ["too long: 5 sentences, the most is 4"]
    assert gates.length("Just one.", few, "why-company") == ["too short: 1 sentences, at least 2 (60% of 3)"]
    assert gates.length("- Built a tracker\n- Led the team\n- Shipped it", few, "why-company") == []  # bullets count
    assert gates.length("x" * 501, Question("a", "Why?", "textarea", max_length=500), "why-company") == [
        "too long: 501 characters, the most is 500"]


def test_anything_else_and_short_fields_have_no_lower_bound():
    assert gates.length("Thanks.", Question("a", "Anything else?", "textarea"), "anything-else") == []
    assert gates.length("Yes.", Question("a", "Why Figma?", "text"), "why-company") == []
    assert gates.length("x" * 256, Question("a", "Why Figma?", "text"), "why-company") == [
        "too long: 256 characters, the most is 255"]


# (b) Numbers and names traced to the sources.

def test_a_number_or_a_name_no_source_holds_fails():
    assert gates.traced("At Hitachi Rail I led 13 interns.", SOURCES, "Figma") == []
    assert gates.traced("At Hitachi Rail I led 14 interns.", SOURCES, "Figma") == ["a number no source holds: 14"]
    assert gates.traced("I shipped it with Google Cloud Run.", SOURCES, "Figma") == [
        "a name no source holds: Google Cloud Run"]
    assert gates.traced("I built it in PyTorch.", SOURCES, "Figma") == ["a name no source holds: PyTorch"]
    assert gates.traced("Figma Make and Dev Mode both help.", SOURCES, "Figma Make") == []  # the company's own name


def test_a_name_run_joining_names_the_sources_hold_passes():
    # MongoDB's and Scout AI's (seen live): held names side by side, and a possessive, read as one unknown name
    sources = ("<story_bank>## IEEE Stony Brook\nI captained our Micromouse team. I reported to the CTO at Hitachi Rail."
               "</story_bank>\n<company>\n- **Atlas Search** (2026-05): full-text search.\n</company>")
    text = "Atlas Search caught my eye. IEEE Stony Brook Micromouse taught me that. I presented to Hitachi Rail's CTO."
    assert gates.traced(f"At Figma {text}", sources, "Figma") == []
    assert gates.traced("Figma Atlas Search helps.", sources, "Figma") == []  # the company's name, then a brief's
    assert gates.traced("IEEE Stony Brook Robotics won.", sources, "Figma") == [
        "a name no source holds: IEEE Stony Brook Robotics"]


def test_names_check_is_conservative_about_sentence_openers_and_acronyms():
    assert gates.traced("When I built WorkIt, it ran on FastAPI. In Dev Mode the AI helps. The GPS feed was live.",
                        SOURCES, "Figma") == []


# (c) No other company named.

def test_a_company_from_another_brief_fails_unless_it_is_this_one():
    assert gates.other_companies("I would bring this to Notion.", "Figma", "") == ["names another company: Notion"]
    assert gates.other_companies("I would bring this to Figma.", "Figma", "") == []
    assert gates.other_companies("I would bring this to Notion.", "Notion Labs", "") == []
    # a name his own facts use (a database he built on) is his, not a leftover
    assert gates.other_companies("I stored it in MongoDB.", "Figma", "## WorkIt\nBuilt on MongoDB.") == []


# (d) The swap test's code half.

def test_a_company_sentence_with_no_specific_fact_fails_on_a_company_facing_type():
    found = gates.swap("I would love to work at Figma.", "why-company", "Figma", SOURCES)
    assert found == ['would read true of another company: "I would love to work at Figma."']
    assert gates.swap("Figma's Dev Mode is the problem I hit.", "why-company", "Figma", SOURCES) == []
    assert gates.swap("I would love to work at Figma.", "failure", "Figma", SOURCES) == []


# (e) and (h) Across one form.

def test_the_same_project_with_different_numbers_across_answers_fails_both():
    found = gates.form({"q1": "At Hitachi Rail I led 13 interns.", "q2": "My team at Hitachi Rail had 12 interns."})
    assert found == {"q1": ["Hitachi Rail has 13 interns here and 12 interns in q2"],
                     "q2": ["Hitachi Rail has 12 interns here and 13 interns in q1"]}
    assert gates.form({"q1": "At Hitachi Rail I led 13 interns.", "q2": "Micromouse had 4 members."}) == {}


def test_answers_opening_the_same_way_fail():
    found = gates.form({"q1": "At Hitachi Rail, I built a tracker.", "q2": "At WorkIt, I built a job app."})
    assert "opens like q2" in found["q1"][0] and "opens like q1" in found["q2"][0]


# (f) Not on the resume.

def text_pdf(path, line: str):
    """A one-page PDF whose only text is `line`, as a resume's PDF holds its words."""
    stream = f"BT /F1 10 Tf 20 700 Td ({line}) Tj ET".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
               b"/Resources << /Font << /F1 5 0 R >> >> >>",
               b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for n, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (n, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    path.write_bytes(bytes(out))
    return path


def test_a_not_on_resume_answer_sharing_six_words_with_the_resume_pdf_fails(tmp_path):
    resume = text_pdf(tmp_path / "resume.pdf", "Built a tracker that cut late shipments by half at Acme Corp")
    copied = "Then I built a tracker that cut late shipments again."
    assert gates.on_resume(copied, "not-on-resume", resume) == ['copies the resume: "built a tracker that cut late"']
    assert gates.on_resume(copied, "failure", resume) == []
    assert gates.on_resume("Nothing like the resume at all here today.", "not-on-resume", resume) == []


def test_with_no_resume_pdf_the_resume_gate_is_off(tmp_path):
    copied = "Then I built a tracker that cut late shipments again."
    assert gates.on_resume(copied, "not-on-resume", None) == []
    assert gates.on_resume(copied, "not-on-resume", tmp_path / "missing.pdf") == []


# (g) The opener.

def test_the_first_sentence_never_opens_on_a_date_or_restates_the_question():
    assert gates.opener("In summer 2026, I led a team.", WHY) == ['opens on a date: "In summer 2026,"']
    assert gates.opener("During Fall 2025, I built it.", WHY) == ['opens on a date: "During Fall 2025,"']
    assert gates.opener("I want Figma.", Question("a", "Why do you want Figma?", "textarea")) == [
        'restates the question: "I want Figma."']
    assert gates.opener("I want Figma because Dev Mode hands designs to engineers like I did.", WHY) == []


def test_answer_runs_every_gate_on_one_answer():
    q = Question("a", "Why Figma?", "textarea", max_length=60)
    assert gates.answer("In summer 2026, I used PyTorch at Notion for 14 days.", q, "why-company",
                        SOURCES, "Figma") == [
        "a number no source holds: 14", "a name no source holds: PyTorch", "names another company: Notion",
        'opens on a date: "In summer 2026,"']
