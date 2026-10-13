# LLM model and host survey

Research for KAN-197. All sources were read on 2026-10-13 unless a line says
otherwise. Prices, free tiers and terms change often. Check a number again
before you rely on it. "Unverified" means no primary page confirmed it.

This note extends `docs/research/free-model-providers-and-storage-limits.md`
(KAN-196, branch `research/KAN-196-gemini-quotas`). That note covers the free
tiers of Groq, Cloudflare, Gemini, Mistral, OpenRouter, Cerebras, Cohere,
NVIDIA, SambaNova and GitHub Models. This note does not repeat it.

## The question

Which model and API host is the cheapest option that is still good for
WorkIt's four tasks?

1. **Scout.** One chat turn: about 3,000 tokens in, 300 out. Tool use is
   optional.
2. **Intake.** A chat that drafts one resume entry as JSON: about 2,500
   tokens a turn.
3. **Tailor.** Rewrite or choose resume bullets for a job posting without
   inventing facts, and extract up to 20 keywords. Strict JSON schema. About
   6,000 in, 1,500 out.
4. **Parse.** Turn an uploaded resume's text into JSON. About 2,000 in,
   1,500 out.

**Hard rules.** An OpenAI-compatible `/chat/completions` endpoint (Scout's
`llm.py` speaks only that), with JSON-schema output. Data must not go to a
Chinese first-party API. Training on de-identified prompts is acceptable; no
training is a mild preference.

**Usage model.** 100 active students a day. Each one makes 10 Scout turns and
2 Tailor runs. That is about 4.2M input and 0.6M output tokens a day.

**Monthly cost formula** (30 days, list price, no cache):
`30 × (4.2 × input price + 0.6 × output price)`.

## Answer in short

- **Model origin and API host are separate questions.** A Chinese
  open-weight model (Qwen, GLM, Kimi, MiniMax, DeepSeek) on a US host keeps
  data with that US host. Only the first-party Chinese APIs raise the
  data-location issue.
- **Cheapest good option: `gpt-oss-120b` on DeepInfra.** $0.037 in / $0.17
  out per 1M. About **$8 a month** at the usage model. Strict JSON schema and
  tool calling. No training, nothing stored on disk. No free tier.
- **Recommended pair.**
  - **Today ($0):** primary Groq `gpt-oss-120b` (free tier), fallback
    Cloudflare Workers AI `gpt-oss-120b` (free allocation). This is the
    KAN-196 recommendation. It does **not** cover the usage model. Groq's
    free tier allows 200,000 tokens a day per model; the usage model needs
    about 4.8M. That is roughly 4% of the load, or about 4 active students a
    day. Cloudflare adds about 190 calls a day. Use the free pair while the
    team tests, not at 100 students a day.
  - **When the team pays:** primary DeepInfra `gpt-oss-120b` (about $8 a
    month), fallback Groq `gpt-oss-120b`. The fallback's free tier covers
    short outages; on a paid plan it costs $30 a month if all traffic went
    there. Both sides run the same model, so prompts behave the same after
    a failover.
- **Quality step-up if Tailor is not good enough:** `GLM-5.3-Flash` on
  Together AI ($0.15 / $0.50, about $28 a month). Artificial Analysis gives
  it an Intelligence Index of 42, against 12 for `gpt-oss-120b`.
- **Second-cheapest closed model: OpenAI `gpt-5-nano`** ($0.05 / $0.40,
  cached input $0.005, about $13.50 a month). Strict structured outputs on
  Chat Completions. Quality is close to `gpt-oss-120b`.
- **Not usable as-is:** Claude Haiku 5.5 (OpenAI-compatible layer ignores
  `response_format`), Amazon Nova (no Chat Completions on Bedrock), xAI (too
  expensive), DeepSeek's own API (data in mainland China).
- **Gemini 3.5 Flash-Lite**, the current choice, costs about **$83 a
  month** at the usage model: ten times DeepInfra `gpt-oss-120b`.
- **Embeddings:** keep `gemini-embedding-001` for now. It shuts down on
  2028-05-14. The cheapest 768-dimension switch is EmbeddingGemma-300m on
  DeepInfra ($0.002 per 1M). Any switch means re-embedding every job and
  profile.

## 1. Ranked shortlist

Ranked by "cheapest that is good enough" for small structured tasks. The
quality column uses Artificial Analysis (AA) Intelligence Index v4.3.2 (II)
and AA's IFBench (instruction following). See section 4 for the details and
caveats.

Monthly cost is at the usage model, at list price, with no cache. Reasoning
models (gpt-oss, gpt-5-nano, GLM, DeepSeek) also bill hidden reasoning tokens
as output. Set reasoning effort to `low` and measure the real output count.
This note did not measure it.

| # | Model | Host | $/1M in / out (cached in) | $/month | Free tier | Data terms (one line) | Quality evidence | JSON schema / tools |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `gpt-oss-120b` | DeepInfra | 0.037 / 0.17 (no cache rate) | **7.72** | None | No training; not stored on disk; no content logs; US company, region not stated; no age rule found | II 12 (high), IFBench 69.0, tau2 65.8 | Strict schema / yes |
| 2 | `gpt-oss-20b` | DeepInfra | 0.03 / 0.14 | 6.30 | None | Same as #1 | II 9, IFBench 65.1, tau2 60.2 | Strict schema / yes |
| 3 | `gpt-5-nano` | OpenAI | 0.05 / 0.40 (0.005) | 13.50 | "Free" usage tier, no credits | No training by default; abuse logs up to 30 days; ZDR on approval; US residency on approval; 13+ with parent consent | II 13* (high), IFBench 67.6, tau2 36.5, BFCL V4 FC 51.45 | Strict schema / yes |
| 4 | `gpt-oss-120b` | Groq | 0.15 / 0.60 (cache 50% off, from OpenRouter) | 29.70 | 30 RPM, 1,000 RPD, 8K TPM, 200K TPD | No training (contract); no retention by default, ZDR toggle; US storage; account holder 18+ | As #1 | Strict schema, but **not with tools or streaming in the same call** / yes |
| 5 | `gpt-oss-120b` | Amazon Bedrock (us-east-1) | 0.15 / 0.60; Flex 0.075 / 0.30 | 29.70; Flex 14.85 | None | No storage with retention mode `none`; model makers see nothing; US region | As #1 | Schema via grammar (no min/max, no recursion) / strict tools |
| 6 | `GLM-4.7-Flash` (Zhipu weights) | Amazon Bedrock | 0.07 / 0.40; Flex 0.035 / 0.20 | 16.02 | None | As #5 | II 15*, IFBench 60.8, tau2 98.8 | Schema (check model card) / unverified |
| 7 | `gpt-oss-120b` | Cloudflare Workers AI | Neurons (see KAN-196) | — | 10,000 Neurons a day (about 190 calls) | No training; US/EEA; no age rule | As #1 | Best-effort schema, not guaranteed / yes |
| 8 | `DeepSeek-V4-Flash` (DeepSeek weights) | Together AI | 0.14 / 0.28 | 22.68 | None ($15 minimum purchase) | No training unless opt-in; ZDR setting; 13+; region not stated | II 25 (V4.1 Flash, non-reasoning) | Schema / yes |
| 9 | `GLM-5.3-Flash` (Zhipu weights) | Together AI | 0.15 / 0.50 | 27.90 | As #8 | As #8 | **II 42**; no IFBench yet (newer than AA's IFBench runs) | Schema / yes |
| 10 | `gemini-2.5-flash-lite` | Gemini API (paid) | 0.10 / 0.40 (0.01) | 19.80 | Yes, but trains on prompts | Paid: no training, short abuse logging; 18+ and app must not be "likely accessed by" minors | II 7*, IFBench 31.5, BFCL V4 FC 36.87 | Schema (beta compat layer) / yes |
| 11 | `gemini-3.5-flash-lite` (current) | Gemini API (paid) | 0.30 / 2.50 (0.03) | 82.80 | Yes, but trains on prompts | As #10 | II 22; no IFBench yet | Schema / yes |

`*` means AA marks the index value as estimated.

Other prices checked, not shortlisted (monthly cost at the usage model):

- **Mistral** (paid, EU by default, US endpoint exists): `ministral-3b-2512`
  0.10 / 0.10 ($14.40), `ministral-8b-2512` 0.15 / 0.15 ($21.60),
  `mistral-small-2603` (Small 4) 0.15 / 0.60 ($29.70). Small 4 scores II 11,
  IFBench 48.2: weaker than `gpt-oss-120b` at four times the price. The
  Ministral in/out split is inferred from two unlabelled prices.
- **Novita** `gpt-oss-120b` 0.05 / 0.25 ($10.80). Cheap, but the terms name
  no legal entity and no processing region. 18+.
- **Vertex AI** `gpt-oss-120b` 0.09 / 0.36 ($17.82). Price unverified (the
  pricing page did not render). Processing in the `us` multi-region.
- **Baseten** `gpt-oss-120b` 0.10 / 0.50 ($21.60). Data terms not read.
- **Azure AI Foundry** `gpt-oss-120b` US Data Zone 0.165 / 0.66 ($32.67).
- **Fireworks** `gpt-oss-120b` 0.15 / 0.60 (cached 0.015). Default SKUs may
  not be US-pinned; "(US)" SKUs cost 1.5x. Unverified.
- **DeepInfra** other models: Qwen3-235B-A22B-2507 0.09 / 0.55 ($21.24),
  Gemma-4-26B-A4B 0.07 / 0.34 ($14.94), Llama-3.3-70B Turbo 0.10 / 0.32
  ($18.36), Qwen3.5-9B 0.10 / 0.15 ($15.30). None beats `gpt-oss-120b` on
  both price and IFBench.
- **OpenAI** `gpt-5.6-luna` (nano tier) 0.20 / 1.20 ($46.80);
  `gpt-5.4-nano` 0.20 / 1.25 ($47.70).
- **Claude Haiku 5.5** 0.10 / 0.50 ($21.60). Strong (II 29 at `low` effort).
  But the OpenAI SDK layer ignores `response_format` and `strict`, and
  Anthropic calls that layer "not considered a long-term or
  production-ready solution". Strict schema works only on the native API.
  Using it means a second client in `llm.py`.
- **Amazon Nova Micro** 0.035 / 0.14 ($6.93). Cheapest of all, but no Nova
  model supports Chat Completions on Bedrock, and II is 6*, IFBench 29.4.
- **xAI** cheapest text model `grok-build-0.1` 1.00 / 2.00 ($162). A coding
  model; no current "fast" chat model.
- **Cerebras** `gpt-oss-120b` 0.35 / 0.75 ($57.60). Paid tier only for
  production.
- **Kimi K2.5** on Bedrock 0.60 / 3.00 ($129.60). **MiniMax M2.5** on Bedrock
  0.30 / 1.20 ($59.40). Good tool use (tau2 95.3 for M2.5) but too expensive
  for these tasks.
- **OpenRouter** passes through host prices with no markup (5.5% fee on
  credit purchases). Some `gpt-oss-120b` hosts list $0.03 / $0.15. Its pool
  includes SiliconFlow (Chinese) and small hosts of unknown location. If used,
  pin the provider list and deny data collection.

### Cached input

Scout's system prompt and facts repeat on every turn, so a cache discount
helps Scout most.

- OpenAI `gpt-5-nano`: cached input $0.005 (90% off).
- Gemini: cached input is 10% of the input price.
- Groq: cached tokens cost 50% less (OpenRouter's data, unverified on
  Groq's page) and do not count toward rate limits (KAN-196).
- Fireworks `gpt-oss-120b`: $0.015 cached.
- DeepInfra and Bedrock: no cache price listed for `gpt-oss`.

At DeepInfra's price, input is only about $4.70 of the $7.72 a month, so the
lack of a cache discount costs little.

## 2. Hosts and their data terms

One line per host. Sources are in section 6.

| Host | Trains on API data | Retention | Data location | Age rule | Production on free tier |
| --- | --- | --- | --- | --- | --- |
| DeepInfra | No | In memory only; no content logs | Not stated (Delaware company, Palo Alto) | None found | No free tier |
| Groq | No (contract) | None by default; up to 30 days for abuse; ZDR toggle | US (GCP) | Account holder 18+ | Yes, end users allowed |
| Cloudflare Workers AI | No | Not stated | Primarily US and EEA | None | Yes (not Beta models) |
| Amazon Bedrock | No (model makers have no access) | Not stored with retention `none` | Chosen AWS region (US) | Not checked | No free token tier |
| OpenAI | No by default | Abuse logs up to 30 days; ZDR on approval | US; residency endpoint on approval | 13+, parent consent under 18 | Free usage tier exists |
| Gemini API, paid | No | Logged "for a limited period" for abuse | Not stated | 18+; app must not be likely used by minors | Free tier trains, human review |
| Together AI | No unless opt-in | ZDR setting | Not stated | 13+ | No free tier |
| Fireworks | Not stated | No prompt logs for open models without opt-in | Not stated | Not checked | No free credits |
| Novita | No by default; ZDR | ZDR | Not stated | 18+ | "Free to start" |
| Anthropic | No | Deleted within 30 days | US routing at 1.1x | None in commercial terms | No free tier |
| Mistral (paid) | No, with opt-out settings | ZDR on paid plans | EU by default; US endpoint | Parent consent for minors; no under-13 data | Free mode trains by default |

### Chinese first-party APIs (price reference only)

These are listed for price only. Each one sends data to the company that
made the model, under the terms below.

| Provider | Cheapest useful model | $/1M in / cached / out | $/month | Data location and law | Trains on API data |
| --- | --- | --- | --- | --- | --- |
| DeepSeek | `deepseek-flash` (V4.1 Flash) | 0.30 / 0.006 / 1.20 (half price off-peak) | 59.40 | **Mainland China, PRC law.** Already ruled out. | Privacy policy allows it; opt-out by email |
| Moonshot (Kimi) | `kimi-k2.6` | 0.95 / 0.16 / 4.00 | 191.70 | Singapore company and servers; Singapore law | Conflicting: help page says no, terms allow it |
| Zhipu (Z.ai, international) | `GLM-4.7-Flash` | **Free** (limits not stated) | 0 | Mostly Singapore; Singapore law | Terms say no unless opt-in (clause shown in brackets) |
| Zhipu (Z.ai) | `GLM-4.7-FlashX` | 0.07 / 0.01 / 0.40 | 16.02 | As above | As above |
| Alibaba Model Studio (Singapore) | `qwen-flash` | 0.05 / – / 0.40 | 13.50 | Singapore region | No |
| MiniMax | `MiniMax-M3` | 0.30 / 0.06 / 1.20 | 59.40 | **US data center**; Singapore company and law | No general statement |

Notes:

- Only DeepSeek stores data in mainland China. Moonshot, Z.ai and Alibaba
  International say Singapore. MiniMax says the US.
- The same open weights run on US hosts: GLM-4.7-Flash on Bedrock and
  Novita, GLM-5.3-Flash on Together and Fireworks, DeepSeek V4 Flash on
  Together, Baseten and Azure, Kimi and MiniMax on Bedrock.
- JSON support is weaker on first-party APIs. DeepSeek and Z.ai give only
  `json_object`. Alibaba's `json_schema` is "not supported yet" in the
  Singapore region. MiniMax documents `response_format` only for an older
  model.

## 3. Per-task recommendation

The cheapest model that is good enough, judged on AA's IFBench and tau2 and
on the task's shape. These are judgments, not test results. Run an eval on
real WorkIt inputs before you commit.

| Task | Recommended | Why | Step up if it falls short |
| --- | --- | --- | --- |
| Scout (chat, optional tools) | `gpt-oss-120b`, effort `low` | IFBench 69.0, tau2 65.8 (high). Short output. | `GLM-5.3-Flash` on Together |
| Intake (one entry as JSON) | `gpt-oss-120b`, effort `low` | Strict schema; short. `gpt-oss-20b` would save about $1 a month only. | `gpt-5-nano` |
| Tailor (no invented facts, 20 keywords) | `gpt-oss-120b`, effort `medium` | The hardest task: faithfulness matters more than cost. Strict schema guards the shape, not the facts. | `GLM-5.3-Flash` on Together, or `DeepSeek-V4-Flash` on Together |
| Parse (resume text to JSON) | `gpt-oss-20b` or `gpt-oss-120b` | Extraction with a strict schema. `gpt-oss-20b` scores IFBench 65.1. | `gpt-oss-120b` |

One model for all four keeps one prompt style and one fallback. The price gap
between `gpt-oss-20b` and `gpt-oss-120b` on DeepInfra is about $1.40 a month
at the usage model, so use `gpt-oss-120b` everywhere unless volume grows
a lot.

Two gotchas for `llm.py`:

- **Groq:** strict `json_schema` cannot run with tools or streaming in the
  same request. A Scout turn that uses tools must not also ask for a strict
  schema on Groq.
- **Fireworks:** `json_schema` turns off reasoning output. **Cerebras**
  advises against tools and `response_format` together.

## 4. Quality evidence

All AA numbers are from `https://artificialanalysis.ai/models/<slug>`, read
on 2026-10-13. AA Intelligence Index **v4.3.2** (10 evaluations). This
version's scale is much lower than older ones (`gpt-oss-120b` high scores
12), so do not compare these numbers with ones quoted from older versions.
IFBench (instruction following) and tau2-Bench Telecom (tool use) are no
longer part of the index. AA has no IFBench or tau2 scores for models
released from about July 2026. BFCL is the Berkeley Function Calling
Leaderboard V4 overall score (last updated 2026-04-12); it lists no gpt-oss,
GLM-4.7+, MiniMax or 2026 models.

| Model | AA II | IFBench | tau2 Telecom | BFCL V4 | Vendor-reported |
| --- | --- | --- | --- | --- | --- |
| gpt-oss-120b (high / low) | 12 / 10* | 69.0 / 58.3 | 65.8 / 45.0 | — | Tau-Bench Retail 49.4 (low) to 67.8 (high) |
| gpt-oss-20b (high / low) | 9 / 10* | 65.1 / 57.8 | 60.2 / 50.3 | — | Tau-Bench Retail 35.0 to 54.8 |
| GPT-5 nano (high / medium) | 13* / 12* | 67.6 / 65.9 | 36.5 / 30.4 | FC 51.45 | — |
| Gemini 2.5 Flash-Lite (non-reasoning) | 7* | 31.5 | 19.0 | FC 36.87 | — |
| Gemini 3.5 Flash-Lite | 22 | none yet | none yet | — | — |
| Claude Haiku 5.5 (low / high) | 29 / 38 | none yet | none yet | — | — |
| Mistral Small 4 (reasoning) | 11 | 48.2 | 41.2 | — | — |
| Nova Micro | 6* | 29.4 | 14.0 | FC 22.29 | — |
| GLM-4.7-Flash | 15* | 60.8 | 98.8 | — | — |
| GLM-5.3-Flash | 42 | none yet | none yet | — | — |
| DeepSeek V4.1 Flash (non-reasoning) | 25 | none yet | none yet | — | — |
| DeepSeek V3.2 (non-reasoning) | 16* | 49.0 | 78.9 | — | — |
| Qwen3 235B A22B 2507 Instruct | 12* | 46.1 | 33.3 | FC 47.99 | IFEval 88.7, BFCL-v3 70.9 |
| Qwen3 30B A3B 2507 Instruct | 8* | 33.1 | 10.2 | FC 41.39 | IFEval 84.7, BFCL-v3 65.1 |
| MiniMax M2.5 | 23* | 71.6 | 95.3 | — | — |
| Kimi K2.6 | 27 | 76.0 | 95.9 | — | — |
| Gemma 4 26B A4B (reasoning) | 17* | 72.4 | 43.6 | — | — |
| Llama 3.3 70B | 8* | 47.1 | 26.6 | FC 31.90 | IFEval 92.1 |

`*` means AA marks the value as estimated; AA does not say what that means.
Vendor numbers come from the vendors' own model cards and are not
independent. Vendor BFCL-v3 numbers do not compare with BFCL V4.

What the table says for WorkIt:

- `gpt-oss-120b` and `gpt-5-nano` are close on instruction following
  (IFBench 69.0 and 67.6). `gpt-oss-120b` is better at tool use (tau2 65.8
  against 36.5).
- Gemini 2.5 Flash-Lite is cheap but weak on instruction following (31.5).
- The 2026 "flash" models from Chinese labs (GLM-5.3-Flash, DeepSeek V4.1
  Flash) score far higher on the index for a few cents more. They have no
  IFBench score yet, so their instruction following is unverified.

## 5. Embeddings

`gemini-embedding-001` at 768 dimensions embeds the jobs today. Every switch
means re-embedding all job postings and profiles: query and document vectors
must come from the same model. The 768 pgvector column can stay for any
model that outputs 768.

| Model | Host | Dims (768?) | Max input tokens | $/1M tokens | Free tier | Data terms |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-embedding-001` (current) | Gemini API | 128–3,072; 768 yes | 2,048 | No longer on the pricing page (unverified) | Free tier status not on pricing page | Free tier trains; paid does not |
| `gemini-embedding-2` | Gemini API | 128–3,072; 768 yes | 8,192 | 0.20; batch 0.10 | Free | As above |
| `text-embedding-3-small` | OpenAI | 1,536; 768 via `dimensions` | 8,192 | 0.02 | None | No training by default; 30-day abuse logs |
| `embeddinggemma-300m` | DeepInfra | 768 native | 2,048 | **0.002** | None | No training, not stored |
| `Qwen3-Embedding-0.6B` / `-8B` | DeepInfra | 1,024 / 4,096; 768 via MRL (8B range confirmed) | 32K | 0.01 / 0.01 | None | As above |
| `bge-base-en-v1.5` | DeepInfra | 768 | 512 | 0.005 | None | As above |
| `bge-base-en-v1.5` | Cloudflare Workers AI | 768 | 512 | 0.067 | 10,000 Neurons a day | No training |
| `qwen3-embedding-0.6b` | Cloudflare Workers AI | Not stated | 8,192 | about 0.012 | As above | As above |
| `Qwen3-Embedding-8B` | Fireworks | 768 via `dimensions` | 40K | 0.10 (limited time) | None | No retention for open models |
| `embed-v5.0-fast` | Cohere | 256–2,048; 768 yes (native API only) | 128K | 0.08 | Trial, no production | Production keys train unless opted out |

Not 768: Voyage `voyage-4-lite` (1,024; also trains unless opted out),
Amazon Titan V2 (1,024/512/256), `mistral-embed` (1,024), Jina v5 text small
(powers of two). Together AI has no serverless embedding models now.

Recommendation:

- **Keep `gemini-embedding-001` for now.** Job postings are public text, so
  the free tier's training terms matter little for them. The model shuts
  down on **2028-05-14**; Google names `gemini-embedding-2` as the
  replacement.
- **Do not send a student's own text to the free tier.** Use the paid tier
  for profile embeddings, or move both sides to another model.
- **If you switch,** EmbeddingGemma-300m on DeepInfra is 768 native and
  costs $0.002 per 1M tokens, so re-embedding is close to free. Its input cap
  is 2,048 tokens, the same as today. `text-embedding-3-small` at 768 is the
  safer brand at $0.02 per 1M with an 8,192-token cap.

## 6. Sources

All read on 2026-10-13. "Updated" gives the page's own date where it shows
one.

Pricing and model pages:

- DeepInfra: <https://deepinfra.com/openai/gpt-oss-120b>,
  <https://deepinfra.com/openai/gpt-oss-20b>,
  <https://deepinfra.com/pricing>,
  <https://deepinfra.com/models/embeddings>,
  <https://deepinfra.com/google/embeddinggemma-300m>,
  <https://deepinfra.com/Qwen/Qwen3-Embedding-8B>
- DeepInfra structured output:
  <https://docs.deepinfra.com/chat/structured-outputs>
- OpenAI: <https://developers.openai.com/api/docs/pricing>,
  <https://developers.openai.com/api/docs/models/gpt-5-nano> (Chat
  Completions, structured outputs and function calling listed),
  <https://developers.openai.com/api/docs/models/gpt-5.6-luna>,
  <https://developers.openai.com/api/docs/guides/rate-limits>
- Gemini: <https://ai.google.dev/gemini-api/docs/pricing> (updated
  2026-10-09), <https://ai.google.dev/gemini-api/docs/openai> (updated
  2026-09-02), <https://ai.google.dev/gemini-api/docs/embeddings>,
  <https://ai.google.dev/gemini-api/docs/deprecations> (updated 2026-10-12)
- Groq: <https://console.groq.com/docs/models>,
  <https://console.groq.com/docs/structured-outputs>,
  <https://console.groq.com/docs/rate-limits>
- Amazon Bedrock prices: AWS Price List API, us-east-1, published
  2026-10-10:
  <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-1/index.json>
- Bedrock Chat Completions and structured output:
  <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html>,
  <https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html>,
  <https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html>,
  <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html>
- Together: <https://www.together.ai/pricing>,
  <https://docs.together.ai/docs/json-mode>,
  <https://docs.together.ai/docs/serverless-models>
- Fireworks: <https://fireworks.ai/pricing>,
  <https://docs.fireworks.ai/structured-responses/structured-response-formatting>
- Novita: <https://novita.ai/pricing>
- Baseten: <https://www.baseten.co/pricing/>,
  <https://docs.baseten.co/development/model-apis/overview>
- Cerebras:
  <https://inference-docs.cerebras.ai/api-reference/models/public-models>,
  <https://inference-docs.cerebras.ai/capabilities/structured-outputs>
- SambaNova: <https://cloud.sambanova.ai/plans/pricing>
- Azure retail prices API: <https://prices.azure.com/api/retail/prices>
- Vertex AI gpt-oss-120b (updated 2026-10-10):
  <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/maas/openai/gpt-oss-120b>
- OpenRouter:
  <https://openrouter.ai/api/v1/models/openai/gpt-oss-120b/endpoints>,
  <https://openrouter.ai/docs/faq>
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>,
  <https://platform.claude.com/docs/en/api/openai-sdk>
- Mistral: <https://docs.mistral.ai/models/mistral-small-4-0-26-03>,
  <https://docs.mistral.ai/models/ministral-3-8b-25-12>
- xAI: <https://docs.x.ai/docs/models>
- Cloudflare: <https://developers.cloudflare.com/workers-ai/platform/pricing/>
  (updated 2026-10-09)
- Cohere: <https://cohere.com/blog/embed-5>,
  <https://docs.cohere.com/docs/compatibility-api>

Chinese first-party APIs:

- DeepSeek: <https://api-docs.deepseek.com/quick_start/pricing>,
  <https://api-docs.deepseek.com/guides/json_mode>, privacy policy
  <https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html>
  (updated 2026-02-10)
- Moonshot: <https://platform.kimi.ai/docs/pricing/chat>, privacy
  <https://platform.kimi.ai/docs/agreement/userprivacy> (updated
  2025-04-30), terms <https://platform.kimi.ai/docs/agreement/modeluse>
  (updated 2026-07-30), help page
  <https://www.kimi.com/en/help/kimi-api/api-data-security>
- Z.ai: <https://docs.z.ai/guides/overview/pricing>,
  <https://docs.z.ai/guides/capabilities/struct-output>, privacy
  <https://docs.z.ai/legal-agreement/privacy-policy> (updated 2025-09-29)
- Alibaba: <https://www.alibabacloud.com/help/en/model-studio/model-pricing>
  (updated 2026-10-13),
  <https://www.alibabacloud.com/help/en/model-studio/json-mode> (updated
  2026-10-12),
  <https://www.alibabacloud.com/help/en/model-studio/privacy-notice>
  (updated 2026-10-11)
- MiniMax: <https://platform.minimax.io/docs/guides/pricing-paygo.md>,
  privacy <https://platform.minimax.io/protocol/privacy-policy> (updated
  2026-03-30)

Data terms:

- DeepInfra: <https://docs.deepinfra.com/account/data-privacy>,
  <https://deepinfra.com/terms> (updated 2026-08-17)
- Groq: <https://console.groq.com/docs/your-data>,
  <https://console.groq.com/docs/legal/services-agreement> (updated
  2026-06-22, read 2026-10-12 for KAN-196)
- Bedrock:
  <https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html>,
  <https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html>
- OpenAI: <https://developers.openai.com/api/docs/guides/your-data>. Age
  rule from
  <https://openai.com/policies/services-agreement/> and
  <https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance>;
  these returned 403, so the wording is unverified.
- Gemini: <https://ai.google.dev/gemini-api/terms> (updated 2026-04-28)
- Together: <https://www.together.ai/privacy> (updated 2025-12-17)
- Fireworks:
  <https://docs.fireworks.ai/guides/security_compliance/data_handling>
- Novita: <https://novita.ai/legal/terms-of-service> (updated 2026-08-05),
  <https://novita.ai/legal/privacy-policy> (updated 2026-05-13)
- Anthropic: <https://www.anthropic.com/legal/commercial-terms>,
  <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>
- Mistral: <https://legal.mistral.ai/terms/commercial-terms-of-service>
  (effective 2026-09-25)
- Cloudflare:
  <https://www.cloudflare.com/service-specific-terms-developer-platform/>

Benchmarks:

- Artificial Analysis methodology (index v4.3.2 and changelog):
  <https://artificialanalysis.ai/methodology/intelligence-benchmarking>
- Artificial Analysis model pages: `https://artificialanalysis.ai/models/`
  plus the slug (for example `gpt-oss-120b`, `gpt-5-nano`, `glm-5-3-flash`,
  `deepseek-v4-1-flash-non-reasoning`, `gemini-3-5-flash-lite`)
- BFCL V4: <https://gorilla.cs.berkeley.edu/leaderboard.html>,
  <https://gorilla.cs.berkeley.edu/data_overall.csv>
- gpt-oss model card: <https://arxiv.org/html/2508.10925>
- Qwen3 2507:
  <https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507>,
  <https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507>
- Llama 3.3 70B: <https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct>

## 7. Still open

- **Measure reasoning-token overhead.** Every cost above ignores hidden
  reasoning tokens. Run each task at effort `low` and record real output
  tokens before you trust the monthly figures.
- **Run a small eval on real inputs**, especially Tailor's "no invented
  facts" rule. No public benchmark measures that directly.
- **DeepInfra's data region and rate limits** are not published on the
  pages read.
- **The `gemini-embedding-001` price** is gone from Google's pricing page.
- **Vertex AI prices** did not render; the figures above are unverified.
