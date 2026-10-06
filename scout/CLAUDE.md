# CLAUDE.md — Scout

Scout is WorkIt's job-search assistant (KAN-138), modelled on JobRight's Orion:
a chat panel beside the job feed. This folder is its brain: a plain Python
package, `workit_scout`, that the API installs. The route that serves it is
`backend/app/routers/scout.py`, the wire format is `workit_scout/schemas.py`,
and the panel is `frontend/src/components/scout/`.

## Why it is a package of its own

So Scout's brain can be found, read and reused apart from the API — a nightly
job that emails match summaries could install it too. The price is one rule:
**this package never imports the backend** (`app.*`). It has no database, no
settings and no HTTP; the API's router reads `SCOUT_*`, authenticates, applies
the daily cap and hands Scout a model and a conversation. backend/CLAUDE.md
records this as the one exception to "nothing outside backend/ is imported".

There is no venv here: the backend installs the package, so everything runs
from `backend/`:

```
uv run pytest ../scout/tests      Scout's own tests (no network, no model)
uv run ruff check ../scout        lint
```

An edit here is picked up by the next `uv run` there — `cache-keys` in
`pyproject.toml` make uv rebuild the package. It is a copy, not an editable
install, on purpose: an editable install works through a `.pth` file in the
venv, and Python skips any `.pth` that macOS has flagged hidden, which happens
to files under `.venv` on some machines. The import then fails with no error at
install time.

| file | owns |
|---|---|
| `settings.py` | `SCOUT_*`: the model endpoints and the daily cap |
| `llm.py` | the one place `openai` is imported; fallback between endpoints |
| `prompt.py` | the frozen system prompt and the facts block after it |
| `agent.py` | one turn: prompt + conversation in, events out |
| `schemas.py` | the wire format (`ChatRequest`, `ScoutEvent`) and the facts types |
| `facts.py` | a resume's `parsed_json` and a `feed.json` row as Scout's facts; the privacy boundary |
| `quota.py` | the per-account daily cap |
| `testing.py` | `ScriptedLLM`, the fake model both test suites use |

## Scout is free for every user — that decides the design

Being free is the product's selling point, so every choice here is judged by
what one active user costs. The plan and the market research behind it live in
the KAN-138 plan; the rules that follow from it are these:

- **The model is configuration, never code.** `llm.py` is the only file that
  imports `openai`, and it talks to any OpenAI-compatible endpoint named by the
  `SCOUT_*` settings in `settings.py`. Swapping providers is an env change.
- **A daily per-account cap** (`SCOUT_DAILY_TURNS`, `quota.py`) stops one
  script from spending a free tier. It lives in memory and resets on restart,
  which errs toward letting people in.
- **Replies are short.** The prompt asks for under 80 words, one answer
  sentence and at most three bullets — "two to four sentences, or a few
  bullets" produced 150-word replies on Gemini Flash-Lite. `agent.MAX_REPLY_CHARS`
  (2400) is only the backstop for a reply that ignores it; a cap near 80 words
  would cut most replies mid-sentence. Length is enforced here, not requested
  from the provider, because providers name that parameter differently.
- **Formatting is `**bold**` and `- ` bullets, nothing else.** The panel's
  `reply-text.tsx` renders exactly those, so widen the prompt's list and that
  component together or the panel shows raw markdown again.
- **Only parsed resume fields ever reach a model** — never a name, email,
  phone, link or the raw resume text. The production model is a free tier that
  may train on prompts. `facts.py` enforces it.

## Which model, where

| Where | Model | Settings |
| --- | --- | --- |
| Laptops (default) | Qwen 3.5 4B on Ollama, $0, nothing leaves the machine | none — the defaults point at `http://localhost:11434/v1` |
| Production | Gemini Flash-Lite on its free API tier | `SCOUT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `SCOUT_MODEL`, `SCOUT_API_KEY`, `SCOUT_REASONING_EFFORT=minimal` |
| Production fallback | GPT-5 nano, about $7 a month per 1,000 active users | the same four as `SCOUT_FALLBACK_*` |

Set up a laptop with `ollama pull qwen3.5:4b` (about 3.5 GB; use
`qwen3.5:9b` on 16 GB+ machines, which is noticeably better at tool calls).
Ollama must be running, or Scout answers "offline".

`SCOUT_REASONING_EFFORT` is per endpoint because providers disagree: Ollama's
Qwen takes `none` (thinking off, so replies start at once); Gemini and GPT-5
reject `none` and want `minimal`. Never send `tool_choice` — Ollama does not
support it.

## How a failure behaves

`LLM.stream` tries the primary, and moves to the fallback only when the
primary is rate-limited (429), erroring (5xx) or unreachable **before it has
sent any text**. Once text has reached the user a retry would repeat it, so a
failure mid-reply ends the reply with an `error` event. A 4xx other than 429 is
misconfiguration — wrong key, model name or parameter — and is not retried; the
server log says which endpoint failed. Every failure reaches the panel as one
`error` event with a message written for the user, on a 200 response.

## What Scout knows, and where it comes from

Each turn the API hands `agent.run` two sets of facts, rendered by
`prompt.facts()` into a "What you know" block after the frozen system prompt:

- **The resume** — the applicant's default resume if it parsed, else their
  newest parsed one, its stored `parsed_json` mapped by `facts.resume_facts`.
  It takes JSON data, not the API's `ParsedResume`, so this package still
  never imports the backend. That mapping is the privacy boundary: skills,
  experience, education and projects cross it; names, contact details, links
  and raw text never do.
- **The job** — when the panel sends a `job_id` (an "Ask Scout" click, and every
  message after it), the feed's row for it, description included. Descriptions
  come from the scraper (`scraper/CLAUDE.md`, "Descriptions are read once").

The prompt makes that block the only truth: no claim about the user that their
resume does not state, none about the job that the posting does not state. A
missing resume or description is said in the block, not left blank, so the
model has nothing to fill in.

## Rules for changing Scout

- **Grounding.** The prompt forbids claiming anything about the user or the job
  that the facts block does not state. JobRight's most common complaint is its AI
  inventing skills; keep the rule and its test
  (`test_grounding_rules_cover_both_resume_and_posting`).
- **Keep the prompt one frozen string** (`prompt.py`). Per-request context goes
  in messages after it, so providers can cache the prefix.
- **No HTTP and no database in this folder.** The API's router authenticates,
  rate-limits and loads the facts; Scout only reads what it is handed, so tests
  can hand it anything.
- **Small models are weak at choosing tools** (Qwen 3.5 4B scores 50.3 on
  BFCL-V4, the 9B 66.1). When a task's data is known up front — "ask about this
  job" — load it into the prompt instead of making the model call a tool for it.
- **New event types** go in `workit_scout/schemas.py` and
  `frontend/src/components/scout/stream.ts` together.

## Tests

`tests/test_scout.py` runs Scout against `ScriptedLLM`: fallback on 429 and on a
dead endpoint, no fallback on misconfiguration or mid-reply, the reply cap, the
grounding rules, the facts block (resume, job, and the wording when either is
missing), the daily cap and the privacy mapping (`facts.py`). The API's
side — the route and the feed — is `backend/tests/test_scout.py`. None need a network or Ollama.
