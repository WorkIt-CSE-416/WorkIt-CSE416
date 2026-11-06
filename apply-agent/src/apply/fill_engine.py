"""The Fill engine (ADR 0004): fills a form from inside its page. It lives in
the extension's submodule (autofiller_extension/fill-engine in the WorkIt
checkout, or the engine checkout that $APPLY_FILL_ENGINE names) as one built
bundle, dist/engine.js, which sets the page's global `FillEngine`; this loads
it into a Playwright page and calls it.

The bundle is run through page.evaluate rather than added as a <script> tag, so
a page's Content-Security-Policy can't block it. A page that navigates loses
it, so every call loads it again if the page no longer has it; a call a
navigation cut short (Workday's Save and Continue loads the next step) is made
again on the new page.

What needs no page runs the bundle in Node, the copy that ships inside
Playwright (call_without_page): reading a job from its link, the planner, which
plans before the form opens, and the engine's other pure functions. They run in
one Node kept for the process (see NODE_SERVER). A profile's dates reach the
engine as JS Dates, a Question comes back as the very Question passed in, and
an argument may be a HostCall, which the engine calls back into Apply (the
site's fetch, the Posting's text read only when the engine asks for it).

Every call, in the page or in Node, goes through the engine's one dispatcher,
FillEngine.call, which returns the value or the error by name.
"""

import base64
import functools
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import date
from pathlib import Path
from typing import Any

from playwright._impl._driver import compute_driver_executable
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

from apply import tracker
from apply.adapters import JobSite, SetupError
from apply.answer_bank import LISUL, AnswerBank
from apply.model import (
    Answers,
    FillError,
    Handoff,
    MoreQuestions,
    NoForm,
    Posting,
    Question,
    QuestionSet,
    Readback,
    Site,
)
from apply.profile import ApplicantProfile

# The Fill engine's checkout: the extension's submodule, so one engine pin serves both.
ENGINE_DIR = Path(os.environ.get("APPLY_FILL_ENGINE")
                  or Path(__file__).resolve().parents[3] / "autofiller_extension" / "fill-engine").expanduser()
ENGINE = ENGINE_DIR / "dist" / "engine.js"

# Calls the engine in the page through its dispatcher: {value}, or {error: {name, message}}.
CALL = "({name, args}) => FillEngine.call(name, args)"
NAVIGATED = re.compile(r"context was destroyed|navigat|FillEngine is not defined", re.IGNORECASE)
CALLS = 5  # times a call is made, each cut short by a navigation, before its error stands

# Runs engine functions in one long-lived Node: the bundle's path is an argument; each call is a
# line on stdin, {name, args, questions}, and its answer a line on stdout, {value} or {error}. Inside
# args, {"$q": i} is questions[i], {"$date": "YYYY-MM-DD"} a Date, and {"$host": name} a function that
# calls Apply back: it writes {"ask": name, "args": [...]} and reads Apply's {"answer": ...} or
# {"failed": message} (a thrown Error) before going on. The answer's Questions go back as {"$q": i}.
# Calls run in the bundle's own context (given URL, which the engine reads links with), so its Dates
# are the engine's. The process stays because the engine's first plan compiles every rule's pattern.
NODE_SERVER = """const vm = require("vm"), fs = require("fs");
const context = vm.createContext({URL});
vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), context);
let pending = Buffer.alloc(0);  // bytes read past the last line: a character may straddle two reads
function readLine() {
  const buffer = Buffer.alloc(65536);
  for (;;) {
    const end = pending.indexOf(10);
    if (end >= 0) { const line = pending.subarray(0, end).toString("utf8"); pending = pending.subarray(end + 1); return line; }
    let n;
    try { n = fs.readSync(0, buffer, 0, buffer.length, null); } catch (e) { if (e.code === "EAGAIN") continue; throw e; }
    if (n === 0) return null;
    pending = Buffer.concat([pending, buffer.subarray(0, n)]);
  }
}
const write = (value) => fs.writeSync(1, JSON.stringify(value) + "\\n");
function askHost(name, args) {
  write({ask: name, args});
  const reply = JSON.parse(readLine());
  if ("failed" in reply) throw new Error(reply.failed);
  return reply.answer;
}
const run = vm.runInContext(`(input, askHost) => {
  const call = JSON.parse(input, (k, v) => v && typeof v.$date === "string" ? new Date(v.$date + "T00:00:00Z") : v);
  const questions = call.questions;
  const swap = (v) => Array.isArray(v) ? v.map(swap)
    : v && typeof v === "object" && !(v instanceof Date)
      ? ("$q" in v ? questions[v.$q] : "$host" in v ? (...args) => askHost(v.$host, args)
        : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])))
      : v;
  return FillEngine.call(call.name, swap(call.args)).then((out) =>
    JSON.stringify(out, (k, v) => { const i = questions.indexOf(v); return i >= 0 ? {$q: i} : v; }));
}`, context);
(async () => {
  for (let line; (line = readLine()) !== null;) {
    let out;
    try { out = await run(line, askHost); } catch (e) { out = JSON.stringify({error: {name: "Crash", message: String((e && e.stack) || e)}}); }
    fs.writeSync(1, out + "\\n");
  }
})();"""
# One Node per depth of call: a host call that calls the engine again (the Posting's text, read
# when the plan asks, is made text by the engine) runs on the next Node, as the first waits on it.
_nodes: dict[int, subprocess.Popen] = {}
_node_locks: dict[int, threading.Lock] = {}  # Workers share each Node, a call at a time
_depth = threading.local()
_loaded: dict[str, object] = {}  # the bundle the Nodes run: its "stat" (mtime, size) and "sha256"


def fresh() -> bool:
    """Before a new posting is planned: if the bundle on disk is not the one the long-lived Nodes run
    (a merged engine fix, `git submodule update`), stop them, so the next call starts a Node on the new
    one. Waits for each Node's call in progress. True when it reloaded (KAN-645)."""
    try:
        stat = ENGINE.stat()
    except OSError:
        return False
    seen = (stat.st_mtime_ns, stat.st_size)
    if _loaded.get("stat") == seen:
        return False
    digest = hashlib.sha256(ENGINE.read_bytes()).hexdigest()
    changed = "sha256" in _loaded and _loaded["sha256"] != digest
    _loaded.update(stat=seen, sha256=digest)
    if changed:
        for depth in sorted(_nodes):  # in the order calls take the locks: never a deadlock
            with _node_locks.setdefault(depth, threading.Lock()):
                node = _nodes.pop(depth, None)
                if node and node.poll() is None:
                    node.kill()
                    node.wait()
    return changed


@dataclass(frozen=True)
class HostCall:
    """An argument the engine calls back into Apply: `function(*args)` answers it, in this process."""

    function: Callable[..., Any]


def call_without_page(name: str, *args: Any, questions: QuestionSet = ()) -> Any:
    """What the engine's function `name` (a dotted name: "eightfoldQuestions.brought") returns for
    `args`, run in Node, with no page. A Question in `args` must be one of `questions`; a HostCall
    is called back when the engine calls it (an error it raises reaches the engine as an Error)."""
    questions = list(questions)
    hosts: list[Callable[..., Any]] = []
    raised: list[Exception] = []  # what a host call raised, raised again if the engine passes it on

    def encode(value: Any) -> Any:
        if isinstance(value, Question):
            return {"$q": next(i for i, q in enumerate(questions) if q is value or q == value)}
        if isinstance(value, HostCall):
            hosts.append(value.function)
            return {"$host": len(hosts) - 1}
        if isinstance(value, date):
            return {"$date": value.isoformat()[:10]}
        if isinstance(value, Path):
            return {"file": str(value)}
        if is_dataclass(value):
            return asdict(value)
        if isinstance(value, (tuple, set, frozenset)):
            return list(value)
        raise TypeError(f"the Fill engine can't be passed {type(value).__name__}")

    payload = json.dumps({"name": name, "args": args, "questions": [asdict(q) for q in questions]}, default=encode)
    depth = getattr(_depth, "value", 0)
    with _node_locks.setdefault(depth, threading.Lock()):
        node = _nodes.get(depth)
        if node is None or node.poll() is not None:
            _built()
            if not _loaded:
                fresh()  # what the first Node runs
            node = _nodes[depth] = subprocess.Popen([compute_driver_executable()[0], "-e", NODE_SERVER, str(ENGINE)], stdin=subprocess.PIPE,
                                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
        node.stdin.write(payload + "\n")
        node.stdin.flush()
        while (line := node.stdout.readline()) and "ask" in (asked := json.loads(line)):
            _depth.value = depth + 1
            try:
                reply = {"answer": hosts[asked["ask"]](*asked["args"])}
            except Exception as error:
                raised.append(error)
                reply = {"failed": str(error) or type(error).__name__}
            finally:
                _depth.value = depth
            node.stdin.write(json.dumps(reply) + "\n")
            node.stdin.flush()
    if not line:
        raise RuntimeError(f"the Fill engine's Node stopped during {name}")
    answer = json.loads(line)
    if raised and answer.get("error", {}).get("message") == (str(raised[-1]) or type(raised[-1]).__name__):
        raise raised[-1]
    return _returned(_with_questions(answer, questions), name)


@dataclass
class Plan:
    """What the engine's planner decided for one Question set."""

    answers: Answers = field(default_factory=dict)
    essays: list[Question] = field(default_factory=list)  # for Claude to write
    missing: list[Question] = field(default_factory=list)  # Missing facts
    not_eligible: str = ""  # the Screener Lisul would fail, if any
    high_stakes: list[Question] = field(default_factory=list)  # the essays that hold the Application
    handoffs: list[str] = field(default_factory=list)  # what Lisul must answer himself, and why
    drafts: list[Question] = field(default_factory=list)  # one-off questions for Claude to draft
    banked: list[Question] = field(default_factory=list)  # one-off questions the Answer bank answered
    # Other wordings of an answer that state its fact too, by Question name: the page may
    # show one instead (a Workday search picks the tenant's own name for Lisul's major).
    accepted: dict[str, tuple[str, ...]] = field(default_factory=dict)
    # The questions the engine leaves blank on purpose, by name, each with why (a duplicate "Other website",
    # an "If other" follow-up to another pick, an optional fact the profile lacks): Verifying notes these.
    blanks: dict[str, str] = field(default_factory=dict)
    # Each bare date's section (From, To, Start date: a label that says nothing of what it is for), by name:
    # "education", "work experience", "availability", or "" when nothing on the form says.
    sections: dict[str, str] = field(default_factory=dict)
    # The wording the Answer bank files each bare date's answer under, by name ("education / From (MM/DD/YYYY)"):
    # None when no section is known, and its answer is then never banked.
    filed: dict[str, str | None] = field(default_factory=dict)
    # A follow-up ("If yes, ...") whose question is still to be answered (a draft, a Missing fact), by name: that
    # question's name. Neither asked nor written yet: the worker decides it once that answer is in (not_called_for).
    waiting: dict[str, str] = field(default_factory=dict)
    # Each attestation, certification or signature question, by name: its exact wording (KAN-676). Never answered,
    # by the plan, the Answer bank, Claude fill or the essay writer: Lisul ticks or signs it ("Yours to tick").
    attestations: dict[str, str] = field(default_factory=dict)


TO_TICK = "Yours to tick"  # starts each line of the Check before Submit list that names an attestation


def to_tick(wording: str) -> str:
    """The Check before Submit line for an attestation left for Lisul, with its exact wording on one line."""
    # A reason's parts are split on "; ": one inside the wording is written ", " so the line stays whole.
    return f"{TO_TICK}: {' '.join(wording.split()).replace('; ', ', ')}"


def tick_ask(wordings: list[str]) -> str:
    """The one-line ask when a required attestation stops the form on its page: Lisul ticks or signs it, then Resume."""
    named = " and ".join(f"'{' '.join(w.split())}'" for w in wordings)
    return f"Tick {named} yourself on this page, then press Resume: Apply never attests or signs for you."


# What a box or a pick shows when it is ticked or picked (KAN-676). Anything else, a placeholder ("Select..."), a
# symbol, a refusal ("No.", "Not accepted"), the box's own label or a word nobody listed, reads as not ticked.
TICKS = frozenset({"yes", "true", "on", "checked", "ticked", "selected", "agreed", "accepted", "agree", "accept", "i agree",
                   "i accept", "i certify", "certified", "i acknowledge", "acknowledged", "i confirm", "confirmed", "i attest",
                   "i certify and agree", "i agree and certify", "x", "☑", "☒", "✓", "✔", "[x]"})
REFUSES = re.compile(r"^(no|not|non|un|decline|disagree|reject|refuse|i do not|i don'?t|i decline|i disagree|prefer not|n/?a\b|none\b)"
                     r"|^(select|choose|please|pick)\b|^-+|^\W*$", re.IGNORECASE)


def _plain(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().strip(".!").strip().casefold()


def ticked(shown: object, question: Question | None = None) -> bool:
    """Whether a field read back shows a real tick or pick: an allowlist (TICKS), or one of `question`'s own options that
    is no refusal or placeholder, or for a text attestation (a typed-name signature) text other than its label. Anything
    else reads as not ticked: Apply fails closed."""
    values = [v for v in (shown if isinstance(shown, (list, tuple)) else [shown]) if _plain(v)]
    label = _plain(question.label) if question is not None else ""
    options = {_plain(o) for o in question.options} if question is not None else set()
    for value in map(_plain, values):
        if value == label or REFUSES.search(value):
            continue
        if value in TICKS or value in options:
            return True
        if question is not None and question.kind in ("text", "textarea") and not question.options and re.search(r"[a-z].*[a-z]", value):
            return True
    return False


def attestations(questions: QuestionSet) -> set[str]:
    """The names of `questions` that ask Lisul to attest, certify or sign: the engine's own pattern (asksAttestation), read
    from each label, help text and options, in the form's order (a bare "Date" beside a signature is its date)."""
    listed = list(questions)
    found = call_without_page("asksAttestation", [{"name": q.name, "label": q.label, "options": list(q.options),
                                                 "description": q.description, "kind": q.kind} for q in listed]) if listed else []
    return {q.name for q, attests in zip(listed, found) if attests}


def plan(questions: QuestionSet, posting: Posting, profile: ApplicantProfile, bank: AnswerBank | None = None,
         today: date | None = None, posting_text: Callable[[], str] = lambda: "", employer_text: str = "") -> Plan:
    """The engine's plan for `questions` (see its planner). `today` is the date the form is filled
    (the system's by default). `posting_text` reads the Posting's own text, called only when the
    engine asks for it (pay, a typed location preference), and at most once a plan. `employer_text` is what Claude would read
    beside the form (the Posting description, Company material): an AI trap in it makes the
    Application a Handoff, and an AI ban in it bans AI-written text on the form."""
    bank = bank or AnswerBank()
    entries = {question: {"answer": entry.answer, "own": entry.source == LISUL, "none": entry.none}
               for question, entry in bank.answers().items()}
    context = {"posting": posting, "today": (today or date.today()).isoformat(), "postingText": HostCall(functools.cache(posting_text)),
               "employerText": employer_text}
    result = call_without_page("plan", list(questions), _facts(profile, posting), profile.policies(), entries, context,
                               questions=questions)
    answers = {name: _answer(value) for name, value in result["answers"].items()}
    accepted = {name: tuple(wordings) for name, wordings in result["accepted"].items()}
    if posting.job_system == "workday":
        # A Workday prompt whose choices were never read (How Did You Hear About Us?) is answered with a try-list,
        # "careers site|linkedin|other": the fill searches each in turn and takes the first found, so the page
        # shows one of them, and that one shows the answer.
        # Only that plan is a try-list: another answer with a "|" (the Answer bank's, say) must show whole.
        # So is a "Details" list right after it, which the engine answers the same way.
        # The engine says which ask it (its own HOW_HEARD): Apply keeps no copy to drift from it.
        listed = list(questions)
        heard = call_without_page("asksHowHeard", [q.label for q in listed]) if listed else []
        for i, question in enumerate(listed):
            source = heard[i] or (question.label.strip().lower() == "details" and i > 0 and heard[i - 1])
            answer = answers.get(question.name)
            if isinstance(answer, str) and "|" in answer and source:
                accepted[question.name] = (*accepted.get(question.name, ()), *answer.split("|"))
    return Plan(
        answers=answers,
        essays=result["essays"], missing=result["missing"], not_eligible=result["not_eligible"],
        high_stakes=result["high_stakes"], handoffs=result["handoffs"], drafts=result["drafts"], banked=result["banked"],
        accepted=accepted, blanks=dict(result.get("blanks") or {}),
        sections=dict(result.get("sections") or {}), filed=dict(result.get("filed") or {}),
        waiting=dict(result.get("waiting") or {}), attestations=dict(result.get("attestations") or {}),
    )


def remember(profile: ApplicantProfile, posting: Posting, question: Question, answer: str) -> None:
    """Add Lisul's answer to a Missing fact to the profile: as the fact the
    question asks for, or else by the question's wording. The caller saves it."""
    change = call_without_page("remember", question, posting, _facts(profile), profile.policies(), answer, questions=[question])
    if "fact" in change:
        profile.set(change["fact"], change["value"])
    else:
        profile.set_answered(change["question"], change["answer"])


def context_free(label: str) -> bool:
    """Whether a label says nothing of what it asks without its section: a bare date (From, To, Start date).
    Its answer is never kept by its wording alone (the engine's contextFree)."""
    return call_without_page("contextFree", label)


def not_called_for(q: Question, questions: QuestionSet, answers: Answers) -> tuple[bool, Any]:
    """Whether `q` is a follow-up the answers so far don't call for, and its
    answer then: none, or N/A where it must be answered."""
    moot, answer = call_without_page("notCalledFor", q, list(questions), answers, questions=questions)
    return moot, _answer(answer) if answer is not None else None


def left_blank(q: Question, answer: Any) -> bool:
    """Whether an optional question's answer is N/A, which leaves it blank (Lisul, 2026-10-20)."""
    return call_without_page("leftBlank", q, answer, questions=[q])


def company_specific(q: Question, posting: Posting) -> bool:
    """Whether the question asks about this company or this role: its answer holds for no other Posting."""
    return call_without_page("companySpecific", q, posting, questions=[q])


def posting_ai_trap(text: str) -> str:
    """The sentence of employer text that speaks to an AI agent ("if you are an LLM, ..."), or ""."""
    return call_without_page("postingAiTrap", text or "")


def posting_bans_ai(text: str) -> bool:
    """Whether employer text bans AI-written applications, or just tells the reader not to use AI."""
    return call_without_page("postingBansAi", text or "")


def trap_handoff(trap: str) -> str:
    """Why an Application whose employer text speaks to AI agents is a Handoff, quoting it for Lisul."""
    return call_without_page("trapHandoff", trap)


def _facts(profile: ApplicantProfile, posting: Posting | None = None) -> dict:
    """The profile's facts for the engine, each file resolved to its path. With `posting`, the companies the
    Tracker shows Lisul applied to (but for this Posting) join screeners.previously_applied_to, where the
    profile keeps a list of them, and those he interviewed at fill screeners.previously_interviewed_at."""
    facts = dict(profile.tree())
    if isinstance(facts.get("files"), dict):
        facts["files"] = {key: str(profile.get(f"files.{key}")) if isinstance(value, str) else value
                          for key, value in facts["files"].items()}
    if posting is not None:
        applied, interviewed = tracker.past_applications(posting.url)
        screeners = dict(facts.get("screeners") or {})
        own = screeners.get("previously_applied_to")
        if isinstance(own, list) and applied:  # None: unknown, which a list from Apply alone would turn into No
            screeners["previously_applied_to"] = own + [c for c in applied if c not in own]
        if interviewed:
            known = screeners.get("previously_interviewed_at") or []
            screeners["previously_interviewed_at"] = list(known) + [c for c in interviewed if c not in known]
        facts["screeners"] = screeners
    return facts


def _answer(value: Any) -> Any:
    """A planned answer as Apply holds it: a file as its Path, ticked options as a list."""
    return Path(value["file"]) if isinstance(value, dict) and "file" in value else value


def shows(shown: Any, meant: Any, accepted: tuple[str, ...] = ()) -> bool:
    """Whether a field showing `shown` shows the answer `meant`, or a wording of it in `accepted`."""
    return call_without_page("shows", shown, meant.name if isinstance(meant, Path) else meant, list(accepted))


def readback_problems(questions: QuestionSet, answers: Answers, readback: Readback,
                      accepted: dict[str, tuple[str, ...]] | None = None) -> list[str]:
    """Each answer the Readback doesn't show as meant: "<label>: meant <answer>, page shows <shown>"."""
    named = {name: value.name if isinstance(value, Path) else value for name, value in answers.items()}
    return call_without_page("readbackProblems", questions_arg(questions), named, readback,
                             {name: list(wordings) for name, wordings in (accepted or {}).items()})


def _with_questions(value: Any, questions: list[Question]) -> Any:
    """`value` with each {"$q": i} the engine gave back as questions[i]."""
    if isinstance(value, dict):
        return questions[value["$q"]] if set(value) == {"$q"} else {k: _with_questions(v, questions) for k, v in value.items()}
    return [_with_questions(v, questions) for v in value] if isinstance(value, list) else value


def job_of(url: str) -> dict | None:
    """The job system and job a link belongs to, where the engine covers it: `site`, its ids there
    (Greenhouse's board and job, Workday's tenant...), `form`, its form's link, and `onForm`."""
    return call_without_page("jobOf", url)


def _fetch(site: JobSite) -> HostCall:
    """The site's plain fetch, as the engine asks it: a GET, or a JSON POST that only reads."""
    return HostCall(lambda url, init=None: site.fetch(url, init["body"].encode() if init else None).decode("utf-8", "replace"))


def fetched_question_set(url: str, site: JobSite) -> QuestionSet:
    """The Question set of the job at `url`, read from what its job system serves (not Eightfold's or
    Workday's, which only the open form shows). A failed fetch raises the site's own error."""
    return question_set(call_without_page("questionSet", url, _fetch(site)))


def job_names(url: str, site: JobSite) -> tuple[str, str]:
    """The company and role the job system names for the job at `url`."""
    names = call_without_page("jobNames", url, _fetch(site))
    return names["company"], names["title"]


def job_description(url: str, site: JobSite) -> str:
    """The Posting's own text, as HTML, read from its job system: "" for a job system the engine doesn't cover."""
    return call_without_page("jobDescription", url, _fetch(site))


def company_about(url: str, site: JobSite) -> str:
    """The company's own page, as HTML, where its job system names one; else ""."""
    return call_without_page("companyAbout", url, _fetch(site))


def text_of(page: str) -> str:
    """A page's readable text: no scripts, styles or tags, entities decoded, a line per block, and no
    angle brackets left, so it can't close the block of a prompt it sits in."""
    return call_without_page("textOf", page)


def parse_questions(site: Site, source: str) -> QuestionSet:
    """The Question set in `source`, the form as fetched from the job system (Lever: its /apply page's HTML;
    Greenhouse: its Job Board API's JSON; Ashby: its ApiJobPosting query's JSON;
    Rippling: its job API's JSON; Workable: its form API's JSON;
    Eightfold: its questions API's JSON)."""
    return question_set(call_without_page("parseQuestions", site, source))


def fill(page: Page, site: Site, questions: QuestionSet, answers: Answers, options: dict | None = None) -> Readback:
    """Fill `answers` into the form on `page` and return what each answered
    field shows. A file answer is sent as its bytes. A field the engine can't fill is a FillError.
    `options` are the engine's (an upload's wait in ms, as `uploadWait`). A form that shows more
    questions as it is answered (Eightfold) stops there: MoreQuestions, with them."""
    filled = call(page, "fill", site, questions_arg(questions), answers_arg(answers), options or {})
    if "moreQuestions" in filled:
        raise MoreQuestions(question_set(filled["moreQuestions"]))
    return filled


def read_questions(page: Page, site: Site) -> QuestionSet:
    """The Question set as the form on `page` shows it."""
    return question_set(call(page, "readQuestions", site))


def unasked(page: Page, site: Site, questions: QuestionSet) -> list[str]:
    """The labels of the required fields on the form on `page` that `questions` lacks."""
    return call(page, "unasked", site, questions_arg(questions))


def forget_drafts(page: Page, site: Site) -> None:
    """Have the engine forget the unsent answers the job system keeps in the browser (Workable); reload after."""
    call(page, "forgetDrafts", site)


def call(page: Page, name: str, *args):
    """`FillEngine[name](*args)` in the page, and what it returns. The engine's
    NoForm, Handoff and FillError raise Apply's own."""
    for attempt in range(CALLS):
        try:
            if hasattr(page, "engine_call"):  # a plain Worker's page (apply.plain.page): the extension's own engine.call
                answer = page.engine_call(name, list(args))
            else:
                load(page)
                answer = page.evaluate(CALL, {"name": name, "args": list(args)})
            break
        except PlaywrightError as error:
            if attempt + 1 == CALLS or not NAVIGATED.search(str(error)):
                raise
            page.wait_for_load_state()
    return _returned(answer, name)


def _returned(answer: dict, name: str) -> Any:
    """The value of an engine call's answer, or its error raised as Apply's own: NoForm, Handoff and
    FillError by name; any other is the engine failing."""
    if "value" in answer:
        return answer.get("value")
    error = answer["error"]
    if error["name"] == "NoForm":
        raise NoForm(error["message"])
    if error["name"] == "Handoff":
        raise Handoff(error["message"])
    if error["name"] == "FillError":
        raise FillError(error["message"])
    raise RuntimeError(f"the Fill engine's {name} failed: {error['name']}: {error['message'][-2000:]}")


def load(page: Page) -> None:
    """Put the engine in the page, unless it is there already."""
    if hasattr(page, "load_engine"):  # a plain Worker's page: the extension loads the same bundle as a file
        page.load_engine()
        return
    if not page.evaluate("() => typeof FillEngine !== 'undefined'"):
        _built()
        page.evaluate(ENGINE.read_text())


class EngineMissing(FillError, SetupError):
    """No engine bundle at ENGINE: the checkout's setup, not a fill bug."""


def _built() -> None:
    if not ENGINE.exists():
        raise EngineMissing(f"the Fill engine isn't built at {ENGINE}: run `git submodule update --init`")


def questions_arg(questions: QuestionSet) -> list[dict]:
    """Questions as the engine takes them."""
    return [asdict(q) for q in questions]


def answers_arg(answers: Answers) -> dict:
    """Answers as the engine takes them: a file as its name, type and bytes."""
    return {name: _file(value) if isinstance(value, Path) else value for name, value in answers.items()}


def question_set(questions: list[dict]) -> QuestionSet:
    """Questions as the engine gives them, with the form's help text, character
    limit and section heading when the engine reads them."""
    return [Question(q["name"], q["label"], q["kind"], q["required"], tuple(q["options"]),
                     q.get("description") or "", q.get("maxLength") or q.get("max_length"), q.get("section") or "")
            for q in questions]


def _file(path: Path) -> dict:
    return {
        "file": path.name,
        "type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        "base64": base64.b64encode(path.read_bytes()).decode(),
    }
