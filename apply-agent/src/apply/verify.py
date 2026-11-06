"""Verifying: after a form is filled and before any submit, Apply reads the
filled form back from the page and checks it against the Applicant profile,
the Posting and its own plan. The result is Verified, or Verified with flags:
each flag names a field and why it needs Lisul.

Plain code makes every check here. The judgment checks (answers that
contradict each other, an essay wrong for its question) are the Pre-submit
review's (apply.presubmit), whose findings join the flags. Verifying only
reads: it never clicks, types or submits."""

import fcntl
import json
import os
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass, replace
from datetime import date
from pathlib import Path

from apply import fill_engine
from apply.home import HOME
from apply.model import (
    Answers,
    Posting,
    QuestionSet,
    Readback,
    is_company,
    one_line,
)
from apply.profile import ApplicantProfile
from apply.records import SECRET

# The kinds of flag. Each holds a live run (goes to Needs you), except a guess and a blank the engine's plan meant
# and says why (notes). Any other blank optional field holds too: a blank optional is a bug (Lisul, 2026-11-02),
# except an optional catch-all box ("Additional information") Apply had nothing new for: a note (Lisul, 2026-11-04).
BLANK, READBACK, FILE, CHOICE, DATE, PAY, PRONOUN, NAME, COMPANY, REVIEW, GUESSED, HISTORY_KIND = (
    "blank", "readback", "file", "choice", "date", "pay", "pronoun", "name", "company", "review", "guessed", "history")
# Starts each flag's part of a held row's reason.
PREFIX = "Verify: "
# The flags Lisul dismissed, by Application ID: each Application's Record keeps them, past a reload or a new run.
DISMISSED = HOME / "dismissed-flags.json"

# Employers an essay may name by mistake (one written for another form), beside the policies' named companies.
COMPANIES = (
    "Google", "Alphabet", "DeepMind", "Meta", "Facebook", "Amazon", "AWS", "Apple", "Microsoft", "Netflix", "Nvidia",
    "NVIDIA", "OpenAI", "Anthropic", "Tesla", "SpaceX", "Stripe", "Ramp", "Palantir", "Databricks", "Snowflake",
    "Airbnb", "Uber", "Lyft", "DoorDash", "Instacart", "Coinbase", "Robinhood", "Plaid", "Figma", "Notion", "Salesforce",
    "Oracle", "IBM", "Intel", "AMD", "Qualcomm", "Adobe", "LinkedIn", "Pinterest", "Snap", "Reddit", "Spotify",
    "Shopify", "Atlassian", "Cloudflare", "Datadog", "MongoDB", "Scale AI", "Cohere", "Perplexity", "xAI", "Mistral",
    "Hugging Face", "Jane Street", "Citadel", "Two Sigma", "Hudson River Trading", "Optiver", "Jump Trading",
    "Point72", "Capital One", "Goldman Sachs", "JPMorgan", "Morgan Stanley", "Bloomberg", "Waymo", "Cruise",
    "Anduril", "Shield AI", "Skydio", "Harvey", "Sierra", "Cognition", "Mercor", "ElevenLabs", "Vercel", "Supabase",
    "Rippling", "Brex", "Duolingo", "Roblox", "Epic Games", "Riot Games", "Zoom", "Slack", "Dropbox", "Box",
    "Twilio", "Square", "Block", "Affirm", "Chime", "SoFi", "Wealthfront", "Asana", "Airtable", "Retool", "Benchling",
)
# Each set of third-person pronouns, and the words of it an essay may use.
PRONOUNS = {"he": ("he", "him", "his", "himself"), "she": ("she", "her", "hers", "herself"),
            "they": ("they", "them", "their", "theirs", "themselves")}
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
MY_NAME = re.compile(r"\bmy name is ([A-Z][a-z]+)")
SIGN_OFF = re.compile(r"(?:Sincerely|Best|Regards|Best regards|Thank you|Thanks),?\s*\n\s*([A-Z][\w'-]+(?: [A-Z][\w'-]+)+)\s*$")
GRADUATION = re.compile(r"graduat", re.IGNORECASE)
START = re.compile(r"start date|earliest (?:date|start)|available to start|availability date|when can you start", re.IGNORECASE)
# A start date of the applicant's history, which is past by nature: a field of a numbered entry ("Work Experience 1 /
# Start date"), one a form caps at this month, or one about schooling or a job held (Infleqtion's Workable, live 2026-11-04).
HISTORY = re.compile(r"^[^/]*\s\d+ / |\bup to this month\b|\b(?:education|employment|work (?:experience|history))\b",
                     re.IGNORECASE)
# A field of a work-history section's entry ("Work Experience 2 / Employer"), or one under a work section's heading,
# that names the employer (KAN-728): every job on file should show in one. Its "type" is the kind of job, not it.
WORK_ENTRY = re.compile(r"^work (?:experience|history)\b[^/]*\s\d+ / ", re.IGNORECASE)
WORK_SECTION = re.compile(r"\b(?:employment|work (?:experience|history))\b", re.IGNORECASE)
EMPLOYER_FIELD = re.compile(r"\b(?:company|employer|organi[sz]ation)\b(?!.*\btype\b)", re.IGNORECASE)
ENTRIES = re.compile(r"^work (?:experience|history)\b.*\(entries\)$", re.IGNORECASE)
PAY_QUESTION = re.compile(r"salary|compensation|desired (?:pay|rate)|hourly rate|pay expectation|expected pay", re.IGNORECASE)
YEAR = re.compile(r"\b(20\d\d)\b")
MONEY = re.compile(r"\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b)?", re.IGNORECASE)
MONTHS = {m: n for n, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
DATES = [
    (re.compile(r"\b(\d{1,2})/(\d{1,2})/(20\d\d)\b"), lambda m: (int(m[3]), int(m[1]), int(m[2]))),
    (re.compile(r"\b(20\d\d)-(\d{1,2})-(\d{1,2})\b"), lambda m: (int(m[1]), int(m[2]), int(m[3]))),
    (re.compile(r"\b(20\d\d)-(\d{1,2})\b"), lambda m: (int(m[1]), int(m[2]), 28)),
    (re.compile(r"\b(\d{1,2})/(20\d\d)\b"), lambda m: (int(m[2]), int(m[1]), 28)),
    (re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}, )?(20\d\d)\b", re.IGNORECASE),
     lambda m: (int(m[3]), MONTHS[m[1].lower()], int(m[2].rstrip(", ")) if m[2] else 28)),
]
# A legal or eligibility answer: work authorization, sponsorship, citizenship, U.S. Person and export control, age,
# criminal history. A review problem with one that contradicts the profile holds Submit itself on a held page, not
# only a note (Saronic's U.S. Person question was sent "No" for a U.S. citizen, 2026-11-04).
LEGAL = re.compile(
    r"authori[sz](?:ed|ation) to work|work authori[sz]|eligib\w* to work|right to work|sponsor|\bvisa\b|citizen"
    r"|\bu\.?s\.? persons?\b|\bitar\b|\bear\b|export[- ]control|green card|permanent resident|refugee|asylee"
    r"|\b(?:18|eighteen|21|legal working age) (?:years|or older)\b|years of age|\bage of\b|how old"
    r"|criminal|felon|convict|misdemeanor|background check",
    re.IGNORECASE)
RESUME_FIELD = re.compile(r"r[eé]sum[eé]|\bcv\b", re.IGNORECASE)
COVER_FIELD = re.compile(r"cover letter", re.IGNORECASE)
TRANSCRIPT_FIELD = re.compile(r"transcript", re.IGNORECASE)
PLACEHOLDER = re.compile(r"^\W*(select|choose|pick)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Flag:
    """One thing on the filled form that needs Lisul: its field and why."""

    field: str
    why: str
    kind: str
    holds: bool = True  # a live run holds the Application for it; a guess is only noted
    dismissed: bool = False  # Lisul dismissed it for this Application: it holds no more

    def line(self) -> str:
        return f"{self.field}: {self.why}" if self.field else self.why


@dataclass(frozen=True)
class Verification:
    """How verifying one filled form went: its flags, and how many fields it read back."""

    flags: tuple[Flag, ...] = ()
    checked: int = 0

    @property
    def needs(self) -> tuple[Flag, ...]:
        """The flags that need Lisul before a submit: every one but a guess."""
        return tuple(f for f in self.flags if f.holds)

    @property
    def holds_submit(self) -> tuple[Flag, ...]:
        """The Pre-submit review's problems with a legal or eligibility answer (LEGAL) that Lisul hasn't
        dismissed: they hold Submit on a held page until he fixes the answer or dismisses them."""
        return tuple(f for f in self.needs if legal(f))

    @property
    def verified(self) -> bool:
        return not self.needs

    @property
    def notes(self) -> tuple[Flag, ...]:
        """The flags only noted: a guess, a blank the engine's plan meant."""
        return tuple(f for f in self.flags if not f.holds and not f.dismissed)

    def label(self) -> str:
        """"Verified" (with its notes, if any), or "Verified with N items that need you"."""
        n, notes = len(self.needs), len(self.notes)
        if n:
            return f"Verified with {n} item{'s' if n > 1 else ''} that need{'s' if n == 1 else ''} you"
        return "Verified" + (f" · {notes} note{'s' if notes > 1 else ''}" if notes else "")

    def as_json(self) -> dict:
        return {"state": "verified" if self.verified else "flagged", "label": self.label(), "checked": self.checked,
                "flags": [asdict(f) for f in self.flags]}

    def shown(self) -> list[dict]:
        """The flags as the Apply window lists them: {field, why, kind, holds}."""
        return [asdict(f) for f in self.flags]


def legal(flag: Flag) -> bool:
    """Whether a flag is the Pre-submit review's, about a legal or eligibility answer."""
    return flag.kind == REVIEW and bool(LEGAL.search(f"{flag.field} {flag.why}"))


def verifying(verification: "Verification | None") -> dict:
    """What a tile's caption says of verifying (Dashboard.update): that it is under way (None), then how it went."""
    if verification is None:
        return {"verifying": True, "verification": None}
    return {"verifying": False, "verification": verification.as_json()}


def check(
    questions: QuestionSet, answers: Answers, readback: Readback, profile: ApplicantProfile, posting: Posting, *,
    asked: Iterable[str] = (), left: Iterable[str] = (), blanks: dict[str, str] | None = None, accepted: dict[str, tuple[str, ...]] | None = None,
    essays: dict[str, str] | None = None, allowed: str = "", posting_text: str = "", today: date | None = None,
    guessed: Iterable[tuple[str, str]] = (), review: Iterable[str] = (), dismissed: Iterable[tuple[str, str]] = (),
) -> Verification:
    """Verify one filled form. `answers` is what Apply meant to fill and
    `readback` what the page shows. `asked` names the Missing facts Lisul is
    asked already (by label) and `left` the fields Apply left blank on purpose
    (by name): neither is flagged as blank again. `blanks` is each field the
    engine's plan leaves blank on purpose, by name, with why: a note, which
    does not hold. `essays` is each essay's
    text by field name (a cover letter given as a file among them); a text
    area's answer is one too. `allowed` is the text an essay may draw on (the
    Story bank, the profile, the Company material): a company it names is no
    other company's name. `guessed` is each (question, answer) Claude
    guessed, and `review` each problem the Pre-submit review found.
    `dismissed` is each (field, why) Lisul dismissed for this Application
    (dismissed()): its flag is kept, marked dismissed, and holds no more."""
    today = today or date.today()
    essays = dict(essays or {}) | {q.name: a for q in questions if q.kind == "textarea"
                                   and isinstance(a := readback.get(q.name) or answers.get(q.name), str) and a.strip()}
    labels = {q.name: one_line(q.label) for q in questions}
    flags = (
        _blanks(questions, answers, readback, set(asked), set(left), blanks or {})
        + [Flag(*_split(p), READBACK) for p in fill_engine.readback_problems(questions, answers, readback, accepted)]
        + _files(questions, answers, profile)
        + _choices(questions, readback)
        + _dates(questions, readback, profile, today)
        + _pay(questions, readback, profile, posting_text)
        + _work_history(questions, readback, profile)
        + [f for name, text in essays.items() for f in _essay(labels.get(name, name), text, profile, posting,
                                                              f"{allowed}\n{posting_text}")]
        + [Flag(*_split(p), REVIEW) for p in review]
        + [Flag(q, f"Claude guessed this answer: {one_line(a)}", GUESSED, holds=False) for q, a in guessed]
    )
    gone = set(dismissed)
    flags = [replace(f, holds=False, dismissed=True) if (f.field, f.why) in gone else f for f in flags]
    return Verification(tuple(dict.fromkeys(flags)), sum(1 for q in questions if q.name in readback))


def dismissed(application_id: str) -> set[tuple[str, str]]:
    """Each (field, why) Lisul dismissed for this Application."""
    return {tuple(f) for f in _read_dismissed().get(str(application_id), [])}


def dismiss(application_id: str, field: str, why: str) -> None:
    """Lisul dismissed this flag of this Application: it holds it no more, in this run or the next."""
    DISMISSED.parent.mkdir(parents=True, exist_ok=True)
    with open(DISMISSED.with_suffix(".lock"), "a") as lock:  # the window's threads and other runs share the file
        fcntl.flock(lock, fcntl.LOCK_EX)
        every = _read_dismissed()
        mine = every.setdefault(str(application_id), [])
        if [field, why] not in mine:
            mine.append([field, why])
        part = DISMISSED.with_suffix(".part")
        part.write_text(json.dumps(every, indent=2, ensure_ascii=False) + "\n")
        os.replace(part, DISMISSED)


def _read_dismissed() -> dict[str, list[list[str]]]:
    try:
        return json.loads(DISMISSED.read_text())
    except (OSError, ValueError):
        return {}


def without_dismissed(item: dict) -> dict:
    """A tile's caption or a window item, with the flags Lisul dismissed for its Application (dismiss()) holding
    it no more: marked dismissed in its verification, and out of its reason."""
    application = str(item.get("application_id") or "")
    gone = dismissed(application) if application else set()
    if not gone:
        return item
    item = dict(item)
    if verification := item.get("verification"):
        flags = [f | {"holds": False, "dismissed": True} if (f.get("field") or "", f["why"]) in gone else f
                 for f in verification.get("flags") or []]
        item["verification"] = Verification(tuple(Flag(**f) for f in flags), int(verification.get("checked") or 0)).as_json()
    lines = {PREFIX + Flag(field, why, "").line() for field, why in gone}
    item["why"] = "; ".join(part for part in str(item.get("why") or "").split("; ") if part not in lines)
    return item


def _split(problem: str) -> tuple[str, str]:
    """A "<field>: why" problem as (field, why)."""
    field, _, why = str(problem).partition(": ")
    return (field, why) if why else ("", field)


def _blank(value) -> bool:
    return value in (None, "", []) or (isinstance(value, str) and not value.strip())


def _blanks(questions, answers, readback, asked: set[str], left: set[str], planned: dict[str, str]) -> list[Flag]:
    """Each field left blank that Lisul isn't asked already and Apply didn't leave blank on purpose. One the
    engine's plan leaves blank on purpose, with why (`planned`), is a note."""
    flags = []
    answered = {_norm(q.label) for q in questions if q.name in answers}
    for q in questions:
        if q.name in answers or not _blank(readback.get(q.name)) or q.name in left or q.label.strip() in asked:
            continue
        if _norm(q.label) in answered:
            continue  # the other way to give the same thing (a resume pasted as text, when the file is attached)
        if SECRET.search(q.label) or SECRET.search(q.name):
            continue  # a password the Filler types itself
        if q.kind == "file" and not q.required and not (RESUME_FIELD.search(q.label) or COVER_FIELD.search(q.label)
                                                        or TRANSCRIPT_FIELD.search(q.label)):
            continue  # an optional "other documents" upload: nothing to give it is right
        if fill_engine.not_called_for(q, questions, answers)[0]:
            continue  # a follow-up the answer before it doesn't call for
        if q.name in planned:  # the engine meant it, and says why: only noted
            flags.append(Flag(one_line(q.label), f"left blank on purpose: {planned[q.name]}", BLANK, holds=False))
            continue
        # An optional one holds as a required one does, a self-ID one too: the profile answers it, a decline at least.
        flags.append(Flag(one_line(q.label), f"left blank ({'required' if q.required else 'optional'})", BLANK))
    return flags


def _role(name: str, profile: ApplicantProfile) -> str:
    """Which of Lisul's files a file is, by its name: resume, cover letter, transcript, or ""."""
    for key, role in (("files.resume_pdf", "resume"), ("files.unofficial_transcript_pdf", "transcript")):
        own = profile.get(key)
        if own and Path(own).name == name:
            return role
    lower = name.lower()
    return "cover letter" if "cover" in lower else "transcript" if "transcript" in lower \
        else "resume" if re.search(r"r[eé]sum[eé]|\bcv\b", lower) else ""


def _files(questions, answers, profile) -> list[Flag]:
    """An empty file, or one given to another kind of file's field. One the page didn't take is the read-back's."""
    flags = []
    for q in questions:
        given = answers.get(q.name)
        if q.kind != "file" or not isinstance(given, Path):
            continue
        if given.is_file() and given.stat().st_size == 0:
            flags.append(Flag(one_line(q.label), f"{given.name} is empty", FILE))
            continue
        wants = "cover letter" if COVER_FIELD.search(q.label) else "transcript" if TRANSCRIPT_FIELD.search(q.label) \
            else "resume" if RESUME_FIELD.search(q.label) else ""
        has = _role(given.name, profile)
        own = profile.get({"resume": "files.resume_pdf", "transcript": "files.unofficial_transcript_pdf"}.get(wants, "-"))
        if own and Path(own).name == given.name:
            continue  # the profile's own file for that field (the sample's resume stands in for its transcript)
        if wants and has and wants != has:
            flags.append(Flag(one_line(q.label), f"has {given.name}, a {has}, in a {wants} field", FILE))
    return flags


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip().lower()


def _choices(questions, readback) -> list[Flag]:
    """A dropdown, radio or checkbox that shows a value none of its options holds."""
    flags = []
    for q in questions:
        shown = readback.get(q.name)
        options = {_norm(o) for o in q.options if not PLACEHOLDER.match(o)}
        if q.kind not in ("select", "multi_select") or not options or _blank(shown):
            continue
        if q.kind == "select" and PLACEHOLDER.match(str(shown)):
            flags.append(Flag(one_line(q.label), "left on its placeholder: nothing is picked", CHOICE))
        elif odd := [s for s in (shown if isinstance(shown, list) else [shown]) if _norm(s) not in options]:
            flags.append(Flag(one_line(q.label), f"shows {', '.join(map(repr, odd))}, which is not one of its options", CHOICE))
    return flags


def _date_in(text: str) -> date | None:
    for pattern, parts in DATES:
        if m := pattern.search(text):
            try:
                return date(*parts(m))
            except ValueError:
                continue
    return None


def _dates(questions, readback, profile, today: date) -> list[Flag]:
    """A graduation year that isn't the profile's, and an availability or internship start date already past.
    A start date of a school or job held is past by nature, so it is not checked."""
    flags = []
    graduation = str(profile.get("education.expected_graduation") or "")
    for q in questions:
        shown = readback.get(q.name)
        if not isinstance(shown, str) or not shown.strip():
            continue
        if GRADUATION.search(q.label) and graduation[:4].isdigit() and q.kind != "textarea":
            years = YEAR.findall(shown)
            if years and graduation[:4] not in years:
                flags.append(Flag(one_line(q.label), f"shows {shown!r}; your graduation is {graduation}", DATE))
        if START.search(q.label) and not HISTORY.search(q.label) and (when := _date_in(shown)) and when < today:
            flags.append(Flag(one_line(q.label), f"shows {shown!r}, a date already past", DATE))
    return flags


def _work_history(questions, readback, profile) -> list[Flag]:
    """Each job on file that no employer field of the form's work section shows (TAL.net's Employment got one of three,
    KAN-728). A section that takes fewer entries than the jobs on file ("Work Experience (entries)" options) leaves
    some out by need: then the choice is a note for Lisul to check; any other missing job holds."""
    fields = [q for q in questions if q.kind != "textarea" and EMPLOYER_FIELD.search(q.label.split(" / ")[-1])
              and (WORK_ENTRY.search(q.label) or WORK_SECTION.search(q.section))]
    jobs = [str(j.get("employer") or "").strip() for j in profile.get("experience_facts.employment_history") or []
            if isinstance(j, dict)]
    if not fields or not (jobs := [j for j in jobs if j]):
        return []
    shown = " | ".join(_norm(" ".join(v) if isinstance(v := readback.get(q.name), list) else v or "") for q in fields)
    missing = [j for j in jobs if _norm(re.sub(r"\s*\(.*?\)", "", j)) not in shown]
    if not missing:
        return []
    counts = [int(o) for q in questions if ENTRIES.search(q.label.strip()) for o in q.options if str(o).strip().isdigit()]
    cap = max(counts) if counts else None
    if cap is not None and len(jobs) > cap and len(jobs) - len(missing) >= cap:
        put = [j for j in jobs if j not in missing]
        return [Flag("Work history", f"the section takes {cap} entries: Apply put {', '.join(put) or 'none'} and left out "
                     f"{', '.join(missing)}. Check the choice", HISTORY_KIND, holds=False)]
    return [Flag("Work history", f"{j}, a job on your profile, is not on the form's work section", HISTORY_KIND)
            for j in missing]


def _amounts(text: str) -> list[float]:
    found = []
    for m in MONEY.finditer(text):
        value = float(m[1].replace(",", "")) * (1000 if m[2] else 1)
        if value >= 5:
            found.append(value)
    return found


def _hourly(value: float) -> float:
    """A pay figure per hour: a year's figure over 40 h x 52 weeks."""
    return value / 2080 if value > 1000 else value


def _pay(questions, readback, profile, posting_text: str) -> list[Flag]:
    """A pay figure outside the Posting's own range, or off the fallback rate when the Posting names none."""
    from apply.description import pay_range  # its patterns read the Posting's text

    stated = [_hourly(v) for v in _amounts(pay_range(posting_text or ""))]
    fallback = profile.policy("compensation.fallback_hourly")
    flags = []
    for q in questions:
        shown = readback.get(q.name)
        if not PAY_QUESTION.search(q.label) or not isinstance(shown, str) or q.kind == "textarea":
            continue
        asked = [_hourly(v) for v in _amounts(shown)]
        if not asked:
            continue
        if stated and any(not min(stated) * 0.99 <= a <= max(stated) * 1.01 for a in asked):
            flags.append(Flag(one_line(q.label), f"shows {shown!r}, outside the posting's pay range", PAY))
        elif not stated and fallback and any(abs(a - float(fallback)) > 0.5 for a in asked):
            flags.append(Flag(one_line(q.label), f"shows {shown!r}; your fallback rate is ${fallback}/hr", PAY))
    return flags


def _names(profile: ApplicantProfile) -> list[str]:
    """The applicant's own names: each first name, the last name, and the full name."""
    first = [n for n in (profile.get("identity.preferred_first_name"), profile.get("identity.legal_first_name")) if n]
    last = profile.get("identity.legal_last_name") or ""
    return list(dict.fromkeys([*first, *(f"{f} {last}" for f in first if last), *([last] if last else [])]))


def essay(label: str, text: str, profile: ApplicantProfile, posting: Posting, allowed: str) -> list[Flag]:
    """The flags of one essay alone: what `check` finds in it (apply.regenerate checks an answer written again)."""
    return _essay(label, text, profile, posting, allowed)


def _essay(label: str, text: str, profile: ApplicantProfile, posting: Posting, allowed: str) -> list[Flag]:
    """A wrong pronoun or name for the applicant, and another company's name, in one essay."""
    flags = []
    names = _names(profile)
    firsts = [n for n in names if " " not in n]
    own = str(profile.get("identity.pronouns") or "").lower()
    theirs = {w for key, words in PRONOUNS.items() if re.match(rf"\s*{key}\b", own) or f"/{key}" in own for w in words}
    if theirs:
        sentences = [s for s in SENTENCE.split(text) if s.strip()]
        wrong = {w for key, words in PRONOUNS.items() for w in words if w not in theirs and key != "they"}
        for n, sentence in enumerate(sentences):
            named = [x for x in names if re.search(rf"\b{re.escape(x)}\b", sentence)]
            if not named:
                continue
            near = " ".join(sentences[n:n + 2]).lower()
            if said := sorted({w for w in re.findall(r"[a-z]+", near) if w in wrong}):
                flags.append(Flag(label, f"calls {named[0]} '{said[0]}'; {named[0]}'s pronouns are {own}", PRONOUN))
                break
    for m in MY_NAME.finditer(text):
        if m[1] not in firsts:
            flags.append(Flag(label, f"says 'my name is {m[1]}'; your name is {firsts[0] if firsts else 'not that'}", NAME))
    if (m := SIGN_OFF.search(text.strip())) and names and m[1] not in names:
        flags.append(Flag(label, f"is signed '{m[1]}', not {names[0]}", NAME))
    for company in _companies(profile):
        if is_company(posting.company, company) or is_company(company, posting.company.split(" ")[0] or "-"):
            continue
        if re.search(rf"\b{re.escape(company)}\b", text) and not re.search(rf"\b{re.escape(company)}\b", allowed, re.IGNORECASE):
            flags.append(Flag(label, f"names {company}, another company (this form is {posting.company}'s)", COMPANY))
    return flags


def _companies(profile: ApplicantProfile) -> list[str]:
    named = list(profile.policy("target_companies") or []) + list((profile.policy("employer_limits") or {}).keys())
    return list(dict.fromkeys([*map(str, named), *COMPANIES]))
