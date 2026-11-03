"""The code-side sameness checks (research/sources/answer-types/g-sameness.md)."""
import pytest

from apply import home, sameness, writing

HIS = """I use GitHub Copilot and Claude Code to plan and implement projects. My workflow is typically: ask an agent to interview me, then develop a spec which I review, and then divide into sub-tasks to finally implement. I keep the generated code minimal."""


# --- Voice measures -----------------------------------------------------------

def test_voice_profile_counts_each_measure():
    text = "I don't know. I can't say it's done. Running the tests, we found the configuration was wrong."
    p = sameness.voice_profile(text)
    assert p["contractions"] == pytest.approx(3 / 17 * 100)
    assert p["sentence_mean"] == pytest.approx(17 / 3)
    assert p["sentence_spread"] > 0
    assert p["ing_clauses"] == pytest.approx(1 / 17 * 100)
    assert p["verb_nouns"] == pytest.approx(1 / 17 * 100)
    assert p["i_share"] == pytest.approx(2 / 3)


def test_possessives_are_not_contractions():
    assert sameness.voice_profile("Figma's editor and the user's view load fast.")["contractions"] == 0


def test_voice_profile_of_empty_text_is_zero():
    assert set(sameness.voice_profile("").values()) == {0}


def test_voice_drift_flags_a_contraction_heavy_answer():
    drift = sameness.voice_drift(
        "I'm sure it's fine. I'd say we've done what we couldn't. It's what I'll keep doing, and I won't stop.",
        writing.samples())
    assert "contractions" in drift


def test_voice_drift_flags_choppy_even_sentences_but_not_long_ones():
    choppy = sameness.voice_drift("I built the tool. It ran every night. I fixed the slow query. We shipped it.",
                                  writing.samples())
    assert {"sentence_mean", "sentence_spread"} <= set(choppy)
    long = " ".join(["I wrote the adapter that read the feed and checked each update against the schema"] * 3)
    assert "sentence_mean" not in sameness.voice_drift(long.replace("schema I", "schema, and I") + ".",
                                                       writing.samples())



def test_an_answer_of_one_or_two_sentences_has_no_spread_to_judge():
    one = "I built the depot tracker that read every bus from one overhead camera for the dispatch team."
    assert "sentence_spread" not in sameness.voice_drift(one, writing.samples())
    assert "sentence_spread" not in sameness.voice_drift(f"{one} {one}", writing.samples())

def test_voice_drift_passes_his_own_kind_of_answer():
    assert sameness.voice_drift(HIS, writing.samples()) == {}


def test_the_samples_are_the_applicants_own_sections_of_the_story_bank_by_any_name():
    home.STORY_BANK.write_text("## Ana's own essays\nI built a robot.\n\n## Ana's own answers, word for word\n- Yes.\n"
                               "## Education\n- A school.\n")
    assert writing.samples().split() == ["I", "built", "a", "robot.", "-", "Yes."]


def test_his_own_samples_are_not_flagged():
    """Calibration: each piece of his own writing, held out from the rest,
    stays within the thresholds. If this fails, the thresholds are wrong, not him."""
    pieces = sameness.pieces(writing.samples())
    assert len(pieces) >= 5
    for i, piece in enumerate(pieces):
        rest = pieces[:i] + pieces[i + 1:]
        assert sameness.voice_drift(piece, rest) == {}, piece[:80]


# --- Overlap with the default answer (S4) ---------------------------------------

DEFAULT = ("I want to join Figma because I love building tools that help people collaborate. "
           "I am excited to learn from a talented team and grow as an engineer.")


def test_default_overlap_is_the_share_of_three_word_runs_it_shares():
    assert sameness.default_overlap(DEFAULT, DEFAULT) == 1
    assert sameness.default_overlap("The adapter checked each update against the schema.", DEFAULT) == 0
    half = "I want to join because the adapter checked updates."  # 2 of 7 runs shared
    assert sameness.default_overlap(half, DEFAULT) == pytest.approx(2 / 7)


def test_default_overlap_leaves_out_names_and_numbers():
    # The company's name breaks the run, so a swapped name still matches.
    assert sameness.default_overlap("I want to join Canva because I love building", DEFAULT) == 1
    assert sameness.default_overlap("We cut 40 minutes", "We cut 40 minutes") == 0


def test_shared_opening_counts_words_shared_in_the_first_eight():
    assert sameness.shared_opening("I want to join Figma because WorkIt was designed in it", DEFAULT) == 6
    assert sameness.shared_opening("At Hitachi Rail I wrote two adapters", DEFAULT) == 1


# --- Ledger of submitted answers (S7) -------------------------------------------

PAST = ("At Hitachi Rail I wrote two adapters that read live bus locations from transit feeds "
        "and handed them to the dispatch system in the format it already used.")


def test_ledger_appends_one_line_per_answer(tmp_path):
    ledger = sameness.Ledger(tmp_path / "ledger.jsonl")
    assert ledger.entries() == []
    ledger.add("Figma", "Why Figma?", "why-company", "One.", date="2026-10-20", story="Micromouse")
    ledger.add("Meta", "A project?", "project", "Two.")
    entries = sameness.Ledger(tmp_path / "ledger.jsonl").entries()
    assert [e["company"] for e in entries] == ["Figma", "Meta"]
    assert entries[0] == {"company": "Figma", "question": "Why Figma?", "type": "why-company", "text": "One.",
                          "date": "2026-10-20", "story": "Micromouse"}
    assert entries[1]["date"]  # today, when not given


def test_default_ledger_lives_outside_the_repo():
    repo = sameness.Path(sameness.__file__).resolve().parents[3]
    assert not sameness.LEDGER.resolve().is_relative_to(repo)


def test_cross_overlap_flags_a_shared_eight_word_run_at_another_company(tmp_path):
    ledger = sameness.Ledger(tmp_path / "ledger.jsonl")
    ledger.add("Meta", "A project?", "project", PAST)
    answer = ("My best project: I wrote two adapters that read live bus locations from transit feeds. "
              "It taught me a lot about message formats.")
    hits = ledger.cross_overlap(answer, "Figma")
    assert len(hits) == 1
    assert hits[0]["company"] == "Meta"
    assert hits[0]["run"] == "i wrote two adapters that read live bus"
    assert ledger.cross_overlap(answer, "meta") == []  # the same company is not reuse across companies


def test_cross_overlap_flags_five_word_overlap_above_the_bar(tmp_path):
    ledger = sameness.Ledger(tmp_path / "ledger.jsonl")
    ledger.add("Meta", "A project?", "project", "one two three four five six seven. alpha beta gamma delta epsilon.")
    hits = ledger.cross_overlap("one two three four five zeta. alpha beta gamma delta epsilon.", "Figma")
    assert hits and hits[0]["run"] is None
    assert hits[0]["overlap"] == pytest.approx(2 / 7)
    assert ledger.cross_overlap("Something else entirely, written fresh for this form.", "Figma") == []


def test_cross_overlap_keeps_to_the_types_the_caller_names(tmp_path):
    ledger = sameness.Ledger(tmp_path / "ledger.jsonl")
    ledger.add("Meta", "A project?", "project", PAST)
    assert ledger.cross_overlap(PAST, "Figma", types={"why-company"}) == []
    assert len(ledger.cross_overlap(PAST, "Figma", types={"project"})) == 1


# --- Openings on one form (S8) ---------------------------------------------------

def test_same_openings_flags_the_same_first_three_words():
    found = sameness.same_openings({"why": "I want to build tools for designers.",
                                    "goal": "I want to learn how large teams ship.",
                                    "project": "At Hitachi Rail, I wrote two adapters."})
    assert found == [("why", "goal", "the same first 3 words (\"i want to\")")]


def test_same_openings_flags_the_same_opening_clause_shape():
    found = sameness.same_openings(["At Hitachi Rail, I wrote two adapters.", "At WorkIt, I led the backend."])
    assert found == [(0, 1, "the same opening shape (\"at _ , i\")")]


def test_same_openings_passes_different_openings():
    assert sameness.same_openings(["At Hitachi Rail, I wrote two adapters.", "When the feed broke, I checked it.",
                                   "I wrote the adapters.", "I led the team."]) == []


# --- Swap test, code half (S6) ---------------------------------------------------

WHY = ("I admire Figma's focus on collaboration. Figma's multiplayer editing let five of us edit one frame. "
       "At Figma, I would build tools that help teams work together. Figma AI made our WorkIt screens in minutes. "
       "I wrote two adapters at Hitachi Rail.")


def test_swap_survivors_are_company_sentences_with_no_specific_fact():
    found = sameness.swap_survivors(WHY, "Figma", ["Canva", "Miro"], names=["multiplayer editing", "Figma AI"])
    assert found == [("I admire Figma's focus on collaboration.", "I admire Canva's focus on collaboration."),
                     ("At Figma, I would build tools that help teams work together.",
                      "At Canva, I would build tools that help teams work together.")]


def test_swap_survivors_without_competitors_or_names():
    # Without the brief's names, "AI" and "API" are generic: the filter is rough.
    found = sameness.swap_survivors("Figma AI is great. We used the Figma API in 2025. I like WorkIt.", "Figma", [])
    assert found == [("Figma AI is great.", None)]


# --- All checks together -----------------------------------------------------------

def test_check_gathers_each_finding_as_a_flag(tmp_path):
    ledger = sameness.Ledger(tmp_path / "ledger.jsonl")
    ledger.add("Meta", "A project?", "project", PAST)
    answer = ("I want to join Figma because I love building tools that help people collaborate. "
              "I wrote two adapters that read live bus locations from transit feeds. "
              "I admire Figma's focus on collaboration.")
    found = sameness.check(answer, type="why-company", form_answers={"goal": "I want to learn how teams ship."},
                           samples=writing.samples(), default=DEFAULT, ledger=ledger, company="Figma",
                           competitors=["Canva"], names=["multiplayer editing"])
    text = "\n".join(found)
    assert "typical answer" in text and "opens like the typical answer" in text
    assert "Meta answer" in text and "i wrote two adapters that read live bus" in text
    assert "goal" in text and "i want to" in text
    assert "Canva" in text and "I admire Figma's focus on collaboration." in text
    assert all(isinstance(f, str) for f in found)


def test_check_allows_one_swap_survivor_outside_company_facing_types():
    answer = "I wrote two adapters at Hitachi Rail. I like Figma."
    assert not any("true of" in f for f in sameness.check(answer, type="project", form_answers={}, samples=[],
                                                          company="Figma", competitors=["Canva"]))
    assert any("true of" in f for f in sameness.check(answer, type="why-company", form_answers={}, samples=[],
                                                      company="Figma", competitors=["Canva"]))


def test_check_passes_his_own_answer():
    own = sameness.pieces(writing.samples())[1]  # his Figma project answer
    assert sameness.check(own, type="project", form_answers=[DEFAULT], samples=writing.samples(),
                          default=DEFAULT, company="Figma") == []
