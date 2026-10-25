"""
The checks every written answer passes before it reaches a form (KAN-380):
pure functions, no database, no model. WorkIt runs them in code on each
answer the student's Claude saves through the connector; a failing answer
is refused with its reasons, for Claude to fix, and is never filled.
Ported from Apply's writing checks (apply/src/apply/writing.py), with the
rules that were one student's own dropped.

    problems(answer, Context) -> what is wrong with it, each a sentence
                                 Claude can act on; empty when it passes

- **Machine-made words** (TELLS): words and marks readers take as AI
  writing, and cover-letter clichés.
- **Copied**: COPIED or more words in a row from the student's writing
  samples, which show their voice and are never pasted in.
- **A number not in the sources**: every number must be in the student's
  bank, the posting, or the question. A year counts like any number.
- **Another employer's name**: a company the student has another
  application at, named in this answer (a draft written for one company
  pasted into another's form). A company in the student's bank (where they
  worked) or in this posting is theirs to name.
- **A sentence over LONGEST words.**
- **A placeholder** left for the student to fill ("[insert link]").
- **Longer than the form takes**: the field's own limit, as the Fill
  engine read it from the live form (the extension's `limits`), else
  ANSWER_MAX.
- **How it was written** (GIVEAWAY): talk of the student's materials or
  what they lack, a hedge ("I should be upfront"), "as an AI", or the
  posting cited to its employer ("your posting").
- **Talk of the posting** (POSTING_TALK): "the role requires ...", which
  the employer wrote and needn't be told.
- **Time counted from today** (RELATIVE_TIME): "last summer", "recently";
  the answer is read weeks later.
- **Signposts**: "Hence", "Particularly" opening a sentence, or more than
  one signpost word (SIGNPOSTS).
- **More than NUMBERS numbers**, years aside.
- **Low-level detail** (LOW_LEVEL): bytes, protocols, versions, below what
  a recruiter follows.
- **A course credited with what the student did** (COURSE_CREDIT).


`company_specific` says which saved answers are about one company and so
never offered on another company's form (`pipeline.answer_bank`).
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass

from app.schemas.applications import ANSWER_MAX

COPIED = 5  # words in a row from a writing sample that count as copying it
LONGEST = 30  # words in one sentence a recruiter still reads in one go

# Words and marks that mark text as machine-written (Wikipedia, "Signs of AI
# writing"; Kobak et al. 2025; Reinhart et al. 2025), and cover-letter
# clichés. Same list as Apply's, which its readers checked.
TELLS = re.compile(r"""\b(?:
    delv\w* | tapestr\w* | testament | pivotal | crucial | underscor\w* | showcas\w* | foster\w* | intricat\w*
  | meticulous\w* | robust | vibrant | seamless\w* | leverag\w* | passionate | thrilled | honou?red | groundbreaking
  | cutting[- ]edge | invaluable | embark\w* | journey | realm | landscape | synerg\w* | resonat\w* | dream
  | serves\ as | stands\ as | not\ just | not\ only | align(?:s|ed)?\ with | commitment\ to | perfect\ fit
  | I\ am\ writing\ to | excited\ to\ apply | eager\ to
)\b|—|!""", re.IGNORECASE | re.VERBOSE)
PLACEHOLDER = re.compile(r"\[(?:add|insert|link|url|your|todo|tbd)[^\]]*\]|\b(?:TBD|TODO|XXX)\b", re.IGNORECASE)
NUMBERS = 2  # numbers an answer may state, years aside
# Words that say how an answer was written: the student's files and what
# they lack, a hedge, an AI, or the posting cited to its employer.
GIVEAWAY = re.compile(r"""\b(?:
    my\ (?:materials|sources|notes|experience\ bank)
  | my\ r[eé]sum[eé]\ (?:does\ not|doesn['’]t|do\ not|don['’]t|never|says\ nothing)
  | (?:your|this)\ (?:job\ )?(?:posting|listing|job\ description|job\ ad)
  | the\ (?:job\ )?(?:posting|listing|job\ description|description)\ (?:itself\ )?
      (?:says|said|lists|listed|mentions|mentioned|states|stated|notes|noted|asks|asked|describes|calls\ for|highlights)
  | I\ should\ be\ upfront | to\ be\ upfront
  | rather\ not\ (?:invent|make\ up) | (?:invent|make\ up)\ a\ reason
  | don['’]t\ (?:yet\ )?say\ why | doesn['’]t\ (?:yet\ )?say\ why
  | as\ an\ AI
)\b""", re.IGNORECASE | re.VERBOSE)
# Telling the employer what their posting asks for.
POSTING_TALK = re.compile(r"\b(?:(?:the|your|this)\ (?:job\ )?(?:posting|listing|job\ description|role|job)|\w+\ also)\ (?:also\ )?"
                          r"(?:asks?\ for|stresses|calls\ for|wants|emphasi[sz]es|requires|mentions|lists)\b", re.IGNORECASE | re.VERBOSE)
RELATIVE_TIME = re.compile(r"\b(?:(?:this|last|next|past)\s+(?:summer|fall|autumn|spring|winter|year|semester)|recently|currently\s+interning)\b",
                           re.IGNORECASE)
# Signpost words opening a sentence: one reads as the student's, more as a tic.
SIGNPOSTS = re.compile(r"(?:^|(?<=[.!?]\s))(?:Hence|Particularly|Lastly|In fact|Indeed|Essentially|As such|In terms of)\b")
HENCE = re.compile(r"\b[Hh]ence\b")  # readers flag it in most answers that use it
# Detail below what a recruiter follows; the resume has it.
LOW_LEVEL = re.compile(r"\b(?:serializ\w*|byte[- ]alignment|bytes?|binary|protobuf|udp|tcp|version\ (?:two|three|\d)|v\d)\b",
                       re.IGNORECASE | re.VERBOSE)
# A course credited with what the student did ("that class taught me where to look").
_COURSE = r"(?:course|class|(?-i:[A-Z]{2,4})\ ?\d{3})"
COURSE_CREDIT = re.compile(rf"\b{_COURSE}\b[^.]*\b(?:helped|taught|why|without|reason|knew|let\ me|prepared)\b"
                           rf"|\b(?:helped|taught|without|knew|prepared)\b[^.]*\b{_COURSE}\b", re.IGNORECASE | re.VERBOSE)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_WORD = re.compile(r"[a-z0-9']+")
# A question about the company or the role, whose answer fits only that
# company: "Why do you want to work here?", "What excites you about this role?"
ABOUT_THE_COMPANY = re.compile(
    r"\bwhy\b.*\b(?:us|here|join|work(?:ing)?\s+(?:at|for|with)|intern(?:ing)?\s+(?:at|for|with)|company|team|role|position)\b"
    r"|\b(?:this|our|the)\s+(?:company|team|role|position|opportunity|mission|product|products|values|culture)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Context:
    """What one answer is checked against.

    sources: the texts its facts may come from (the student's bank, the
    posting, the question). samples: the student's writing samples.
    employers: companies the student has other applications at.
    limit: the form field's own limit in characters, if it has one."""

    sources: tuple[str, ...] = ()
    samples: tuple[str, ...] = ()
    employers: tuple[str, ...] = ()
    limit: int | None = None


def problems(answer: str, context: Context) -> list[str]:
    """What is wrong with `answer`, each said so the writer can fix it.
    Empty when it passes every check."""
    found: list[str] = []
    limit = context.limit or ANSWER_MAX
    if len(answer) > limit:
        found.append(f"It is {len(answer)} characters; the form takes at most {limit}. Shorten it.")
    if tells := _unique(m.group() for m in TELLS.finditer(answer)):
        found.append(f"It uses words or marks that read as machine-written: {_quoted(tells)}. Say it plainly without them.")
    if taken := copied(answer, context.samples):
        found.append(f"It copies {COPIED} or more words in a row from the student's writing samples: {_quoted(taken)}. "
                     "The samples show their voice; write new sentences.")
    known = {n for source in context.sources for n in numbers(source)}
    if invented := [n for n in _unique(_NUMBER.findall(answer)) if _normal(n) not in known]:
        found.append(f"It states numbers the student's experience, the posting and the question don't hold: "
                     f"{', '.join(invented)}. Use only numbers from those, or leave the number out.")
    if wrong := [name for name in context.employers if names(answer, name)]:
        found.append(f"It names {_quoted(wrong)}, a company of another of the student's applications. "
                     "Write it for this company only.")
    for sentence in _sentences(answer):
        if (count := len(sentence.split())) > LONGEST:
            found.append(f"A sentence is {count} words (\"{' '.join(sentence.split()[:8])} ...\"); "
                         f"split it into sentences of at most {LONGEST}.")
    if holes := _unique(m.group() for m in PLACEHOLDER.finditer(answer)):
        found.append(f"It leaves placeholders to fill: {_quoted(holes)}. Leave out what only the student can give.")
    return found + _writing(answer)


def _writing(answer: str) -> list[str]:
    """What reads as machine-written beyond its words: Apply's editor checks."""
    found: list[str] = []
    if said := _unique(m.group() for m in GIVEAWAY.finditer(answer)):
        found.append(f"It says how it was written: {_quoted(said)}. Write it as if the student wrote it, with no talk "
                     "of their materials, what they lack, or the posting.")
    if talk := _unique(m.group() for m in POSTING_TALK.finditer(answer)):
        found.append(f"It tells the employer what their posting asks: {_quoted(talk)}. Show the work that meets it instead.")
    if when := _unique(m.group() for m in RELATIVE_TIME.finditer(answer)):
        found.append(f"It counts time from today: {_quoted(when)}, but the answer is read weeks later. "
                     "Date it as the student's experience does (\"in summer 2025\").")
    if HENCE.search(answer):
        found.append('It uses "Hence", which readers flag. Say "so", or drop it.')
    signposts = [m.group() for m in SIGNPOSTS.finditer(answer)]
    if len(signposts) > 1:
        found.append(f"It uses {len(signposts)} signpost words ({', '.join(signposts)}); keep at most one, "
                     "where the sentence follows from the one before.")
    if "Particularly" in signposts:
        found.append('"Particularly" opens a sentence. Say it plainly ("Specifically", or nothing).')
    stated = [n for n in _unique(_NUMBER.findall(answer)) if not re.fullmatch(r"(?:19|20)\d\d", n)]
    if len(stated) > NUMBERS:
        found.append(f"It states {len(stated)} numbers ({', '.join(stated)}); keep the {NUMBERS} that matter most "
                     "(years aside).")
    if low := _unique(m.group() for m in LOW_LEVEL.finditer(answer)):
        found.append(f"It goes below what a recruiter follows: {_quoted(low)}. Say what it does in plain words, "
                     "or drop it; the resume has the detail.")
    if credit := _unique(m.group() for m in COURSE_CREDIT.finditer(answer)):
        found.append(f"It credits a course with what the student did: {_quoted(credit)}. Name a course only as one "
                     "the student liked and why, as their experience says.")
    return found



def copied(text: str, samples: Iterable[str], n: int = COPIED) -> list[str]:
    """Runs of `n` words in a row that `text` takes from any of `samples`."""
    def runs(t: str) -> dict[str, None]:
        words = _WORD.findall(t.lower())
        return dict.fromkeys(" ".join(words[i:i + n]) for i in range(len(words) - n + 1))

    theirs = {run for sample in samples for run in runs(sample)}
    return [run for run in runs(text) if run in theirs]


def numbers(text: str) -> set[str]:
    """The numbers `text` states, each as one form: "1,200" as "1200",
    "3.80" as "3.8"."""
    return {_normal(n) for n in _NUMBER.findall(text)}


def company_specific(question: str, answer: str, company: str | None) -> bool:
    """Whether an answer fits only the company it was written for: its
    question asks about the company or the role, or the question or the
    answer names the company. Such an answer is never offered on another
    company's form."""
    if ABOUT_THE_COMPANY.search(question):
        return True
    return bool(company and company.strip()) and (names(question, company) or names(answer, company))


def names(text: str, name: str) -> bool:
    """Whether `text` names `name` as a whole word, as it is capitalized
    (a company called "Ramp" is not "ramp up")."""
    name = name.strip()
    return bool(name) and re.search(rf"(?<![\w&]){re.escape(name)}(?![\w&])", text) is not None


def _normal(number: str) -> str:
    number = number.replace(",", "")
    return number.rstrip("0").rstrip(".") if "." in number else number


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _unique(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _quoted(items: Iterable[str]) -> str:
    return ", ".join(f'"{item}"' for item in items)
