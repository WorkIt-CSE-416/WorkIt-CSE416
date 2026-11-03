"""Code-side sameness checks: how far an answer drifts from Lisul's voice and
from the typical answer (research/sources/answer-types/g-sameness.md, S2-S8).

Pure Python and cheap, run after the edit. Each check gives flags for the
editor, never a reason to add a claim: truth always beats distinctiveness, and
an answer may stay typical when the only true answer is typical.

Every threshold below is a starting guess from g-sameness.md. Calibrate them
on his real answers (the 4 Meta answers and about 10 rehearsals) before the
gate blocks anything.
"""
from __future__ import annotations

import datetime
import json
import re
import statistics
from collections.abc import Iterable
from pathlib import Path

from apply import answering
from apply.home import HOME

# --- Thresholds (starting guesses; calibrate on his real answers) -------------
DRIFT_Z = 2.0  # standard deviations from his samples that count as drift (S3)
SPREAD_SENTENCES = 3  # sentences an answer needs before the spread of their lengths is judged
# Smallest spread each measure is judged with, so a few similar samples don't
# make every answer drift. In the measure's own units. His formal WRT102 essay
# (few "I" sentences) is what widens "i_share".
MIN_SPREAD = {
    "contractions": 0.4,     # per 100 words: he writes about 1 in 700, so the bar is about 1 per 100
    "sentence_mean": 5.0,    # words
    "sentence_spread": 4.0,  # words
    "ing_clauses": 1.0,      # per 100 words
    "verb_nouns": 1.5,       # per 100 words
    "i_share": 0.4,          # share of sentences
}
# Which way a measure drifts toward machine writing: +1 only above his range,
# -1 only below, 0 either way. More contractions, "-ing" clauses or verb-nouns,
# shorter or evener sentences, or fewer "I" sentences than his read as not him.
# Long sentences are writing.LONGEST's to catch, not this check's.
DIRECTION = {"contractions": 1, "sentence_mean": -1, "sentence_spread": -1,
             "ing_clauses": 1, "verb_nouns": 1, "i_share": -1}
DEFAULT_OVERLAP = 0.12  # share of the answer's 3-word runs found in the default answer (S4)
DEFAULT_OPENING = 4  # words of the first 8 shared with the default's first 8 (S4)
SHARED_RUN = 8  # words in a row shared with a past answer at another company (S7)
RECENT_STORIES = 3  # stories an answer type led with lately that the plan steers away from
CROSS_OVERLAP = 0.20  # share of 5-word runs shared with a past answer at another company (S7)
SWAP_ALLOWED = 1  # company sentences that may survive the swap outside COMPANY_FACING types (S6)

# Question types about the company itself (company_link: same-kind in
# apply/answering/types): none of their sentences may survive the swap, and
# their wording is compared with every past answer, not only the same type.
COMPANY_FACING = frozenset(t for t, guide in answering.load().items() if guide.company_link == "same-kind")

# The submitted answers, kept outside the repo beside Apply's other local state
# (~/.config/apply): they are Lisul's own answers and are never committed.
LEDGER = HOME / "answer-ledger.jsonl"

WORD = re.compile(r"[A-Za-z0-9][\w'’-]*")
# Contractions, not possessives: "'s" counts only after a pronoun ("it's").
CONTRACTION = re.compile(r"\b\w+n['’]t\b|\b\w+['’](?:re|ve|ll|d|m)\b"
                         r"|\b(?:it|that|there|here|what|who|he|she|let|where|how)['’]s\b", re.IGNORECASE)
# A participial "-ing" clause opening a sentence or following a comma (Reinhart).
ING_CLAUSE = re.compile(r"(?:^|[.!?]\s+|,\s+)([A-Za-z]+ing)\b")
NOT_ING = {"thing", "things", "during", "nothing", "something", "anything", "everything", "string", "spring",
           "king", "ring", "bring", "sing", "wing", "morning", "evening", "ceiling"}
# Verb-nouns (nominalizations): -tion, -ment, -ance, which LLMs overuse (Reinhart).
VERB_NOUN = re.compile(r"\b[A-Za-z]{2,}(?:tions?|ments?|ances?)\b")
NOT_VERB_NOUN = {"moment", "moments", "element", "elements", "comment", "comments", "segment", "segments",
                 "instance", "instances", "distance", "chance", "chances", "balance", "dance", "mention"}
I_WORD = re.compile(r"\bI(?:['’](?:m|ve|d|ll))?\b")


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.replace("\n", " ")) if WORD.search(s)]


def pieces(text: str) -> list[str]:
    """His samples (writing.samples()) as separate works: each quoted block
    ("> ") is one work, and so is each other paragraph, without the Story
    bank's own notes, headings and labels."""
    quoted = re.findall(r"(?:^>.*\n?)+", text, re.MULTILINE)
    rest = re.sub(r"(?:^>.*\n?)+", "\n\n", text, flags=re.MULTILINE)
    works = [" ".join(_paragraphs(re.sub(r"^> ?", "", q, flags=re.MULTILINE))) for q in quoted]
    return [w for w in works + _paragraphs(rest) if len(WORD.findall(w)) >= 40]


def _paragraphs(text: str) -> list[str]:
    out = []
    for para in re.split(r"\n\s*\n", text):
        if re.search(r"word for word", para):
            continue  # the Story bank's note about the samples
        lines = [ln.strip() for ln in para.splitlines() if ln.strip() and not ln.strip().startswith("**")
                 and not ln.rstrip().endswith(":")]
        if lines:
            out.append(" ".join(lines))
    return out


def voice_profile(text: str) -> dict[str, float]:
    """The measures of his voice that a check can test (S2, S3): contractions,
    "-ing" clauses and verb-nouns per 100 words, the mean and spread of
    sentence length in words, and the share of sentences with "I"."""
    words = len(WORD.findall(text))
    sentences = _sentences(text)
    lengths = [len(WORD.findall(s)) for s in sentences]
    per100 = lambda n: n / words * 100 if words else 0
    return {
        "contractions": per100(len(CONTRACTION.findall(text))),
        "sentence_mean": statistics.fmean(lengths) if lengths else 0,
        "sentence_spread": statistics.pstdev(lengths) if len(lengths) > 1 else 0,
        "ing_clauses": per100(sum(m.group(1).lower() not in NOT_ING for m in ING_CLAUSE.finditer(text))),
        "verb_nouns": per100(sum(m.group().lower() not in NOT_VERB_NOUN for m in VERB_NOUN.finditer(text))),
        "i_share": sum(bool(I_WORD.search(s)) for s in sentences) / len(sentences) if sentences else 0,
    }


def voice_drift(answer: str, samples: str | list[str]) -> dict[str, tuple[float, float]]:
    """The measures of `answer` more than DRIFT_Z spreads from his samples, in
    the DIRECTION that reads as machine-written, as {measure: (answer's value,
    his mean)}. `samples` is writing.samples() or a
    list of pieces; each measure's spread is at least MIN_SPREAD."""
    profiles = [voice_profile(p) for p in (pieces(samples) if isinstance(samples, str) else samples)]
    if not profiles:
        return {}
    mine = voice_profile(answer)
    drift = {}
    for measure, value in mine.items():
        if measure == "sentence_spread" and len(_sentences(answer)) < SPREAD_SENTENCES:
            continue  # one or two sentences have no spread to speak of
        values = [p[measure] for p in profiles]
        mean = statistics.fmean(values)
        spread = max(statistics.pstdev(values) if len(values) > 1 else 0, MIN_SPREAD[measure])
        z = (value - mean) / spread
        if (z > DRIFT_Z and DIRECTION[measure] >= 0) or (z < -DRIFT_Z and DIRECTION[measure] <= 0):
            drift[measure] = (value, mean)
    return drift


def _runs(text: str) -> list[list[str]]:
    """The lowercased words of `text` in runs broken at numbers and proper
    nouns (a capital not opening a sentence), so a swapped name or number
    still matches."""
    runs: list[list[str]] = [[]]
    for sentence in _sentences(text):
        for i, word in enumerate(WORD.findall(sentence)):
            if any(c.isdigit() for c in word) or (i and word[0].isupper() and not I_WORD.fullmatch(word)):
                runs.append([])
            else:
                runs[-1].append(word.lower().replace("’", "'"))
    return [r for r in runs if r]


def grams(text: str, n: int) -> set[tuple[str, ...]]:
    """The `n`-word runs of `text`, names and numbers left out (_runs)."""
    return {tuple(r[i:i + n]) for r in _runs(text) for i in range(len(r) - n + 1)}


def containment(text: str, other: str, n: int) -> float:
    """The share of `text`'s `n`-word runs that `other` also has."""
    mine = grams(text, n)
    return len(mine & grams(other, n)) / len(mine) if mine else 0


def default_overlap(answer: str, default_answer: str) -> float:
    """How much of `answer` is the typical applicant's answer (S4): the share
    of its 3-word runs found in `default_answer`. Above DEFAULT_OVERLAP fails."""
    return containment(answer, default_answer, 3)


def shared_opening(answer: str, default_answer: str) -> int:
    """Words the first 8 of `answer` share with the first 8 of `default_answer`
    (S4). DEFAULT_OPENING or more fails."""
    first = lambda t: {w.lower() for w in WORD.findall(t)[:8]}
    return len(first(answer) & first(default_answer))


class Ledger:
    """Every submitted answer, one JSON line each (company, question, type,
    text, date, and the Story bank story it led with), appended and never
    rewritten (S7, P6)."""

    def __init__(self, path: Path | None = None):
        self.path = Path(path or LEDGER)

    def add(self, company: str, question: str, type: str, text: str, date: str | None = None, story: str = "") -> None:
        entry = {"company": company, "question": question, "type": type, "text": text,
                 "date": date or datetime.date.today().isoformat(), "story": story}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def entries(self) -> list[dict]:
        if not self.path.is_file():
            return []
        return [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]

    def led(self, company: str, last: int = RECENT_STORIES) -> dict[str, list[str]]:
        """The stories his last `last` answers at other companies led with, by
        Question type, most recent first, each once; answers logged before
        stories were kept are left out."""
        led: dict[str, list[str]] = {}
        for entry in reversed(self.entries()):
            if entry.get("story") and entry["company"].casefold() != company.casefold():
                led.setdefault(entry["type"], [])
                if entry["story"] not in led[entry["type"]] and len(led[entry["type"]]) < last:
                    led[entry["type"]].append(entry["story"])
        return led

    def cross_overlap(self, answer: str, company: str, types: Iterable[str] | None = None) -> list[dict]:
        """Past answers at other companies that `answer` reuses: a shared run of
        SHARED_RUN words, or more than CROSS_OVERLAP of its 5-word runs. Each is
        the past entry with "run" (the first shared run, or None) and "overlap".
        `types` limits the past answers compared, None comparing all: the
        caller decides, and company-facing answers are compared with every type."""
        types = None if types is None else set(types)
        mine = [tuple(r[i:i + SHARED_RUN]) for r in _runs(answer) for i in range(len(r) - SHARED_RUN + 1)]
        hits = []
        for entry in self.entries():
            if entry["company"].casefold() == company.casefold() or (types is not None and entry["type"] not in types):
                continue
            theirs = grams(entry["text"], SHARED_RUN)
            run = next((" ".join(g) for g in mine if g in theirs), None)
            overlap = containment(answer, entry["text"], 5)
            if run or overlap > CROSS_OVERLAP:
                hits.append({**entry, "run": run, "overlap": overlap})
        return hits


# Words kept as themselves in an opening's shape; any other word is "_".
FUNCTION_WORDS = {"i", "my", "we", "our", "at", "in", "on", "for", "with", "during", "after", "before", "when",
                  "while", "as", "because", "since", "if", "the", "a", "an", "this", "that", "one", "yes", "no",
                  "of", "to", "from", "by", "and", "but", "so"}


def _shape(answer: str) -> str | None:
    """The shape of an answer's opening clause, when it opens with one: the
    words before a comma in its first 8 (function words kept, other runs as
    "_") and the word after it. "At Hitachi Rail, I" and "At WorkIt, I" are
    both "at _ , i". A cheap heuristic for S8's "opening pattern"."""
    sentences = _sentences(answer)
    head = re.match(r"([^,]*),\s*(\S+)", sentences[0]) if sentences else None
    if not head or len(WORD.findall(head.group(1))) > 8:
        return None
    shape: list[str] = []
    for word in WORD.findall(head.group(1)):
        word = word.lower()
        token = word if word in FUNCTION_WORDS else "_"
        if not (token == "_" and shape and shape[-1] == "_"):
            shape.append(token)
    after = WORD.findall(head.group(2))
    return " ".join([*shape, ",", *(w.lower() for w in after[:1])])


def same_openings(answers: dict | list[str]) -> list[tuple]:
    """Pairs of answers on one form that open the same way (S8): the same first
    3 words, or the same opening-clause shape (_shape). Each is (key, key,
    reason), keyed as `answers` is (dict keys or list positions)."""
    items = list(answers.items() if isinstance(answers, dict) else enumerate(answers))
    found = []
    for i, (a, first) in enumerate(items):
        for b, second in items[i + 1:]:
            words = [[w.lower() for w in WORD.findall(t)[:3]] for t in (first, second)]
            if len(words[0]) == 3 and words[0] == words[1]:
                found.append((a, b, f"the same first 3 words (\"{' '.join(words[0])}\")"))
            elif (shape := _shape(first)) and shape == _shape(second):
                found.append((a, b, f"the same opening shape (\"{shape}\")"))
    return found


# Capitalized words too generic to be a specific fact on their own.
GENERIC = {"AI", "ML", "API", "APIs", "UI", "UX", "CS", "SWE", "I"}


def swap_survivors(text: str, company: str, competitors: list[str],
                   names: Iterable[str] = ()) -> list[tuple[str, str | None]]:
    """Sentences of `text` that name `company` and would still read true with
    a competitor's name in its place (S6), each with that swap made for the
    first of `competitors` (None when there is none).

    A rough code-side filter, not the swap test itself: a sentence survives
    when it names the company and holds no specific fact, meaning no product
    or brief fact name from `names`, no number and no proper noun besides the
    company's. Lisul's read at a Hold is the real check."""
    names = [n for n in names if n]
    own = {w.casefold() for w in WORD.findall(company)}
    mention = re.compile(rf"\b{re.escape(company)}\b", re.IGNORECASE)
    found = []
    for sentence in _sentences(text):
        if not mention.search(sentence) or any(n.casefold() in sentence.casefold() for n in names):
            continue
        words = WORD.findall(sentence)
        proper = [w for i, w in enumerate(words)
                  if (w[0].isupper() if i else any(c.isupper() for c in w[1:]))
                  and re.sub(r"['’]s$", "", w).casefold() not in own and w not in GENERIC and not I_WORD.fullmatch(w)]
        if proper or any(c.isdigit() for c in sentence):
            continue
        found.append((sentence, mention.sub(competitors[0], sentence) if competitors else None))
    return found


# How each voice measure reads to the editor: (what it is, what to do).
DRIFT_NOTES = {
    "contractions": ("{v:.1f} contractions per 100 words, where the applicant writes about {m:.1f}", "write them out"),
    "sentence_mean": ("sentences average {v:.0f} words, where the applicant's average is {m:.0f}", "join some short ones"),
    "sentence_spread": ("sentence lengths too even (spread {v:.0f} words, the applicant's {m:.0f})", "vary them"),
    "ing_clauses": ("{v:.1f} \"-ing\" clauses per 100 words, where the applicant writes about {m:.1f}",
                    "say them with a plain verb"),
    "verb_nouns": ("{v:.1f} verb-nouns (-tion, -ment, -ance) per 100 words, where the applicant writes about {m:.1f}",
                   "use the verbs"),
    "i_share": ("{v:.0%} of sentences have \"I\", where the applicant's have {m:.0%}",
                "make the applicant the subject where the sources say they did it"),
}


def check(answer: str, *, type: str, form_answers: dict[str, str] | list[str], samples: str | list[str],
          default: str | None = None, ledger: Ledger | None = None, company: str | None = None,
          competitors: list[str] = (), names: Iterable[str] = ()) -> list[str]:
    """What the sameness checks find in `answer`, as flags for the editor in
    the style of writing.flags(): drift from his voice (`samples`), overlap
    with the typical `default` answer, reuse of his past answers at other
    companies (`ledger`), an opening shared with another of `form_answers`, and
    sentences about `company` that would read true of `competitors[0]`.

    Flags only: truth beats distinctiveness, so the editor fixes wording and
    picks other sourced facts, and never adds a claim to pass a check."""
    out = []
    for measure, (value, mean) in (voice_drift(answer, samples) if samples else {}).items():
        what, fix = DRIFT_NOTES[measure]
        out.append(f"voice: {what.format(v=value, m=mean)}: {fix}")
    if default:
        if (overlap := default_overlap(answer, default)) > DEFAULT_OVERLAP:
            out.append(f"reads like the typical answer: {overlap:.0%} of its 3-word runs are in it; "
                       "build it on the applicant's own story or idea from the sources")
        if shared_opening(answer, default) >= DEFAULT_OPENING:
            out.append(f"opens like the typical answer: \"{' '.join(answer.split()[:8])} ...\"; open on the applicant's own point")
    if ledger and company:
        for hit in ledger.cross_overlap(answer, company, types=None if type in COMPANY_FACING else {type}):
            how = f"\"{hit['run']} ...\"" if hit["run"] else f"{hit['overlap']:.0%} of its 5-word runs"
            out.append(f"reuses the applicant's {hit['company']} answer ({hit['date']}): {how}; say it afresh")
    others = form_answers if isinstance(form_answers, dict) else dict(enumerate(form_answers))
    marker = object()
    for a, b, reason in same_openings({marker: answer, **others}):
        if a is marker:
            out.append(f"opens like another answer on this form ({b}): {reason}; open another way")
    if company:
        survivors = swap_survivors(answer, company, list(competitors), names)
        if len(survivors) > (0 if type in COMPANY_FACING else SWAP_ALLOWED):
            rival = competitors[0] if competitors else "a competitor"
            out += [f"would read true of {rival}: \"{s}\"; tie it to a specific fact from the sources"
                    for s, _ in survivors]
    return out
