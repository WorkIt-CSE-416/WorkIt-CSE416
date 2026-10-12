# Model provider data terms: Gemini API, Vertex AI, DeepSeek API

Research for KAN-183 (map: KAN-181, resume builder redesign). All sources
read on 2026-10-12. The "last updated" date of each page is given where the
page shows one. Prices and terms change often: check again before a decision
is final.

**Context.** WorkIt is a free job platform for US college students. The model
rewrites resume bullets and parses resumes. Today the API sends only parsed
resume fields: never the name, contact details or links.

## Answer in short

- **Gemini API, free tier: not suitable for student data.** Google uses the
  prompts and responses to improve its products and models. Human reviewers
  can read them. The terms say: do not send personal information. The terms
  also require every user to be 18 or older, and ban apps "likely to be
  accessed" by people under 18.
- **Gemini API, paid tier: usable.** No training on prompts. Google logs
  prompts only for abuse checks, "for a limited period". Data can be stored or
  cached in any country. The 18+ rule still applies on the paid tier.
- **Vertex AI: the strongest terms.** A contractual training restriction,
  regional processing, abuse logs only for flagged prompts (up to 90 days, in
  the chosen region), and a documented path to zero data retention. Prices
  match the paid Gemini API (10% more on regional endpoints). No 18+
  audience clause was found in the Cloud service terms.
- **DeepSeek API: avoid for student data.** Data is stored in the People's
  Republic of China. The privacy policy allows use of inputs to train models,
  with opt-out only by email. Retention has no fixed limit. Disputes go to a
  court in Hangzhou under Chinese law. It is the cheapest option.
- **FERPA:** none of these API terms mentions FERPA. Google's FERPA
  commitment covers Google Workspace for Education, not the Gemini API or
  Vertex AI. WorkIt contracts with students directly, not through a
  university, so FERPA likely does not bind WorkIt today; it would matter if a
  university shares education records with WorkIt.

## Gemini API (Google AI Studio)

Source: Gemini API Additional Terms of Service,
<https://ai.google.dev/gemini-api/terms> (effective 2026-03-23, last updated
2026-04-28).

### Free tier ("Unpaid Services")

- **Training and human review:** Google uses submitted content and responses
  to "provide, improve, and develop Google products and services and machine
  learning technologies". Human reviewers may read, annotate and process
  inputs and outputs. Google disconnects the data from the account, API key
  and Cloud project before review.
- **Personal data:** "Do not submit sensitive, confidential, or personal
  information to the Unpaid Services."
- **Retention:** no general period is stated.

### Paid tier ("Paid Services")

Paid means a project with an active billing account (or AI Studio tied to one).

- **Training:** Google does not use prompts or responses to improve its
  products.
- **Logging:** prompts and responses are logged "for a limited period of
  time", only to detect Prohibited Use Policy violations and for legal or
  safety needs. No exact period is stated.
- **Processing location:** data "may be stored transiently or cached in any
  country in which Google or its agents maintain facilities". No region is
  guaranteed.
- **Contract:** processing falls under Google's Data Processing Addendum.
- **Optional request logs** (opt-in, billing projects only): kept up to 55
  days by default; can be cut to 7, 14 or 28 days. Logs shared with Google as
  datasets fall under the unpaid terms and can be used for training. Source:
  <https://ai.google.dev/gemini-api/docs/logs-policy> (last updated
  2026-09-04).
- **Grounding with Google Search or Maps:** prompts and outputs are stored
  for 30 days.

### Terms that apply to both tiers

- **Age:** "You must be 18 years of age or older to use the APIs." The
  Services may not be part of an API client "directed towards or is likely to
  be accessed by individuals under the age of 18". Most college students are
  18 or older, but some first-year students are 17. WorkIt would need an 18+
  sign-up rule to stay inside these terms.
- **Use:** professional or business use only, not consumer use.
- **EEA, Switzerland, UK:** apps offered there must use Paid Services only.
- **Education:** the terms say nothing about students, schools or FERPA.

### Pricing (standard, USD per 1M tokens)

Source: <https://ai.google.dev/gemini-api/docs/pricing> (last updated
2026-10-09). The free tier column means "free of charge, subject to rate
limits". The same page states: free tier content is "used to improve our
products"; paid tier content is not.

| Model | Free tier | Input | Output (incl. thinking) |
| --- | --- | --- | --- |
| Gemini 3.8 Flash / 3.6 Flash | Yes | $0.75 to 2026-12-31, then $1.50 | $3.75, then $7.50 |
| Gemini 3.5 Flash-Lite | Yes | $0.30 | $2.50 |
| Gemini 3.1 Flash-Lite | Yes | $0.25 (text) | $1.50 |
| Gemini 3.1 Pro Preview | No | $2.00 (≤200k), $4.00 (>200k) | $12.00, $18.00 |
| Gemini 2.5 Pro | Yes | $1.25 (≤200k), $2.50 (>200k) | $10.00, $15.00 |
| Gemini 2.5 Flash | Yes | $0.30 (text) | $2.50 |
| Gemini 2.5 Flash-Lite | Yes | $0.10 (text) | $0.40 |

Batch and Flex modes cost less; they are not shown.

### Free-tier rate limits

Google no longer publishes fixed free-tier numbers. The rate-limits page says
limits "depend on a variety of factors" and shows the live values for a
project in AI Studio (<https://aistudio.google.com/rate-limit>). Source:
<https://ai.google.dev/gemini-api/docs/rate-limits> (last updated
2026-10-09). Third-party guides from 2026 disagree (from about 5 RPM / 100
requests per day to 15 RPM / 1,500 per day for Flash), so do not plan on a
number. Paid tiers: Tier 1 needs a linked billing account (cap $250); Tier 2
needs $100 spent and 3 days (cap $2,000); Tier 3 needs $1,000 spent and 30
days.

## Vertex AI (Google Cloud)

Google now names it "Gemini Enterprise Agent Platform" in parts of its docs.

- **Training restriction (contract):** "Google will not use Customer Data to
  train or fine-tune any AI/ML models without Customer's prior permission or
  instruction." Source: Google Cloud Service Specific Terms,
  <https://cloud.google.com/terms/service-terms> (last modified 2026-10-12).
  No clause on users under 18 was found in these terms.
- **Caching:** in memory only, isolated per project, 24-hour TTL; it can be
  turned off per project.
- **Abuse monitoring:** prompts are logged only when automated classifiers
  flag them. Logs are kept up to 90 days in the region the customer chose and
  are never used for training. Authorized Google staff may review flagged
  prompts. Customers under a Google Cloud Master Agreement are exempt by
  default; others can request an exception. Source:
  <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring>
  (last updated 2026-10-09).
- **Zero data retention:** possible. Request the abuse-monitoring exception,
  keep request-response logging off (the default), set `store = false` in the
  Interactions API, and avoid Google Search grounding (query logs up to 3
  days) and Maps grounding (30 days). Source:
  <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance>
  (last updated 2026-10-09).
- **Region:** the customer picks a location. Caches and abuse logs follow
  that location. Full residency rules are on Google's separate Data residency
  page, not read for this note. The global endpoint gives no region and is
  cheaper.
- **Pricing:** same as the paid Gemini API on the global endpoint (for
  example 3.5 Flash-Lite $0.30 / $2.50, 2.5 Flash $0.30 / $2.50, 2.5
  Flash-Lite $0.10 / $0.40, 3.1 Pro Preview $2.00 / $12.00). Regional
  ("non-global") endpoints cost 10% more. Priority processing costs about 80%
  more. Source: <https://cloud.google.com/vertex-ai/generative-ai/pricing>
  (read 2026-10-12). There is no free tier for the models themselves; new
  Cloud accounts get $300 in credits.

## DeepSeek API

### Data terms

Source: DeepSeek Privacy Policy,
<https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html> (last
updated 2026-02-10).

- **Storage:** DeepSeek will "directly collect, process and store your
  Personal Data in People's Republic of China".
- **Training:** inputs may be used to "train and improve our technology, such
  as our machine learning models". The policy lists a right to opt out, but
  gives no method other than email to privacy@deepseek.com. No paid-tier
  exception is described.
- **Retention:** no fixed period; data is kept as long as the account exists,
  and longer after a terms violation.
- **Disclosure:** data may go to law enforcement and public authorities under
  legal process.
- **Age:** the services are not aimed at children; no minimum age is stated.
- **Developer role:** for apps built on the API, the developer is the
  controller of end-user data and must publish its own privacy policy.

Source: DeepSeek Open Platform Terms of Service,
<https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html>
(effective 2026-04-29).

- **Age:** no minimum; "minors under the age of 18 shall read in the presence
  of a legal guardian".
- **Developer duties:** tell end users the processing rules, get consent or
  another legal basis, and answer end-user rights requests.
- **Law and courts:** law of mainland China; disputes go to a court where
  Hangzhou DeepSeek Artificial Intelligence Co., Ltd. is registered.
- **Education:** nothing on students, schools or FERPA.

### Pricing and limits

Source: <https://api-docs.deepseek.com/quick_start/pricing> and
<https://api-docs.deepseek.com/quick_start/rate_limit> (no date shown; read
2026-10-12). USD per 1M tokens, peak price (off-peak is half).

| Model | Input (cache hit) | Input (cache miss) | Output |
| --- | --- | --- | --- |
| `deepseek-flash` (V4.1-Flash) | $0.006 | $0.30 | $1.20 |
| `deepseek-v4-pro` | $0.044 | $1.32 | $3.96 |

- Peak hours: 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays. All other
  times are off-peak.
- **No free tier.** Usage is billed from a prepaid balance.
- **Limits:** concurrency only, per account: 2,500 requests in flight for
  `deepseek-flash`, 500 for `deepseek-v4-pro`. Raising them is free on
  request.

## FERPA and US university use

- FERPA protects education records held by schools that take US Department
  of Education funds. It binds a vendor through the "school official"
  exception only when a school shares records with it under contract (34 CFR
  99.31(a)(1)(i)(B)).
- Google's FERPA page states: "Google Workspace for Education can be used in
  compliance with FERPA, our commitment to which is included in our
  agreements." It names no other product. Source:
  <https://cloud.google.com/security/compliance/ferpa> (read 2026-10-12).
- No Gemini API, Vertex AI or DeepSeek document found here makes a FERPA
  commitment.
- Inference: a student who uploads their own resume to WorkIt is not a school
  sharing an education record, so FERPA likely does not apply to WorkIt now.
  A partnership where a university sends student data to WorkIt would change
  that, and would favour Vertex AI, which has a contract and regional
  processing. Confirm with counsel before such a deal.

## What this means for WorkIt

1. Do not use the Gemini free tier for real user data. Its terms ban personal
   information and allow training and human review.
2. The paid Gemini API is enough for the MVP. Its cost is low: a bullet
   rewrite of about 1k tokens in and 300 out on 3.5 Flash-Lite costs about
   $0.001.
3. Choose Vertex AI if the team wants regional processing, zero data
   retention or a contract to show a university.
4. The Gemini API terms (both tiers) need users to be 18+. Add an 18+ check
   at sign-up, or use Vertex AI, whose service terms carry no such clause.
5. Do not send student data to DeepSeek's hosted API. Its open-weight models
   could run on a US host instead, but that is a separate question.
