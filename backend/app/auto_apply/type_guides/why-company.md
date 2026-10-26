---
type: why-company
summary: "why this company; one checkable fact about them, then the student's evidence"
company_link: same-kind
length: [70, 120]
match:
  - "^why (?!do you think|are you (a|the) )"
  - "why .*(work|join|intern|interning|apply|applied) (at|for|with|us|the team)"
  - "why .*interested in (working|joining|interning|an internship|this|the|[a-z0-9])"
  - "(excites?|interests?|drew|draws|attracts?|stood out|stands? out|caught your attention|motivat\\w*|prompted|sparked)"
  - "what do you know about"
  - "how .* makes money"
  - "your (interest|understanding) (in|of)"
slots:
  - name: company-fact
    required: true
    holds: one checkable thing of theirs from the company brief or the posting, at the level of a product, a technical choice, an engineering post or a launch; never the mission or the values
  - name: own-match
    required: true
    holds: the same kind of thing from their own work (same domain, constraint or user), with a size or count when the sources give one
  - name: gap
    required: false
    holds: what the student has not had that they have (a scale, a kind of user, a problem the student has only met small)
  - name: contribution
    required: false
    holds: the work the student would do on it there, stated modestly
---

## What the reader is checking

That the student looked at this company, not companies like it, and that their own work backs the interest. A mission or values line is read as no answer.

- "I want to work for Oxide because it's a principled company. Honesty, and integrity, and decency." drew: "That is nowhere near enough. That is nowhere near enough. I need to know, we need to know that the mission speaks to you, that the role speaks to you." (Bryan Cantrill, Oxide CTO, who reads the materials, E3)
- "I reject any answer that's not somewhat unique to our business. 'You could do that anywhere, is there anything specific to this place?'" (msg, an interviewer on HN, E8)
- "Did the candidate do research and hone in on what specifically excites them about this opportunity in the short answer questions? [...] Can they back it up beyond the buzzwords?" (Clare Kessi, Senior Recruiter, Palantir)
- "But WHAT is this sentence SAYING? ... I like your company because the systems scale - how is this unique?" (Allison Gelles, CUNY coach, formerly Google university recruiting, E2)

## Order

The company fact comes first, in one sentence, then their matching work, then the gap or contribution if the plan backs one. Keep the company detail to about a quarter of the words. Under 100 words, use one fact and one match.

**No same-kind match:** if no project of theirs is the same kind of problem as the fact, do not force a link. State the fact and what makes it hard or new, then let their strongest evidence stand on its own. Lerner on a stretched link: "maybe skip it" (D4).
**Multi-part question** ("why us and what would you build"): answer every part. D1 was rejected for skipping one (html5cat: "which you conveniently skipped").

## Rules

Each is a yes/no check on the draft.

1. **Does the first sentence carry the company fact?** The strong E5 opens on "how your platform team rebuilt the deploy pipeline"; D2 opens on a footnote in the CEO's article.
2. **Is the fact below the level of the mission?** A product, a writeup, a technical choice. E3, E9 and E11 recite the mission or values and fail; for a prestige company "Repeating it back signals nothing" (E7).
3. **Does every company sentence fail the swap test?** If it still reads true with a competitor's name, cut it. E4's "I love your culture, the mission speaks to me, and I want to grow" "applies equally to Google, a Series A startup, and a regional bank".
4. **Is their match the same kind of problem?** E5: a build-time writeup "hit a problem I lived at my last job". A shared buzzword or job title is not a match (E9: "my experience in 'insert their current job.'").
5. **Is nothing only about what the student gets?** Growth, learning, pay or "a great stepping stone" fail (E4, E10). A gap is allowed when it names the specific thing the student lacks: "a scale I've only read about" (E6).
6. **Does every feeling word sit beside a fact?** "passionate about making societal impacts" (E1) and "my passion for well-structured, efficient code" (E2) carry nothing alone.
7. **Is every company name, product and team exactly as in the brief?** One wrong company fact costs more than all the specificity gains.
8. **Is every slot backed?** The company fact is quoted from the company brief or the posting; their match is quoted from the student's experience. With no gap or contribution in the sources, end on their match.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**E4 -> E5: coach model, same author, same question.**
- Weak: "I love your culture, the mission speaks to me, and I want to grow"
- Strong: "I've been following how your platform team rebuilt the deploy pipeline." / "That writeup on cutting build times from twelve minutes to under two hit a problem I lived at my last job," / "I shipped internal tooling that three other teams picked up, and I want more of that, not less."
- Why: the weak one is three swappable clauses about the writer. The strong one fills company-fact (a team's writeup), own-match (the same problem) and contribution, with a checkable count.

**A29 -> A30: real applicant, rejected then admitted (Recurse Center).**
- Weak: "For the past 4 years I've been doing a lot of work with software, but 90% of it driven by the organizations and groups I was working with. The Recurse Center would give me a place to focus on my own projects..."
- Strong: "Because for the last 5 months I've been working on projects in awful environments. I've been in hostels where people have demanded to know why I was coding so much instead of partying with them. ... My most productive hours are when I'm surrounded by passionate, like-minded people."
- Why: the weak one admits the opposite of what the place selects for. The strong one opens on a fact about the writer's work that proves the fit, then names the one thing the place offers.

**E2 vs D2: AI draft judged weak vs real applicant judged good by the CEO.**
- Weak: "I am particularly drawn to your company's emphasis on building high-quality, scalable systems and believe my passion for well-structured, efficient code aligns with your development principles."
- Strong: "In your recent article about building technical recruiting products, you included a footnote about non-traditional candidates that really resonated with me. I consider myself one of those non-traditional candidates..."
- Why: the strong one's company fact is footnote-level, so only a reader could write it, and the writer's match is one true fact of the same kind.
