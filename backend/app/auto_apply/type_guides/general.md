---
type: general
summary: "the fallback for a question that fits none of the others"
company_link: never
length: [60, 120]
match: []
slots:
  - name: answer
    required: true
    holds: the direct answer to the exact question, in plain words (the thing, the choice, what the student would do)
  - name: episode
    required: true
    holds: one backed episode or fact from the sources that supports the answer, with their own part in it
  - name: result
    required: false
    holds: what came of the episode, with its number when the sources give one
---

## What the reader is checking

That the student answered the exact question asked, every part of it, and that one real fact stands behind the answer. This guide is the fallback: first check whether the question is really a nearby type (a project, a failure, an opinion, why this company) and use that guide if so.

- "The best answers are the most matter of fact." (Paul Graham, YC)
- "your email covers things you did, but nothing about 'why Puma' or other simple questions we ask [...] our HN post includes 'what you'd like to build next?' which you conveniently skipped." (html5cat, hiring at Puma, D1)
- On "Yes!" vs "Yes.": "You probably have a million of these to read, so I'll keep it brief." (Ryan Treen, on his rejected and admitted Recurse Center drafts, A33)
- "Don't answer the 'fascinating thing' question with something you learned about yourself. This doesn't demonstrate intellectual curiosity, which is what this question is there to measure." (Recurse Center, A34)

## Order

The answer in the first sentence, then the episode (most of the words), then the result if the sources give one. End on the episode or the result.

**Multi-part:** one or two sentences per part, in the order asked. Each part gets its own answer; one episode may serve several parts.
**Scenario** ("you notice a coworker doing X; what do you do?"): what the student would do first, then why, then one real time the student did something like it as the episode.
**Yes/no or factual** ("have you worked professionally?"): the bare answer first ("Yes."), then the backing facts in the form's own format.

## Rules

Each is a yes/no check on the draft.

1. **Does the first sentence answer the exact question, not a nearby easier one?** "Stripe Atlas" answered "how did you hear" when the question was why YC (A27). Both Recurse Center "fascinating thing" drafts answered with something about the writer, which RC's rule fails (A34).
2. **Is every part answered, in order?** Puma rejected a relevant applicant for skipping one part of a two-part ask (D1).
3. **Is there one episode or fact, not traits?** "Jordan is an exceptionally dedicated person who gives 100% effort" fails PG's test: a "generic claim carries no weight" (A2).
4. **Does it match the length and format asked?** The admitted "Yes." plus four bullets of "duration + what + (company)" beat the rejected "Yes!" (A33). Matching the asked format "is itself a signal" (deep-examples Part 3).
5. **Does it end on a fact, not a moral?** "Traveling light and cheaply is all about hacking systems [...] I freaking love that stuff" dilutes the 12-minute plane story before it (A15).
6. **Is there an answer, when something small and real exists?** "N/A" to "something surprising you discovered" is the weak YC answer (A20).
7. **Is every slot backed?** Write only the slots the plan backs. With no result in the sources, end on the episode. With no episode in the sources, the required slot asks the student; never supply a plausible one.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A33: the same writer, rejected then admitted (real applicant, Recurse Center).** "Have you worked professionally as a programmer?"
- Weak: "Yes!"
- Strong: "Yes." then "- 4 month internship testing mobile apps (Xtreme Labs). - 3 month internship testing the Microsoft Word Web App (Microsoft). - 12 month internship doing web development - Rails/Javascript (Pivotal Labs) [...]"
- Why: the strong one gives the plain answer, then backs it with facts in a short, scannable form. The weak one offers enthusiasm in place of reasons.

**A27 vs A25: the same question (real applicants, YC accepted; A27 weak by PG's rule).** "What convinced you to apply to YC?"
- Weak: "Stripe Atlas".
- Strong: "The first thing Parker said when Greg told him what we're building was 'Apply to YC!' We want to rapidly accelerate our growth and saw first-hand the value YC provides to early stage companies during our time working at YC companies, including at Rippling W17 and Optimizely W10. [...]"
- Why: the weak one answers a nearby question ("how did you hear"). The strong one answers the one asked, with named places it saw first-hand.
