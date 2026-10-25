"""
The ship check (KAN-386): a blind read of the connector's answers against
another writer's on the same questions, by hand, never in CI. A person's
picks decide whether batch apply ships, not an AI judge.

    uv run python -m app.scripts.ship_check write <folder>     the connector's answers (costs Claude usage)
    uv run python -m app.scripts.ship_check read <folder>      the blind read; stop any time, it resumes
    uv run python -m app.scripts.ship_check summary <folder>   the picks so far, also saved as summary.md

<folder> holds one student's data, which never enters this repo:
- applications.json: {"experience": text, "skills": [str],
  "applications": [{"id", "company", "title", "posting",
  "questions": [{"name", "question", "required", "max_length"}]}],
  "chats": [[application id, ...], ...],
  "samples": [the student's writing samples, at most 3; optional]}
- other.json: the answers to read the connector's against,
  {"writer": its name, "answers": [{"application", "question", "answer"}]}

`write` runs each chat as one `claude -p` session on the user's own Claude
login: its message is the connector's prompt (app/connector/prompt.py) and
its only tools are the connector's own (app/connector/tools.py, briefs.py
and style.py, unchanged), served over stdio with the chat's applications,
in the chat's order, and the student's samples in place of the database;
save_answers runs WorkIt's own checks (KAN-380). It saves connector.json (each answer with
its chat and its place in it) and each chat's transcript in
<folder>/connector/. A chat already written is kept; delete its files to
write it again.

`read` shows two kinds of pair, mixed in one random order, each answer's
writer hidden and its side random:
- the connector against the other writer, on the same question;
- first against last: one question written by the first application of one
  chat and by the last of another, so the only difference is where in its
  chat it was written. If the last answers lose, lower
  `connector_chat_cap` (app/config.py).
"""

import argparse
import contextlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import textwrap
import uuid
from collections import Counter
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app.auto_apply import briefs, checks, pipeline
from app.config import get_settings
from app.connector import account, style, tools
from app.connector import briefs as brief_tools
from app.connector.prompt import PROMPT
from app.queries import writing
from app.schemas.applications import WrittenAnswer

BACKEND = Path(__file__).resolve().parents[2]
CONNECTOR = "connector"
# The chat's system prompt: Claude Code's own is for writing code, and a
# student's Claude app has no WorkIt-specific one.
SYSTEM = "You are Claude, an AI assistant made by Anthropic. The user has connected the WorkIt connector."


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def _save(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")


# --- write: the connector's side ---------------------------------------------


class _Session:
    """What the tools' `async with get_sessionmaker()() as db` opens: no database."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def commit(self) -> None:
        pass


@contextlib.contextmanager
def stub(folder: Path, chat: int) -> Iterator[tools.MCPServer]:
    """The connector's MCP server with chat number `chat` (from 0) of
    applications.json as its whole database: the tools' own code, with
    only the reads and writes of the database replaced. Each save goes to
    <folder>/connector/chat-<n>.json at once. No company has a brief or
    needs research, so both writers work from the same posting and facts.
    The style card a chat builds from the samples is kept for the next
    chat, as WorkIt keeps it, in <folder>/connector/style-card.txt."""
    data = _load(folder / "applications.json")
    apps = {a["id"]: a for a in data["applications"]}
    order = data["chats"][chat]
    ids = {app: uuid.uuid5(uuid.NAMESPACE_URL, f"ship-check/{app}") for app in order}
    named = {job: app for app, job in ids.items()}
    out = folder / CONNECTOR / f"chat-{chat + 1}.json"
    out.parent.mkdir(exist_ok=True)
    saved: dict[tuple[str, str], str] = {}
    samples = tuple(data.get("samples", []))
    card_file = out.parent / "style-card.txt"

    async def fetch_next_to_write(db, applicant_id, skip):
        job = next((ids[app] for app in order if ids[app] not in skip), None)
        return job and (job, apps[named[job]]["posting"])

    async def fetch_written(db, applicant_id, job_id):
        app = named[job_id]
        return [
            WrittenAnswer(name=q["name"], label=q["question"], required=q["required"],
                          max_length=q.get("max_length"), answer=saved.get((app, q["name"])))
            for q in apps[app]["questions"]
        ]

    async def get_application(db, applicant_id, job_id):
        app = apps[named[job_id]]
        return SimpleNamespace(job=SimpleNamespace(id=job_id, company=app["company"], title=app["title"]))

    async def open_application(db, applicant_id, job_id):
        if job_id not in named:
            raise pipeline.NotFound("No application for that job. Queue it first.")

    async def save_written(db, applicant_id, job_id, answers):
        app = named[job_id]
        saved.update({(app, name): text for name, text in answers.items()})
        _save(out, [
            {"application": a, "question": q, "answer": text, "chat": chat + 1, "position": order.index(a) + 1}
            for (a, q), text in saved.items()
        ])

    async def student(db):
        return SimpleNamespace(id=uuid.UUID(int=0))

    async def nothing(*args):
        return None

    async def no_brief(db, company):
        return []

    async def check_material(db, applicant_id, job_id):
        # As pipeline._check_material: the facts' texts, other employers this
        # posting and bank don't name, and the samples.
        app = apps[named[job_id]]
        sources = (data["experience"], *data["skills"], app["company"], app["title"], app["posting"])
        employers = tuple(a["company"] for a in data["applications"] if a["company"] != app["company"]
                          and not any(checks.names(source, a["company"]) for source in sources))
        return sources, employers, samples

    async def sample_texts(db, applicant_id):
        return samples

    async def style_card(db, applicant_id):
        return card_file.read_text() if card_file.exists() else None

    async def card_state(db, applicant_id):
        card = await style_card(db, applicant_id)
        return card, card is None and bool(samples)

    async def save_style_card(db, applicant_id, card):
        card_file.write_text(card)

    with contextlib.ExitStack() as patches:
        for module, name, value in [
            (pipeline, "fetch_next_to_write", fetch_next_to_write),
            (pipeline, "fetch_written", fetch_written),
            (pipeline, "get_application", get_application),
            (pipeline, "load_bank", nothing),
            (briefs, "research_task", nothing),
            (briefs, "brief_for", no_brief),
            (pipeline, "open_application", open_application),
            (pipeline, "save_written", save_written),
            (pipeline, "_check_material", check_material),
            (writing, "sample_texts", sample_texts),
            (writing, "fetch_style_card", style_card),
            (writing, "card_state", card_state),
            (writing, "save_style_card", save_style_card),
            (tools, "get_sessionmaker", lambda: _Session),
            (brief_tools, "get_sessionmaker", lambda: _Session),
            (style, "get_sessionmaker", lambda: _Session),
            (account, "current_student", student),
            (tools, "bank_context", lambda bank: (data["experience"], data["skills"])),
        ]:
            patches.enter_context(mock.patch.object(module, name, value))
        server = tools.MCPServer("WorkIt")
        tools.register(server)
        brief_tools.register(server)
        style.register(server)
        yield server


def serve(folder: Path, chat: int) -> None:
    with stub(folder, chat) as server:
        server.run()


def write(folder: Path, model: str) -> None:
    chats = _load(folder / "applications.json")["chats"]
    (folder / CONNECTOR).mkdir(exist_ok=True)
    for chat in range(len(chats)):
        answers = folder / CONNECTOR / f"chat-{chat + 1}.json"
        if answers.exists():
            print(f"Chat {chat + 1}: written already, kept.")
            continue
        print(f"Chat {chat + 1}: writing {', '.join(chats[chat])} ...", flush=True)
        events = _chat(folder, chat, model)
        result = next((e for e in reversed(events) if e.get("type") == "result"), {})
        # A refused save reads "Error executing tool save_answers: <why>"; a crash has no reason.
        broken = len(re.findall(r'Error executing tool \w+(?=["\\])', (folder / CONNECTOR / f"chat-{chat + 1}.jsonl").read_text()))
        if result.get("is_error") or result.get("subtype") != "success" or broken:
            # A tool that crashed (not a save it refused) means the chat didn't run as a student's would.
            answers.unlink(missing_ok=True)
            why = f"{broken} tool calls crashed" if broken else result.get("result") or "no result"
            sys.exit(f"Chat {chat + 1} stopped: {why}. See its .jsonl; run write again to redo it.")
        print(textwrap.indent(str(result.get("result", "")).strip(), "  "))
    merged = [a for chat in range(len(chats)) for a in _answers_of(folder / CONNECTOR / f"chat-{chat + 1}.json")]
    _save(folder / "connector.json", {"writer": CONNECTOR, "model": model, "answers": merged})
    print(f"{len(merged)} answers in {folder / 'connector.json'}")


def _answers_of(path: Path) -> list[dict]:
    return _load(path) if path.exists() else []


def _chat(folder: Path, chat: int, model: str) -> list[dict]:
    """One chat, run as a student's Claude runs the prompt: in an empty
    folder, on the user's login (never an API key), no settings or memory."""
    server = {"command": sys.executable, "args": ["-m", "app.scripts.ship_check", "serve", str(folder), str(chat)],
              "env": {"PYTHONPATH": str(BACKEND)}}
    argv = [
        "claude", "-p", "--model", model, "--system-prompt", SYSTEM,
        "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
        "--strict-mcp-config", "--mcp-config", json.dumps({"mcpServers": {"workit": server}}),
        # No built-in tools; every tool of the connector's, nothing else.
        "--tools", "", "--allowedTools", "mcp__workit", "--permission-mode", "dontAsk",
        "--output-format", "stream-json", "--verbose",
    ]
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"} | {"CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
    with tempfile.TemporaryDirectory() as empty:
        done = subprocess.run(argv, input=PROMPT, env=env, cwd=empty, capture_output=True, text=True, check=False)
    (folder / CONNECTOR / f"chat-{chat + 1}.jsonl").write_text(done.stdout + done.stderr)
    events = []
    for line in done.stdout.splitlines():
        with contextlib.suppress(json.JSONDecodeError):
            events.append(json.loads(line))
    return events


# --- read: the blind read ----------------------------------------------------


def pairs(folder: Path) -> dict[str, dict]:
    """Every pair to read, by key: its question and its two answers by writer."""
    data = _load(folder / "applications.json")
    apps = {a["id"]: a for a in data["applications"]}
    other = _load(folder / "other.json")
    theirs = {(a["application"], a["question"]): a["answer"] for a in other["answers"] if a["answer"].strip()}
    ours = _load(folder / "connector.json")["answers"]
    last = {chat: len(order) for chat, order in enumerate(data["chats"], 1)}
    found = {}

    def ask(app: str, name: str) -> dict:
        q = next(q for q in apps[app]["questions"] if q["name"] == name)
        return {"company": apps[app]["company"], "title": apps[app]["title"], "question": q["question"],
                "max_length": q.get("max_length")}

    for a in ours:
        key = (a["application"], a["question"])
        if key in theirs:
            found[f"vs/{a['application']}/{a['question']}/chat-{a['chat']}"] = ask(*key) | {
                "kind": "vs", "answers": {CONNECTOR: a["answer"], other["writer"]: theirs[key]}}
    firsts = [a for a in ours if a["position"] == 1]
    lasts = [a for a in ours if a["position"] == last[a["chat"]] > 1]
    for f in firsts:
        for la in lasts:
            if (f["application"], f["question"]) == (la["application"], la["question"]) and f["chat"] != la["chat"]:
                found[f"order/{f['application']}/{f['question']}/chat-{f['chat']}-{la['chat']}"] = ask(
                    f["application"], f["question"]) | {"kind": "order", "answers": {"first": f["answer"], "last": la["answer"]}}
    return found


def read(folder: Path, rng: random.Random | None = None, ask=input, show=print) -> None:
    rng = rng or random.SystemRandom()
    found = pairs(folder)
    path = folder / "picks.json"
    picks = _load(path) if path.exists() else {"order": [], "picks": {}}
    new = [key for key in found if key not in picks["order"]]
    rng.shuffle(new)
    picks["order"] += new
    for key in new:
        sides = list(found[key]["answers"])
        rng.shuffle(sides)
        picks.setdefault("sides", {})[key] = sides
    _save(path, picks)
    todo = [key for key in picks["order"] if key in found and key not in picks["picks"]]
    for n, key in enumerate(todo, len(picks["picks"]) + 1):
        pair, sides = found[key], picks["sides"][key]
        width = min(os.get_terminal_size().columns if sys.stdout.isatty() else 100, 100)
        show(f"\n{'=' * width}\nPair {n} of {len(picks['order'])}: {pair['company']}, {pair['title']}")
        limit = f" (at most {pair['max_length']} characters)" if pair["max_length"] else ""
        show(textwrap.fill(f"Q: {pair['question']}{limit}", width))
        for number, side in enumerate(sides, 1):
            text = pair["answers"][side]
            show(f"\n--- Answer {number} ({len(text.split())} words) ---")
            show("\n\n".join(textwrap.fill(p, width) for p in text.split("\n") if p.strip()))
        choice = ""
        while choice not in {"1", "2", "=", "q"}:
            choice = ask("\nWhich would you send? 1, 2, = (no difference), q (stop for now): ").strip().lower()
        if choice == "q":
            break
        note = ask("Why, in a few words (Enter to skip): ").strip()
        winner = "tie" if choice == "=" else sides[int(choice) - 1]
        picks["picks"][key] = {"winner": winner, "note": note, "at": datetime.now(UTC).isoformat(timespec="seconds")}
        _save(path, picks)
    show(summary(folder))


# --- summary -----------------------------------------------------------------


def summary(folder: Path) -> str:
    """The picks so far, for sign-off; also saved as <folder>/summary.md."""
    found = pairs(folder)
    path = folder / "picks.json"
    picks = (_load(path) if path.exists() else {"picks": {}})["picks"]
    other = _load(folder / "other.json")["writer"]
    data = _load(folder / "applications.json")
    tally = {kind: Counter(p["winner"] for k, p in picks.items() if k in found and found[k]["kind"] == kind)
             for kind in ("vs", "order")}
    total = {kind: sum(1 for p in found.values() if p["kind"] == kind) for kind in ("vs", "order")}
    vs, order = tally["vs"], tally["order"]
    cap = get_settings().connector_chat_cap
    lines = [
        "# Ship check (KAN-386)", "",
        (f"Read {sum(vs.values())} of {total['vs']} {CONNECTOR}-against-{other} pairs "
         f"and {sum(order.values())} of {total['order']} first-against-last pairs."), "",
        f"## The connector against {other}", "",
        f"- Connector better: {vs[CONNECTOR]}", f"- {other} better: {vs[other]}", f"- No difference: {vs['tie']}", "",
        "Verdict: " + (
            "not read yet." if not vs else
            f"the connector reads at least as well as {other}." if vs[CONNECTOR] >= vs[other] else
            f"the connector reads worse than {other}: look at the notes before batch apply ships."), "",
        "## A chat's first answers against its last", "",
        f"- First better: {order['first']}", f"- Last better: {order['last']}", f"- No difference: {order['tie']}", "",
        "Per-chat cap: " + (
            "not read yet." if not order else
            f"later answers read worse: lower connector_chat_cap (now {cap}, app/config.py), write again with "
            "shorter chats, and read again." if order["last"] > order["first"] else
            f"later answers hold up: keep connector_chat_cap at {cap}."), "",
    ]
    answered = {(a["application"], a["question"]) for a in _load(folder / "connector.json")["answers"]}
    left = [f"- {a['company']}: {q['question']}" for a in data["applications"] for q in a["questions"]
            if (a["id"], q["name"]) not in answered]
    lines += ["## Questions the connector left for the student", "", *(left or ["- None"]), ""]
    notes = [f"- {found[k]['company']}, {p['winner']} ({found[k]['kind']}): {p['note']}"
             for k, p in picks.items() if k in found and p.get("note")]
    lines += ["## Notes", "", *(notes or ["- None"]), "", "Signed off: ______________  Date: __________", ""]
    text = "\n".join(lines)
    (folder / "summary.md").write_text(text)
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    w = sub.add_parser("write", help="the connector's answers, one claude -p session per chat")
    w.add_argument("folder", type=Path)
    w.add_argument("--model", default="opus", help="the chat's model (default opus)")
    for name, text in [("read", "the blind read"), ("summary", "the picks so far")]:
        sub.add_parser(name, help=text).add_argument("folder", type=Path)
    s = sub.add_parser("serve", help="(run by write) one chat's MCP server over stdio")
    s.add_argument("folder", type=Path)
    s.add_argument("chat", type=int)
    args = parser.parse_args()
    folder = args.folder.resolve()
    if args.command == "write":
        write(folder, args.model)
    elif args.command == "read":
        read(folder)
    elif args.command == "summary":
        print(summary(folder))
    else:
        serve(folder, args.chat)


if __name__ == "__main__":
    main()
