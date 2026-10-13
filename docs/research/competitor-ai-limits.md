# How job and resume tools ration their AI

Research for KAN-197. It extends KAN-182
(`docs/research/resume-builder-competitors.md` on branch
`research/resume-builder-competitors`), which compared the resume features of
Jobright, Simplify, Teal and Rezi.

**Read on 2026-10-13**, unless a line says otherwise. Sources are the products'
own pricing pages, help centers, privacy policies, subprocessor lists, terms
and blogs. A claim marked **(secondary)** comes from a third-party review,
a university page or a news article. A claim marked **(snippet)** comes from a
search-engine extract of a primary page that blocked direct reading (HTTP 403
or a page built by JavaScript). Prices and limits change often. Check them
again before you quote them.

"Unknown" means the product does not say. We did not guess.

## The answer in short

- **No product publishes a daily AI quota.** Jobright is the only tool with a
  daily reset, and only third-party reviews report its numbers.
- **The common free limit is a small lifetime allowance.** Examples: Teal's
  non-renewable credits (10 bullets, 2 summaries, 2 cover letters), Rezi's 10
  AI bullets and 1 Agent prompt, Huntr's 2 tailored resumes, and Yoodli's 5
  sessions.
- **At the limit, almost every product shows an upgrade wall.** No product
  sells single credits. Two products make the user wait for a reset: Jobright
  (daily) and Simplify Autopilot (weekly, paid users only).
- **The non-AI path stays free everywhere.** The builder, the templates, the
  tracker and the keyword score keep working when the AI stops.
- **The free tools for students are paid for by someone else.** Handshake,
  Indeed and LinkedIn's Job Match are free, and they publish no limits.
  Handshake gates each AI feature by school. Big Interview, VMock, Resume
  Worded and Huntr reach students through licenses that universities pay for.
- **Most tools that name a provider name OpenAI.** Several also name
  Anthropic and Google: Jobright, Kickresume, Resume Worded and Handshake.
  Many name no provider.
- **Only Kickresume has an individual student plan:** free Premium for 180
  days, verified through ISIC or UNiDAYS. LinkedIn ran a one-time .edu
  promotion that ended in March 2026.

## Comparison

| Product | Free AI limit | At the limit | Paid price | Model provider | Student plan |
|---|---|---|---|---|---|
| Jobright | Tailoring has "daily usage limits". Reviews report 2 tailored resumes a day, resetting at midnight, with no rollover (secondary). Orion chat: "Ask Orion for FREE", no cap stated | Wait for the midnight reset, or upgrade (secondary) | No public job-seeker price. Turbo reported at $39.99/mo, $17.99/wk, $89.99/qtr (secondary) | OpenAI, Anthropic, Google Cloud AI, AWS AI (privacy notice) | None stated |
| Simplify | No free AI. Free covers the keyword score and missing keywords. Autopilot (paid only) gets 20 credits a week, with no rollover | Upgrade wall for free AI. Autopilot: wait for the weekly reset, with no way to buy more | Simplify+ $19.99/wk, $39.99/mo, $89.99/3 mo | Unknown. The policy names only categories ("AI gateways and routing services") | None stated |
| Teal | One-time, non-renewable credits: 10 bullets (one help page says 5), 2 summaries, 2 cover letters, 5 achievements. A counter shows in the editor | Upgrade wall. The builder stays free | Teal+ $13/7 days, $29/30 days, $79/90 days. No free trial | OpenAI (privacy policy, "such as OpenAI") | None stated |
| Rezi | 10 AI bullets (lifetime), 1 Agent prompt, 1 AI interview. Other AI marked "limited" | Upgrade wall ("need to upgrade to a paid plan") | Pro $29/mo, Lifetime $149 once | Unknown. The AI info page holds an unfilled placeholder | Universities only (Enterprise, $99/mo per 200 users) |
| Kickresume | "A limited number of uses", with no number. A 2022 press page said 5 credits | Not stated. A competitor's blog says the feature locks and asks for Premium (secondary) | $24/mo, $18/mo quarterly, $8/mo yearly. Paid users get credits each billing period | OpenAI and Anthropic (privacy recipients table). Marketing says "GPT-4.1" | Free Premium for up to 180 days through ISIC, ITIC or UNiDAYS |
| Enhancv | 7-day free plan. Its blog says the AI Assistant works up to 5 times in that period | Upgrade wall (implied) | "Starting from $16.50"/mo. Its own pages conflict on the exact price | OpenAI (privacy notice) | Institutional "Higher Education" offer only |
| Resume Worded | A subset of AI lines and a partial analysis. Reviews report 2 free AI rewrite credits (secondary). Pro has a fair-use cap of 250 uses a month | Locked report sections (upgrade wall) | $49/mo, $99/3 mo, $229/yr | OpenAI, Google Gemini, Anthropic (subprocessor list) | Universities prepay. Students claim access with a school email or code |
| Huntr | "A small number" of AI credits, plus 2 tailored resumes and 2 application packets | Upgrade wall: "a Huntr Pro subscription is necessary to continue using AI features" | $40/mo, $90/qtr, $160/6 mo | Unknown | Career centers buy Pro for students |
| Careerflow | 1 resume. Other AI tools are "N/A" on the free plan | Upgrade wall. "Unlimited" paid use is bounded by an unpublished rate limit | Premium $23.99/mo, Premium Plus $44.99/mo (also weekly to yearly) | "GPT-4" (FAQ only) | "Special pricing" for students (no amounts). University program |
| LinkedIn | Job Match and AI job search are free (secondary). Resume tips and profile writing need Premium. No AI caps stated | Upsell to Premium | Premium Career $39.99/mo or $239.88/yr | "Microsoft's Azure OpenAI services" given as an example | A one-time .edu promotion (12 months free) ended about 2026-03-01 |
| Handshake | All student AI is free, with no published caps. Each feature is gated by school | Feature missing if the school lacks access. Job search falls back to keyword and filter search | Free for students | OpenAI, Anthropic, Google Gemini (subprocessor list) | The whole product is for students |
| Indeed | Career Scout (AI career coach) is free. No caps stated | Not stated | Free for job seekers | Unknown for Career Scout. Indeed has used OpenAI models elsewhere | None |
| Big Interview | No free tier | Not stated | $39/30 days, $99/3 mo, $299 lifetime | "Third-party AI and LLM providers", not named | Mostly university-paid; free to students at those schools |
| VMock | University license only. Example: 10 resume uploads a year at Oregon State (secondary) | Not stated | No individual price found | Unknown | University-paid only |
| Yoodli | 5 lifetime sessions | Not stated | Pro $8/mo, Advanced $20/mo (billed yearly) | Unknown | None stated |

## Product notes

Each entry adds only what the table does not hold.

### Jobright

- The FAQ says "all features on Jobright.ai are free to use". Resume tailoring
  has "daily usage limits" and "a paid option for unlimited access"
  ([jobright.ai](https://jobright.ai/), read 2026-10-12 for KAN-182).
- There is no job-seeker pricing page: `/pricing` returns 404, and the nav
  link goes to the recruiter plan at $499/mo
  ([Orion page](https://jobright.ai/orion-copilot)).
- Orion: the page says "Ask Orion for FREE". It also asks "Is there a cost to
  use AI Orion?" but gives no answer. Reviews disagree on its free limit:
  - "unlimited" ([Careery](https://careery.pro/blog/ai-job-search/jobright-ai-review), secondary);
  - "a few Copilot interactions per day" ([Scoutify](https://scoutify.com/blog/jobright-review), secondary).
- Daily credit figures (secondary):
  [outapply](https://outapply.com/blog/jobright-ai-pricing),
  [jobity](https://jobity.io/blog/jobright-review). One review reports
  separate daily pools: 2 tailored resumes, 4 autofills, 2 cover letters and
  2 email lookups.
- Model: Section 6 of the
  [privacy notice](https://jobright.ai/legal/privacy) (updated 2026-06-15)
  names "OpenAI, Anthropic, Google Cloud AI and Amazon Web Services (AWS) AI".
  "Your input, output, and personal information will be shared with and
  processed by these AI Service Providers."
- Training: Jobright makes no general statement. Only Gmail data is excluded
  from training (Section 17).

### Simplify

- Free users "can view their Keywords Score and missing keywords". Tailoring,
  cover letters, AI answers and AI email are Simplify+ features
  ([help: Copilot](https://help.simplify.jobs/articles/9660493-using-copilot-with-simplify)).
- Prices, and "all plans include the same full suite":
  [help: What's included](https://help.simplify.jobs/articles/5623502-whats-included-in-simplify-features-and-pricing).
- Autopilot gives 20 credits a week. A credit is spent only when an
  application submits. "Credits you didn't use don't carry over." "There's no
  way to buy more credits yet." Meanwhile, users are told to save jobs or
  apply with Copilot
  ([help: Credits and failed applications](https://help.simplify.jobs/articles/4455305-credits-and-failed-applications)).
- Data ([privacy](https://simplify.jobs/privacy)): Simplify may use data,
  including "behavioral interaction signals", to train its own systems.
  Vendors may not "train or improve generalized models". It uses
  "enterprise, no-training, zero-data-retention" configurations where
  available. Email content, extension data and EEO data never train models.
  "We do not sell your personal information to AI companies."

### Teal

- Teal blocked direct reads (403). These facts come from snippets of its pages.
- Free credits are "non-renewable AI Generation credits" (snippet):
  - bullets: 10 on the [pricing page](https://www.tealhq.com/pricing), 5 in
    [help: Using AI Bullets](https://help.tealhq.com/en/articles/9519206-using-ai-bullets);
  - summaries: 2
    ([help: Professional Summary](https://help.tealhq.com/en/articles/9457697-using-ai-professional-summary));
  - achievements: 5 ([FAQ](https://help.tealhq.com/en/articles/9592114-frequently-asked-questions-faq)).
- A credit counter shows at the bottom left of the edit box.
- "We do not have a general free trial"
  ([help](https://help.tealhq.com/en/articles/9535168-is-there-a-teal-free-trial)).
- [Privacy policy](https://www.tealhq.com/privacy-policy): "We may use
  third-party AI service providers (such as OpenAI)". "Your career content may
  be used to improve our AI models and services in an anonymized and
  aggregated form."

### Rezi

- "Free Rezi accounts can generate up to 10 AI bullet points". After that,
  users "need to upgrade to a paid plan"
  ([docs: AI Bullet Points](https://www.rezi.ai/rezi-docs/ai-bullet-points)).
  The plan list is at
  [Subscription Plans](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained).
- May 2024: "AI Credits have been replaced with whole-number AI Generations".
  July 2026: a daily swipe limit on mobile job matching. October 2026: swipe
  quota insights ([changelog](https://www.rezi.ai/rezi-changelog)).
- Provider: the [AI LLM info page](https://www.rezi.ai/ai-llm-info) still reads
  "[insert AI framework / model]". The [legal page](https://www.rezi.ai/legal)
  names only Stripe. Training: unknown.

### Kickresume

- "Even with a free account, you get a limited number of uses." Premium gets
  "a substantially higher number of AI requests", and "credits are added to
  your account" at the start of each billing period
  ([AI Resume Writer](https://kickresume.com/ai-resume-writer)).
- The 2022 [press page](https://www.kickresume.com/en/press/ai-resume-cover-letter-writing/)
  gave free accounts 5 credits. A work-experience description cost 1 credit
  and a cover letter cost 3.
- Prices and the 14-day refund:
  [pricing](https://www.kickresume.com/en/pricing/). The page shows
  first-period discounts.
- [Privacy](https://www.kickresume.com/en/privacy/): the recipients table
  lists "OpenAI OpCo, LLC" and "Anthropic". Section 2.17: "we may train and
  develop our systems with user's strictly anonymised data", including
  generated documents.
- Students: free Premium for up to 180 days
  ([students](https://www.kickresume.com/en/students/)).

### Enhancv

- The free plan is "Valid for 7 days", with a maximum of 12 section items
  ([help](https://help.enhancv.com/en/articles/1208865-what-is-included-in-the-free-version)).
- AI can be used "up to five times" during that period
  ([blog](https://enhancv.com/blog/enhancv-vs-kickresume/)).
- Plans: [help: Pro plans](https://help.enhancv.com/en/articles/1195346-understanding-the-enhancv-pro-plans).
  The price widget on the pricing page showed "€NaN" when we read it.
- The [privacy notice](https://enhancv.com/privacy/) lists "AI Technologies:
  OpenAI", and HrFlow.ai for resume parsing. Training: unknown.

### Resume Worded

- [Terms](https://resumeworded.com/terms): "a subset of resume lines for free".
  Pro has a fair-use cap of "up to a maximum of 250 times per month".
  Universities "may offer our Services", and career staff can see uploads.
- Prices: [get-pro](https://resumeworded.com/get-pro).
- The [privacy page](https://resumeworded.com/privacy) gives the clearest AI
  disclosure in this set:
  - OpenAI powers "Magic Write" and cover letters.
  - Gemini provides "AI processing support".
  - Anthropic provides "additional AI processing support for increased
    reliability".
  - "Each provider is contractually obligated not to use the data transmitted
    via their API for training."

### Huntr

- Free plan and the at-limit message:
  [pricing](https://huntr.co/pricing). Prices:
  [help: Plan types](https://help.huntr.co/en/articles/10714568-plan-types-and-pricing).
- Career centers can buy Pro for students:
  [career-centers](https://huntr.co/career-centers).
- The [privacy policy](https://huntr.co/privacy) mentions "AI content
  creation" by third parties and names only Stripe.

### Careerflow

- Free versus Premium: [premium](https://www.careerflow.ai/premium) and
  [help](https://help.careerflow.ai/en/articles/10605570-free-vs-premium-access).
- Its AI usage policy says "Unlimited" means use within policy bounds. It
  allows "rate limiting, access restrictions, and/or payments"
  ([terms](https://careerflow.ai/terms)).
- The [FAQ](https://www.careerflow.ai/faq) says: "Our AI Resume Builder uses
  GPT-4", and data is "used only to power the features you use".
- The [privacy policy](https://careerflow.ai/privacy) names no AI provider and
  says nothing about training.
- Higher-ed program: [higher-ed](https://careerflow.ai/organizations/higher-ed).

### LinkedIn

- Premium Career price and its AI features:
  [premium.linkedin.com](https://premium.linkedin.com/careers/career).
- Resume tips are a "LinkedIn Premium feature"
  ([help a6813101](https://www.linkedin.com/help/linkedin/answer/a6813101)).
- Job Match has been free to all users since January 2025
  ([TechCrunch](https://techcrunch.com/2025/01/15/linkedin-ads-free-ai-tools-for-job-hunters-and-recruiters/), secondary).
- AI job search is rolling out globally, with 25M+ searches a week
  ([newsroom](https://news.linkedin.com/2026/Professional_Edge_Skills_Verified)).
- The model may be trained "by LinkedIn or another provider", for example
  "Microsoft's Azure OpenAI services". The "Data for Generative AI
  Improvement" setting is on by default in the US. Opting out does not undo
  past training. Messages, salary data and members under 18 are excluded
  ([help a5538339](https://www.linkedin.com/help/linkedin/answer/a5538339)).
- The one limit LinkedIn documents is not an AI limit. Its search limit
  resets monthly and shows no count
  ([help a526164](https://www.linkedin.com/help/linkedin/answer/a526164/commercial-use-limit-reset)).
- The .edu promotion:
  [Windows blog](https://blogs.windows.com/japan/2026/01/22/college-students-now-get-12-months-of-microsoft-365-premium-and-linkedin-premium-career-on-us/).

### Handshake

- The Resume Optimizer is "free to use… No subscription and no credit card
  needed" ([tool page](https://joinhandshake.com/tools/resume-optimizer/)).
- It depends on the school. It was live for about half of users on 2026-07-01
  ([help](https://support.joinhandshake.com/hc/en-us/articles/39294100852247-Resume-Optimizer-AI-powered-resume-helper), snippet).
- AI on job postings is opt-in. Keyword and filter search stays available.
  "Third-party AI providers are under contracts that prohibit using Handshake
  data to train their own models." Direct identifiers are removed before
  processing
  ([help](https://support.joinhandshake.com/hc/en-us/articles/38856960612631-About-AI-powered-features-in-Handshake-for-students), snippet).
- The [subprocessor list](https://trust.joinhandshake.com/subprocessors) names
  OpenAI, Anthropic, Google Cloud / Gemini, and Arize AI (model monitoring).
- "Handshake AI" is a different product. It pays students to label data for AI
  labs. It is not a student AI feature.

### Indeed

- Career Scout was announced on 2025-09-10
  ([release](https://www.indeed.com/news/releases/indeed-introduces-new-suite-of-hiring-products-career-scout-talent-scout-premium-sponsored-jobs-and-indeed-connect?co=US)).
  Indeed presents it inside "a free career resource hub"
  ([academy](https://www.indeed.com/job-search-services/academy)).
- The [terms](https://www.indeed.com/legal) (updated 2026-09-29) say: "we may
  use Indeed Job Seeker data to improve our services, including by
  developing, training, fine-tuning" AI models. No opt-out is offered except
  withholding demographic data.
- Indeed has used OpenAI GPT models since 2023 for "Invite to Apply"
  ([OpenAI customer story](https://openai.com/index/indeed/), snippet). We
  found no source that links OpenAI to Career Scout.

### Big Interview, VMock, Yoodli

- Big Interview:
  - prices: [pricing](https://www.biginterview.com/pricing);
  - "third-party artificial intelligence and large language model
    providers"; FERPA "school official" role; Student Privacy Pledge
    ([privacy](https://biginterview.com/privacy));
  - user content is never used for "AI-related research or training"
    ([support](https://support.biginterview.com/en/article/privacy-and-security-of-user-generated-video-and-audio-content-n7mnr3/)).
- VMock:
  - its own pages need JavaScript and could not be read;
  - Oregon State gives "10 resume uploads per year"
    ([OSU](https://career.oregonstate.edu/resumes-cvs-cover-letters/vmock-resume-tool), secondary).
- Yoodli:
  - 5 lifetime sessions ([pricing](https://yoodli.ai/pricing));
  - user data improves its AI unless the user opts out in settings
    ([privacy](https://yoodli.ai/privacy-policy)).

## Patterns WorkIt can copy with a $0 budget

Each pattern below is used by at least one product above.

1. **Give each feature its own small pool.** Teal, Jobright and Kickresume
   give each AI action its own cap or its own credit cost (a cover letter
   costs 3 credits at Kickresume). A WorkIt example: 2 Tailor runs, 20 Scout
   messages and 1 parse a day. A cheap action then cannot use up the quota of
   an expensive one.
2. **Reset each day, with no rollover.** Jobright resets free credits at
   midnight, and Simplify resets Autopilot each week. A daily reset spreads a
   fixed provider quota evenly across about 500 students. A lifetime cap
   (Teal, Rezi) does not, and it suits a paywall, which WorkIt does not have.
3. **Charge only for success.** Simplify spends an Autopilot credit only when
   the application submits. WorkIt can refund a credit when the model call
   fails or returns nothing usable.
4. **Show the count before the wall.** Teal shows a counter in the editor.
   LinkedIn's hidden search limit is the opposite: users hit it with no
   warning. WorkIt can show "2 of 3 Tailor runs left today" next to the button.
5. **Make the wall a wait, not a paywall.** At the limit, show the reset time
   and keep the non-AI path working: the experience bank, the manual resume
   editor, the keyword match and the Jobs page filters. Every product keeps its
   builder free. Handshake falls back from AI search to keyword search.
   Simplify suggests a manual action while credits refill.
6. **Do the cheap work without a model.** Simplify's free keyword score and
   Rezi's score run with no AI. WorkIt can compute keyword match and parse
   resumes deterministically first, and call the model only for the writing.
7. **Keep "unlimited" bounded.** Careerflow and Resume Worded cap even paid
   users through a fair-use clause (250 uses a month at Resume Worded). WorkIt
   needs a per-user ceiling plus a global daily ceiling, so a few heavy users
   cannot drain the shared quota.
8. **Spread the load over several providers.** Jobright, Resume Worded,
   Kickresume and Handshake each name two or more providers. Resume Worded
   says it uses Anthropic "for increased reliability". WorkIt can route to a
   second free tier (for example a local Ollama model) when the first one is
   exhausted.
9. **State the data rule plainly.** Resume Worded and Handshake say their
   providers may not train on user data. WorkIt should pick free-tier
   providers whose terms allow that promise, then say it in the privacy text.
   Some free tiers may use inputs for training, so check each provider's
   terms first.
10. **Let a sponsor pay later.** Handshake, Big Interview, VMock, Huntr and
    Resume Worded reach students through university-paid licenses. If WorkIt
    ever needs more quota, a career-center sponsor is the usual source.

## Gaps

- No product documents its at-limit screen in full. To see it, someone must
  sign in and use up a free allowance.
- Jobright's free limits come only from third-party reviews.
- Teal, Handshake support and VMock facts come from snippets, because those
  pages blocked direct reading.
- Enhancv's current price is unconfirmed: its own pages conflict.
