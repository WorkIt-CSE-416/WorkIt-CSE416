---
type: ai-tools
summary: "how the student directs and checks AI tools on real work, and where they do not use them"
company_link: never
length: [80, 130]
match:
  - "\\bai\\b[- ](tools?|technolog\\w*|setup|assist\\w*|specific)"
  - "(use|using|leverage) (agentic )?ai\\b"
  - "(how|way) (has|have) ai"
  - "ai (has|have) (improved|changed|shown up)"
  - "coding agent|copilot|claude code|chatgpt|llm tools?"
  - "with (claude|another ai tool)"
  - "single prompt"
slots:
  - name: use
    required: true
    holds: the tool, the named project, and the part of the work the student used it for
  - name: check
    required: true
    holds: how the student checked its output on that work (tests, reading the diff, running it on hardware, comparing to the docs)
  - name: caught
    required: false
    holds: a time its output was wrong and how the student noticed
  - name: new-check
    required: false
    holds: the check the student runs now because of that time, stated as an action
  - name: kept-decision
    required: false
    holds: a decision the student kept for themselves, or work the student does without it, and why
  - name: effect
    required: false
    holds: what changed, with a number only if it was timed or counted
---

## What the reader is checking

That the student uses AI on real work and can say how the student checked what it produced. Readers disagree on how much to delegate; every one of them asks how the output was verified.

- "AI makes generating solutions easier, but it also makes validating those solutions harder. That validation skill is what _actually_ matters now." (Jemaclus, hiring-side comment on HN, ai-tools reader quotes)
- "Blind acceptance is the fastest way to fail." and "Around 20 percent of the candidates we interviewed were unable to explain how their solutions worked, only that they did." (Brian Jenney, IEEE Spectrum, O7)
- "AI tools produce convincing output that is subtly wrong. As a result, verification has become one of the strongest signals" (Cerebras, D10)
- Asked for a time AI was confidently wrong, "That hasn't really happened to me." is "the reddest flag I know" (Mat Banik, reporting interviews, O2)
- "You can use AI tools, but you still put your name on the PR." (Thawar, Shopify, ai-tools reader quotes)

## Order

The use in sentence one, then the check, which gets the most words. If the sources hold a time it was wrong, tell it next and end on the check the student added. A kept decision and a measured effect follow only if backed.

**A tools list** ("which AI tools are you comfortable with"): 25-60 words, two to four tools, each with the job the student did with it and how the student checked it.
**An evaluation question** ("how do you judge AI output"): their checks in order, each tied to a project.

## Rules

Each is a yes/no check on the draft.

1. **Does it say concretely how the student checked the output?** This is the one rule that holds across readers who disagree on everything else (O5, O6). A named check on named work passes. "I never push AI-generated code without thorough testing and manual review" (O4) fails: an "always" claim with no episode.
2. **Does it name a project and a task, not a reason?** O3 strong: "I'll have Claude generate three different approaches in twenty minutes", then the human picks. "I use it to be more efficient." and "Everyone's using it now, so I figured I should too." fail (O3).
3. **Does a wrong-output story come from the sources?** The strongest answers have one (O2: an invented tax regulation, "I almost sent it to the client"). With none in the sources, describe the check and leave the episode out. Never supply a plausible one, and never deny the premise (O2 weak B).
4. **Does that story end in a changed check, not a lesson about AI?** O2 strong ends "Now I fact-check every regulatory reference, even when I'm ninety percent sure it's right." Zapier's "I've learned it speeds up analysis but can miss nuances" (O1) is the soft version.
5. **Does it take no side on how much to delegate?** One hiring manager is "deeply uncomfortable" with candidates who "aren't writing much code themselves anymore" (O5); another rejected a candidate because "I wrote too much code myself" (O6). Show regular use plus the check. Never frame the check as distrust of the tool, and never claim the tool does the work.
6. **Could the student explain every line that ships?** Jenney's failing candidate met "Can you explain what the first line of your solution is doing?" with silence (O7). A kept-decision line ("Why did I accept certain suggestions? Why did I reject others?", O7) shows this when the sources back it.
7. **Is every number timed or counted?** "caught 30% more potential bugs" and "twice as many" (O4) are estimates; leave them out.
8. **Are there at most two tools, each with a job?** "I use ChatGPT, Claude, and Gemini regularly for my work." fails (O4 pair 1). Canva names the "AI Showcase" as a weak pattern (D10).
9. **Is every slot backed?** Write only the slots the plan backs. With no wrong-output time, no new check and no kept decision in the sources, the answer is the use and the check, told with their details.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**O2: the same question, real candidates (quoted second-hand by an author reporting interviews).** "Tell me about a time AI gave you a confidently wrong answer. What did you do next?"
- Weak: "I mean, I usually just regenerate until it gives me something usable." / "That hasn't really happened to me."
- Strong (the setup is the author's paraphrase: a financial model Claude generated had invented a tax regulation): "I almost sent it to the client ... Now I fact-check every regulatory reference, even when I'm ninety percent sure it's right."
- Why: the strong one names the artifact, the exact error, the near-cost and the standing check that followed. It states no lesson about AI.

**O4 pair 2: no check vs a check (coach model).**
- Weak: "I use AI to research industry trends and incorporate those findings into my reports."
- Strong: "I use AI to identify potential industry trends quickly, but I always verify claims through original sources before including them in client-facing materials."
- Why: the only difference is the check. Even the strong one is weak by rule 1, since "always" stands in for an episode; ours names the project and the check.

**O1: Capable vs Adoptive (employer's model, Zapier's rubric).**
- Capable: "I've used AI to automate recurring data entry tasks, which saves me time in my daily work. I haven't explored more advanced uses yet, but it's been helpful."
- Adoptive: "I consistently use AI to forecast sales trends, which helps us adjust inventory planning. Over time, I've improved data inputs to address gaps in context and accuracy."
- Why: the step up is a limit found in the output and a change made because of it.
