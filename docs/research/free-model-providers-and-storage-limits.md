# Free model providers and sent-resume storage limits

Research for KAN-196. All sources were read on 2026-10-12. Each page's
"last updated" date is given where the page shows one. Free tiers, limits and
terms change often: check again before you rely on a number.

## The question

1. **Gemini free tier.** What are the free-tier limits (requests per minute,
   requests per day, tokens per minute) for the Flash and Flash-Lite chat
   models and for `gemini-embedding-001`? Is the quota per Google Cloud
   project or per API key? What happens when an app goes over it?
2. **Free hosted model providers (widened scope).** The team is not tied to
   Gemini. Which free hosted providers could WorkIt use instead of the Gemini
   free tier, or as a fallback beside it? Candidates: Gemini API free tier,
   Groq, Cerebras, Mistral (free plan), OpenRouter `:free` models, Cloudflare
   Workers AI, GitHub Models, Cohere trial, and any other serious free tier.
   For each: data terms on the free tier (the main criterion), limits, an
   OpenAI-compatible chat endpoint with JSON output and tool calling, models
   and rough quality for WorkIt's three tasks (draft resume bullets from a
   student's words, extract up to 20 keywords from a job posting, parse a
   resume into JSON), a free embedding model (matching uses
   `gemini-embedding-001` at 768 dimensions), and whether the free tier
   allows production use by an app with real users.
3. **Supabase Storage free tier.** Total storage, maximum file size,
   egress, and what happens when a project goes over. A sent resume is a PDF
   of about 50 to 150 KB.

**Context.** Users are US college students. Identity data is removed before
any model call, but the text is still a person's history. Scout's `llm.py`
calls one OpenAI-compatible endpoint, with an optional fallback endpoint that
it uses on a 429 or a dead endpoint (`scout/CLAUDE.md`).

## Answer in short

- **Gemini free tier:** Google does not publish fixed free-tier numbers any
  more. The live limits show only in AI Studio after sign-in. Limits apply
  **per project, not per API key**. The daily quota resets at **midnight
  Pacific time**. Over a limit, the API returns **HTTP 429**. The free tier
  trains on prompts, allows human review, and its terms say "do not submit
  personal information". All users must be 18 or older.
- **Best free primary: Groq.** No training on inputs or outputs (contract).
  No retention by default, zero data retention (ZDR) can be turned on, data
  stored in the US. Real end users are allowed. OpenAI-compatible, strict
  JSON schema on `gpt-oss-120b`. Limits are low: 30 requests a minute, 1,000
  a day, 8,000 tokens a minute, 200,000 tokens a day per model, per
  organization. No embeddings.
- **Best free fallback: Cloudflare Workers AI.** No training on customer
  content. 10,000 "Neurons" a day free (roughly 190 `gpt-oss-120b` calls a
  day). It has `bge-base-en-v1.5`, a 768-dimension embedding model.
- **Not suitable:** GitHub Models (shut down on 2026-07-30), Cohere trial
  and NVIDIA API catalog (no production use), Cerebras (only a one-time $5
  credit, "not intended for production use"), SambaNova (20 requests a day),
  Hugging Face (no free credits), OpenRouter `:free` (each free model is
  served by a third party; the main ones train on prompts or forbid
  production use).
- **Mistral free plan:** trains by default (you can opt out), hosts in the
  EU by default, and does not publish its limits. A possible third choice
  only.
- **Supabase Storage (Free plan):** 1 GB storage, 50 MB maximum file size,
  5 GB egress plus 5 GB cached egress a month. That is about 7,000 resumes
  at 150 KB, or about 20,000 at 50 KB. Over the quota: an email, a grace
  period, then possible restrictions (paused projects, read-only database,
  HTTP 402 on API requests) until the next billing cycle. Free projects also
  pause after 7 days without activity.

## 1. Gemini API free tier

### Limits

Source: <https://ai.google.dev/gemini-api/docs/rate-limits> (last updated
2026-10-09).

- Limits are measured as requests per minute (RPM), input tokens per minute
  (TPM) and requests per day (RPD). Going over any one of them gives an
  error, even if the others are within limits.
- "Rate limits are applied per project, not per API key." A second API key in
  the same project gives no extra quota.
- "Requests per day (RPD) quotas reset at midnight Pacific time."
- "Rate limits are more restricted for experimental and preview models."
- **The page publishes no free-tier numbers** for any Flash, Flash-Lite or
  embedding model. It says limits "depend on a variety of factors (such as
  your usage tier)" and points to AI Studio
  (<https://aistudio.google.com/rate-limit>), which needs a Google sign-in.
  This note could not read it. Read the live values for the WorkIt project
  there.
- `scout/CLAUDE.md` says "about 500–1,500 requests a day per project" for
  `gemini-3.5-flash-lite`. No primary source confirms that range.
- To leave the free tier, set up billing in AI Studio. Free to Tier 1
  "will typically take effect instantly".

### Exceeding a limit

- The rate-limits page: "If you hit a spend-based rate limit, the API
  returns a `429 RESOURCE_EXHAUSTED` error."
- The API errors page lists three 429 codes:
  `rate_limit_exceeded` ("per-minute or per-second request or token limit";
  retry with exponential backoff), `quota_exceeded` ("daily quota"; wait for
  the reset) and `too_many_requests`. Source:
  <https://ai.google.dev/gemini-api/docs/api-errors> (last updated
  2026-09-20).
- The troubleshooting page recommends exponential backoff with jitter and
  retries only for 429, 408 and 5xx. Source:
  <https://ai.google.dev/gemini-api/docs/troubleshooting> (last updated
  2026-10-01).

### Models and price

Source: <https://ai.google.dev/gemini-api/docs/pricing> (last updated
2026-10-09). Free tier is "free of charge" for `gemini-3.8-flash`,
`gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash`,
`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` and
`gemini-2.5-flash-lite`. The Free plan card says: "Content used to improve
our products."

### Embeddings

- `gemini-embedding-001` (text only, 2,048 input tokens) and
  `gemini-embedding-2` (multimodal, 8,192 tokens) both take
  `output_dimensionality`; 768 is a recommended value. The two embedding
  spaces are incompatible: a switch means re-embedding all data. Source:
  <https://ai.google.dev/gemini-api/docs/embeddings> (last updated
  2026-10-09).
- The pricing page lists only `gemini-embedding-2` (text input free on the
  free tier). It does not mention `gemini-embedding-001`, so its free-tier
  status and limits are not confirmed from the pricing page.

### Endpoint

OpenAI-compatible base URL
`https://generativelanguage.googleapis.com/v1beta/openai/`, with structured
output, tool calling and `/embeddings`. Source:
<https://ai.google.dev/gemini-api/docs/openai> (last updated 2026-09-02).

### Data terms

Source: <https://ai.google.dev/gemini-api/terms> (effective 2026-03-23, last
updated 2026-04-28). More detail is in KAN-183's note on the
`research/model-provider-data-terms` branch.

- Unpaid Services: Google uses content and responses to improve its
  products and machine learning; "human reviewers may read, annotate, and
  process your API input and output". "Do not submit sensitive,
  confidential, or personal information to the Unpaid Services."
- No general retention period is stated.
- "You must be 18 years of age or older to use the APIs." No API client
  "directed towards or is likely to be accessed by individuals under the age
  of 18".
- Only Paid Services may serve users in the EEA, Switzerland or the UK.
- The terms do not address production use of the free tier directly. They
  say the APIs are "for professional or business purposes, not for consumer
  use".

## 2. Other free providers

### Groq (free plan)

- **Training:** "Groq is not permitted to use Inputs or Outputs for training
  or fine-tuning any AI Model Services or other models" unless the customer
  allows it. Services Agreement §4.2,
  <https://console.groq.com/docs/legal/services-agreement> (last modified
  2026-06-22).
- **Retention:** "By default, Groq does not retain customer data for
  inference requests." Up to 30 days for reliability or abuse checks. Any
  customer can turn on ZDR in Data Controls. Stored data is in GCP in the
  United States. Source: <https://console.groq.com/docs/your-data> (no
  date). The processing region for a default request is not stated.
- **Age:** §2: "You must be 18 years of age or older" (the account holder).
  §6.3: if the app is "likely to be accessed by individuals under the age of
  majority", the customer alone is responsible for compliance. This is a
  duty, not a ban.
- **Production:** §3.1 allows making the services available "to End Users
  through your Customer Applications". §5.1: some services "may be
  designated as fee-free … based on usage limits". The agreement also bans
  use "intended to avoid incurring Fees". Free services have no
  indemnification (§15.3(c)) and a $5,000 liability cap (§14.2).
- **Limits** (free plan, per organization, "not individual users"). Source:
  <https://console.groq.com/docs/rate-limits> (no date).

  | Model | RPM | RPD | TPM | TPD |
  | --- | --- | --- | --- | --- |
  | `openai/gpt-oss-120b` | 30 | 1,000 | 8,000 | 200,000 |
  | `openai/gpt-oss-20b` | 30 | 1,000 | 8,000 | 200,000 |
  | `qwen/qwen3.8-27b` (preview) | 30 | 1,000 | 8,000 | 200,000 |

  Free limits for `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` show
  only in the account's settings. Over a limit: HTTP 429 with `retry-after`
  (seconds). Every response has `x-ratelimit-*` headers, including the time
  to reset. Cached tokens do not count.
- **Endpoint:** `https://api.groq.com/openai/v1`. Strict `json_schema` on
  `gpt-oss-20b`, `gpt-oss-120b`, `qwen3.8-27b`; `json_object` on all models.
  "Streaming and tool use are not currently supported with Structured
  Outputs." All models support tool use. Sources:
  <https://console.groq.com/docs/structured-outputs>,
  <https://console.groq.com/docs/tool-use>.
- **Models:** production `gpt-oss-120b`, `gpt-oss-20b`,
  `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`; preview
  `qwen/qwen3.8-27b`, `minimaxai/minimax-m2.7` (not for production). Source:
  <https://console.groq.com/docs/models>.
- **Embeddings:** none.

### Cloudflare Workers AI (free allocation)

- **Training:** "Cloudflare does not use your Customer Content to (1) train
  any AI models made available on Workers AI". Source:
  <https://developers.cloudflare.com/workers-ai/platform/data-usage/> (last
  updated 2026-04-21). The Service-Specific Terms say the same and make no
  free/paid split:
  <https://www.cloudflare.com/service-specific-terms-developer-platform/>
  (last updated 2026-09-28).
- **Retention and region:** no period stated for inference. The privacy
  policy says Cloudflare stores data "primarily" in the US and the EEA:
  <https://www.cloudflare.com/privacypolicy/> (effective 2025-11-04).
- **Age:** the Self-Serve terms set no minimum age and say nothing on
  minors: <https://www.cloudflare.com/terms/> (last updated 2025-09-12).
  Each model's own licence and use policy also apply.
- **Production:** no clause bans production use on the free plan. Only Beta
  services are "non-production" (§5). Cloudflare may end free versions at
  its discretion (§2.6).
- **Limits:** 10,000 Neurons a day on Free and Paid, reset at 00:00 UTC.
  Over it on Free, requests fail: error 3036, HTTP 429, "You have used up
  your daily free allocation of 10,000 neurons." Rate limits: 300 requests
  a minute for text generation, 3,000 for embeddings. Sources:
  <https://developers.cloudflare.com/workers-ai/platform/pricing/> (last
  updated 2026-10-09),
  <https://developers.cloudflare.com/workers-ai/platform/limits/> and
  <https://developers.cloudflare.com/workers-ai/platform/errors/> (both last
  updated 2026-09-17).
- **Capacity** (inference from the Neuron prices, at about 1,000 input and
  300 output tokens a call; all models share the 10,000):
  `gpt-oss-120b` about 190 calls a day, `llama-3.3-70b-instruct-fp8-fast`
  about 110, `qwen3-30b-a3b-fp8` about 720.
- **Endpoint:**
  `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`, with
  `/chat/completions` and `/embeddings`. Source:
  <https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/>
  (last updated 2026-09-18). JSON mode takes `response_format` with
  `json_schema`, but the schema is not guaranteed and JSON mode does not
  stream: <https://developers.cloudflare.com/workers-ai/features/json-mode/>.
  Function calling is marked on `gpt-oss-120b`, `llama-3.3-70b`,
  `qwen3-30b-a3b`, `mistral-small-3.1`. Not confirmed: that the OpenAI
  `tools` format works through `/ai/v1`.
- **Embeddings:** `@cf/baai/bge-base-en-v1.5`, **768 dimensions**, 512
  input tokens at most:
  <https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/>.
  `embeddinggemma-300m` is Beta.

### Mistral (free plan; "Experiment" in Mistral's news, "Free mode" in docs)

- **Training: on by default.** "In free mode … we may use your data (input
  and output) to train our artificial intelligence models … right to opt
  out". Opt out in Admin panel, Privacy, "Anonymous improvement data" (API
  toggle). Sources:
  <https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models>,
  <https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training>.
- **Retention and region:** no default period found; ZDR is for paid plans
  only. Data is hosted in the EU by default:
  <https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data>.
- **Age:** no numeric minimum. Do not include data of children under 13 or
  let minors use the products without parental consent. Commercial Terms
  §2.2(c), <https://legal.mistral.ai/terms/commercial-terms-of-service>
  (effective 2026-09-25).
- **Limits:** not published. Free mode "has the lowest limits, intended for
  evaluation and prototyping". Over a limit: 429. Source:
  <https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them>.
- **Endpoint:** `https://api.mistral.ai/v1`, `json_schema` output, tool
  calling.
- **Embeddings:** `mistral-embed` is 1024 only. `codestral-embed` can output
  768, but it is built for code:
  <https://docs.mistral.ai/studio/knowledge-rag/embeddings/code_embeddings>.

### OpenRouter `:free` models

- OpenRouter itself does not train on inputs or outputs, and prompt logging
  is opt-in: <https://openrouter.ai/privacy>, <https://openrouter.ai/terms>
  (both last updated 2026-08-31). But "Each provider on OpenRouter has its
  own data handling policies":
  <https://openrouter.ai/docs/guides/privacy/provider-logging>.
- On 2026-10-12 the free models were served by NVIDIA (Nemotron), Google AI
  Studio (Gemma 4), and smaller hosts. NVIDIA's trial terms forbid
  production use and personal information; Google's unpaid terms train on
  prompts and forbid apps likely used by people under 18. No Llama 3.3 70B,
  gpt-oss, Qwen 3 or Mistral Small had a `:free` variant.
- **Limits:** 20 requests a minute; 50 a day, or 1,000 a day after 10
  credits are bought (lifetime). Per account: "Making additional accounts or
  API keys will not affect your rate limits". Over a limit: 429 with
  `X-RateLimit-*` headers. Source:
  <https://openrouter.ai/docs/api-reference/limits>.
- The FAQ says free models "are usually not suitable for production use":
  <https://openrouter.ai/docs/faq>.
- No free embedding model at 768 dimensions was confirmed.

### Cerebras

- No ongoing free tier: a one-time $5 credit after a verified payment
  method, expiring in 30 days. "Cerebras doesn't currently offer a no-cost
  tier that renews automatically". Source:
  <https://inference-docs.cerebras.ai/support/rate-limits>.
- The self-serve tier is "not intended for production use":
  <https://www.cerebras.ai/pricing>.
- Good data terms (no training; "We do not retain inputs and outputs"):
  <https://cloud.cerebras.ai/terms>,
  <https://www.cerebras.ai/privacy-policy>. Minimum age 13.
- Trial limits: 5 RPM, 1M tokens a day for `gpt-oss-120b` and
  `qwen-3.8-27b`. Endpoint `https://api.cerebras.ai/v1`. No embeddings.

### GitHub Models

Retired on 2026-07-30: "no longer available to any customer". Source:
<https://github.blog/changelog/2026-07-30-github-models-is-now-retired/>.

### Cohere (trial keys)

- "trial keys are rate limited and are not permitted to be used for
  production or commercial purposes": <https://cohere.com/pricing>.
- Trial data "may" be used for research and development; "Please do not
  submit personal information in inputs": <https://cohere.com/privacy> (last
  updated 2026-05-01).
- 20 RPM for chat, 1,000 calls a month:
  <https://docs.cohere.com/docs/rate-limits>.
- Compatibility API `https://api.cohere.ai/compatibility/v1`. `embed-v5.0`
  can output 768 through Cohere's own API only.

### NVIDIA API catalog, SambaNova, Hugging Face

- **NVIDIA (build.nvidia.com):** "for internal testing and evaluation
  purposes, not in production", and no personal information. Trial Terms
  §1.4, §4.3:
  <https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf>.
- **SambaNova Cloud:** free tier is 20 RPM and **20 requests a day** per
  model: <https://docs.sambanova.ai/docs/en/models/rate-limits>. No
  embeddings.
- **Hugging Face Inference Providers:** free users get no monthly credits:
  <https://huggingface.co/docs/inference-providers/pricing>.

## 3. Comparison

"Train" means the free tier may use prompts to train models.

| Provider | Train | Production with real users | Free limit (best model) | Limit scope | JSON schema + tools | Free 768-dim embeddings |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini free | Yes, plus human review | Not banned; "no personal information" | Not published (AI Studio) | Project | Yes / yes | Yes (`gemini-embedding-001`, `-2`) |
| Groq | No (contract) | Yes | 30 RPM, 1,000 RPD, 8K TPM, 200K TPD | Organization | Strict / yes (not both at once) | No |
| Cloudflare Workers AI | No | Yes (not Beta models) | 10,000 Neurons/day (~190 gpt-oss-120b calls) | Account | Best effort / yes | Yes (`bge-base-en-v1.5`) |
| Mistral free | Yes, opt-out | Not banned; "evaluation and prototyping" | Not published | Organization or workspace | Yes / yes | Only `codestral-embed` (code) |
| OpenRouter `:free` | Depends on host; main hosts do | FAQ: "usually not suitable" | 20 RPM, 50 or 1,000 RPD | Account | Varies / varies | Not confirmed |
| Cerebras | No | No ("not intended for production") | $5 once, 30 days | Organization | Strict / yes | No |
| Cohere trial | May, for R&D | No | 20 RPM, 1,000 calls/month | Not stated | Yes / yes | Native API only |
| NVIDIA catalog | Collects to improve | No | Not published | Not stated | Not documented / yes | Yes, but trial only |
| SambaNova | No (service use only) | Not banned | 20 RPD | User | Best effort / yes | No |
| GitHub Models | — | Retired 2026-07-30 | — | — | — | — |

Quality for WorkIt's three tasks (judgment, not a benchmark): `gpt-oss-120b`
is a strong fit for all three and has strict JSON schema on Groq.
`llama-3.3-70b` is good for bullet drafting. `gpt-oss-20b`,
`qwen3-30b-a3b` and `llama-3.1-8b` are enough for keyword extraction.

## 4. Recommendation

- **Primary: Groq, `openai/gpt-oss-120b`**, base URL
  `https://api.groq.com/openai/v1`. It is the only free tier with a
  no-training contract, default no retention, ZDR, US storage, and a
  licence for real end users. Turn on ZDR in Data Controls. Note the limits:
  1,000 requests and 200,000 tokens a day per model, per organization. Two
  Groq models (for example `gpt-oss-120b` and `gpt-oss-20b`) have separate
  per-model limits. Strict JSON schema does not work with streaming or tools
  in the same request.
- **Fallback: Cloudflare Workers AI, `@cf/openai/gpt-oss-120b`**, through
  the `/ai/v1` endpoint. It also does not train, and it adds about 190 calls
  a day. Test its `tools` and `response_format` support through `/ai/v1`
  before you rely on it.
- **Do not keep Gemini's free tier for user text.** Its terms train on
  prompts and say not to send personal information. Use it only for text
  that is not personal, or move to the paid tier.
- **Embeddings: Cloudflare `@cf/baai/bge-base-en-v1.5`** (768 dimensions,
  no training). Two costs: every stored vector must be re-embedded, because
  the spaces are incompatible; and the 512-token input cap means long job
  postings must be cut or split. If that is too much work now, keep
  `gemini-embedding-001` for job postings only (public text), and do not
  send a student's own text to it on the free tier.
- **Age:** Groq, Gemini and OpenRouter require the account holder to be 18
  or older. Gemini also bans apps likely used by under-18s. Groq puts the
  compliance duty for minors on WorkIt.

## 5. Supabase Storage (Free plan)

Sources: <https://supabase.com/pricing>,
<https://supabase.com/docs/guides/storage/uploads/file-limits>,
<https://supabase.com/docs/guides/platform/manage-your-usage/storage-size>,
<https://supabase.com/docs/guides/platform/manage-your-usage/egress>,
<https://supabase.com/docs/guides/platform/billing-faq>. None shows a
"last updated" date.

- **Storage:** 1 GB, measured as an average over the billing period (744
  GB-hours), "not the live size". A cut late in the cycle may not clear a
  restriction until the next cycle.
- **Maximum file size:** 50 MB on Free ("can't exceed 50 MB"); up to 500 GB
  on Pro. A bucket can set a lower limit and allowed file types.
- **Egress:** 5 GB plus 5 GB cached a month. Storage downloads count. The
  quota covers all services in the organization, not Storage alone.
- **Other Free limits:** 500 MB database per project, 2 active projects.
  "Free projects are paused after 1 week of inactivity."
- **Over the quota:** an email to the billing address and a grace period.
  After it, the Fair Use Policy can apply: paused projects, a read-only
  database, no new projects, and HTTP 402 on all API requests, generally for
  every project in the organization. Restrictions clear when the quota
  refills at the next billing cycle, or at once on an upgrade to Pro. After
  the first grace period, a second overage gets no new grace period. Pro
  ($25 a month) includes 100 GB storage and 250 GB egress.
- **What this means for sent resumes** (arithmetic): 1 GB holds about
  7,000 PDFs at 150 KB, or about 20,000 at 50 KB, less whatever else the
  project stores. 5 GB egress is about 34,000 downloads a month at 150 KB.
  The 50 MB file cap is not a concern.

## Not confirmed from a primary source

- Gemini free-tier RPM, TPM and RPD for every model, including
  `gemini-embedding-001`; they show only in AI Studio after sign-in. The
  "500–1,500 requests a day" range in `scout/CLAUDE.md` is unconfirmed.
- Whether `gemini-embedding-001` is still on the free tier (the pricing page
  lists only `gemini-embedding-2`).
- Groq free limits for the Llama models, and the processing region for a
  default request.
- Cloudflare: OpenAI `tools` and `json_schema` through `/ai/v1`; whether the
  limits are per account; inference log retention.
- Mistral free-plan limits, retention period and included models.
- The length of Supabase's grace period.
- OpenRouter per-model training labels and the "free endpoints may publish
  prompts" setting (behind sign-in).
