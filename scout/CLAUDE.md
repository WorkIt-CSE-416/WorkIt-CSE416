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
settings and no HTTP; the API's router reads `SCOUT_*`, authenticates, checks
and counts the student's daily uses (`backend/app/services/usage.py`) and hands
Scout a model, the student's identity fields and a conversation. backend/CLAUDE.md
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
| `settings.py` | `SCOUT_*`: the endpoint chain |
| `llm.py` | the one place `openai` is imported; the endpoint chain, streamed and structured calls, identity-data removal on every call |
| `prompt.py` | the frozen system prompt and the facts block after it |
| `agent.py` | one turn: prompt + conversation in, events out |
| `schemas.py` | the wire format (`ChatRequest`, `ScoutEvent`) and the facts types |
| `facts.py` | the experience bank and a `feed.json` row as Scout's facts; the privacy boundary |
| `identity.py` | identity-data removal: `remove_identity`, run on all text bound for a model |
| `testing.py` | `ScriptedLLM`, the fake model both test suites use |

## Scout is free for every user — that decides the design

Being free is the product's selling point, so every choice here is judged by
what one active user costs. The plan and the market research behind it live in
the KAN-138 plan; the rules that follow from it are these:

- **The model is configuration, never code.** `llm.py` is the only file that
  imports `openai`, and it talks to any OpenAI-compatible endpoint named by the
  `SCOUT_*` settings in `settings.py`. Swapping providers is an env change.
- **Daily uses are counted in the database, not here** (KAN-210). The API's
  `app/services/usage.py` holds each feature's cap per student and share of
  the daily pool (`AI_*` env settings, `backend/CLAUDE.md`), and counts a use
  only when the call succeeds. Scout's turn counts only when it ends with no
  `error` event; its last NDJSON line is a `usage` event with the uses left.
  The old in-memory `DailyQuota` is gone: it reset on every restart and
  counted a turn before the call, so a failed turn cost the student a use.
- **Replies are short.** The prompt asks for under 80 words, one answer
  sentence and at most three bullets — "two to four sentences, or a few
  bullets" produced 150-word replies on Gemini Flash-Lite. `agent.MAX_REPLY_CHARS`
  (2400) is only the backstop for a reply that ignores it; a cap near 80 words
  would cut most replies mid-sentence. Length is enforced here, not requested
  from the provider, because providers name that parameter differently.
- **Formatting is `**bold**` and `- ` bullets, nothing else.** The panel's
  `reply-text.tsx` renders exactly those, so widen the prompt's list and that
  component together or the panel shows raw markdown again.
- **Only the experience bank's sections and skills ever reach a model as
  facts** — never a name, email, phone, link or an uploaded resume's text.
  The production model is a free tier that may train on prompts. `facts.py`
  enforces it.

## Which model, where

The model is an **endpoint chain**: `SCOUT_ENDPOINTS`, a JSON list tried in
order, each item `{"base_url", "model", "api_key"?, "reasoning_effort"?}`.
Unset, the chain is one endpoint named by `SCOUT_BASE_URL`, `SCOUT_MODEL`,
`SCOUT_API_KEY` and `SCOUT_REASONING_EFFORT`, whose defaults are a local
Ollama. `SCOUT_FALLBACK_*` and `SCOUT_DAILY_TURNS` were removed in KAN-210 and
are now ignored; a deploy that still sets them has no fallback until
`SCOUT_ENDPOINTS` is set.

| Where | Chain |
| --- | --- |
| Laptops (default) | Qwen 3.5 4B on Ollama, $0, nothing leaves the machine; nothing to set |
| Production now (spec) | Groq `openai/gpt-oss-120b` (`https://api.groq.com/openai/v1`), the Gemini free tier (`https://generativelanguage.googleapis.com/v1beta/openai/`, `gemini-3.5-flash-lite`, effort `minimal`), Groq `openai/gpt-oss-20b` (effort `low`), Cloudflare Workers AI; set as `SCOUT_ENDPOINTS` on the `workit-api` Vercel project |
| At launch (spec) | DeepInfra `gpt-oss-120b`, then Groq, with a $50 a month spend limit |

**Z.ai `GLM-4.7-Flash` is not in the chain.** It joins only after a person
checks its console limits, its terms (may it train on prompts?) and the fixed
test set. Still open. If it passes, add it as the second item of
`SCOUT_ENDPOINTS` (an OpenAI-compatible base URL, `https://api.z.ai/api/paas/v4/`
at the time of writing; confirm in its console); no code change.

Set up a laptop with `ollama pull qwen3.5:4b` (about 3.5 GB; use
`qwen3.5:9b` on 16 GB+ machines, which is noticeably better at tool calls).
Ollama must be running, or Scout answers "offline".

`reasoning_effort` is per endpoint because providers disagree: Ollama's
Qwen takes `none` (thinking off, so replies start at once); Gemini and GPT-5
reject `none` and want `minimal`. It is sent only when set. Never send
`tool_choice`: Ollama does not support it, and a test checks the request body.

## Structured output

`LLM.complete_json(messages, Schema, identity=...)` is the non-streaming call
every model feature that needs data (Intake, Tailor, model parsing, the
editor assistant) uses. It sends `response_format` with the Pydantic schema's JSON schema, not strict
(providers disagree on which schemas strict mode accepts), and checks the
reply with `Schema.model_validate_json`. A reply that fails the check raises
`InvalidReply` and is not repaired or retried down the chain: the caller
decides whether to ask again, and it does not count as a use. No text reaches
the student before it returns, so a 429, 5xx or dead endpoint moves down the
whole chain.

## How a failure behaves

`LLM.stream` tries the chain in order, and moves to the next endpoint only
when one is rate-limited (429), erroring (5xx) or unreachable **before it has
sent any text**. Once text has reached the user a retry would repeat it, so a
failure mid-reply ends the reply with an `error` event. A 4xx other than 429 is
misconfiguration — wrong key, model name or parameter — and is not retried; the
server log says which endpoint failed. Every failure reaches the panel as one
`error` event with a message written for the user, on a 200 response.

## What Scout knows, and where it comes from

Each turn the API hands `agent.run` two sets of facts, rendered by
`prompt.facts()` into a "What you know" block after the frozen system prompt:

- **The experience bank** (KAN-212) — the bank as `GET
  /applicants/{id}/bank` returns it, mapped by `facts.bank_facts` to one short
  line per entry (title, organization or school, years, original bullets,
  cut at 300 characters) in all six entry sections, plus the skills. It takes
  JSON data, not the API's classes, so this package still never imports the
  backend. That mapping is the privacy boundary: links (a project's
  included), locations and bullet variants never cross it, and there is
  **no fallback to an uploaded resume**. For an empty bank the block says so
  and says whether an upload exists (`ResumeFacts.has_upload`), so Scout can
  point at import instead of guessing. The block keeps the heading "The
  user's resume" because the frozen prompt's grounding rules name it so.
- **The job** — when the panel sends a `job_id` (an "Ask Scout" click, and every
  message after it), the feed's row for it, description included. Descriptions
  come from the scraper (`scraper/CLAUDE.md`, "A posting's own page is read once").

The prompt makes that block the only truth: no claim about the user that their
resume does not state, none about the job that the posting does not state. An
empty bank or a missing description is said in the block, not left blank, so
the model has nothing to fill in.

## Identity data never reaches a model

Identity data (`GLOSSARY.md`: name, email, phone, street address, links) is
removed by one function, `identity.remove_identity`, and only there (KAN-205).
It takes text and the profile's identity fields (`name`, `email`, `phone`,
`links`) and returns the text with `[name]`, `[email]`, `[phone]` and `[link]`
placeholders. It also catches any email, URL or phone by pattern, so a former
address or a friend's link goes too. Rules:

- **Every model call's text passes through it, inside the provider seam.**
  `LLM.stream` and `LLM.complete_json` take a required `identity=` (an
  `identity.Identity`: name, email, phone, links) and run every message,
  system prompt included, through `Identity.remove` before any endpoint sees
  it. So no feature can forget it; a caller with no profile passes
  `Identity()`, which still removes any email, URL or phone by pattern. The
  API's Scout route builds it from the applicant's profile. Never add a second
  copy of these patterns elsewhere; widen this function and its tests.
- **Placeholders are never swapped back.** The function returns only text;
  nothing keeps a map from placeholder to value. A reply that needs the
  student's name shows the placeholder or is filled by the page, not the model.
- **Model text that is saved or shown is checked for placeholders first**,
  with `identity.placeholders_in` over the one `PLACEHOLDERS` list. A model
  that saw de-identified text can echo `[link]` back, and a saved
  `[link]` replaces the student's real wording for good. Tailor, intake,
  import's model reading and the editor assistant's "Make it shorter" all
  call it; a new feature that keeps model text does too. Never copy the
  list.
- **Patterns err toward removing.** A phone is any run of 10 to 15 digits in
  groups, so years, date ranges and counts survive; a bare host counts as a
  link only with a path (`github.com/jd`), so `Node.js` and `ASP.NET` survive.
  Each part of the name is removed in any case, even when it is also a word.
- **Street address has no placeholder yet.** The spec names four placeholders
  only; an address typed into free text is not caught. Still open.

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
  `frontend/src/components/scout/stream.ts` together. Intake's extra
  `draft` line is the backend's (`app/schemas/intake.py`) and the bank
  page's (`(seeker)/bank/intake.tsx`), since its draft is the bank's entry
  schema, which this package may not import.
- **Intake reuses this package's model, not its prompt.** Its frozen prompt
  and turn live in the backend (`app/services/intake.py`), for the same
  reason. Its chat UI reuses the panel's bubble, typing dots and composer
  (`components/scout/chat.tsx`): change them with both callers in mind.

## Tests

`tests/test_scout.py` runs Scout against `ScriptedLLM`, which takes one script
per endpoint in the chain (`ScriptedLLM(rate_limited(), ["reply"])`), records
every prompt as the model received it, and joins a script's pieces as the
answer to a structured call. It covers: moving down the chain on 429, 5xx and
a dead endpoint, no move on misconfiguration or mid-reply, the structured call
(checked object, chain, rejected replies, no identity data), the request body
(a JSON schema, never `tool_choice`), the chain read from env, the reply cap,
the grounding rules, the facts block and the privacy mapping (`facts.py`).
`tests/test_identity.py` tests `remove_identity` directly: each profile field,
each pattern, and text with no identity data, which must come back unchanged.
The API's side, the route, the daily uses and the prompt sent through it, is
`backend/tests/test_scout.py` on the real-Postgres test database. None need a
network or Ollama.
