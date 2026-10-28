---
type: not-on-resume
summary: "one new, rare, checkable thing the resume does not show"
company_link: never
length: [50, 90]
match:
  - "(not|isn't|isn’t|won't|can't|cannot) (on|see on|find on|in) your (resume|cv)"
  - "not on your (resume|cv)"
  - "exceptional|excellence|outstanding"
  - "top 0\\.01|superpower"
  - "teach us|learn from you|taught yourself"
  - "makes you, you|what makes you stand out"
  - "^(second|third|fourth) example"
  - "something (surprising|interesting) about you"
slots:
  - name: thing
    required: true
    holds: the one thing, named concretely, that is not on the resume or in another answer on this form
  - name: act
    required: true
    holds: what the student did, as a checkable event or activity, not a trait
  - name: method
    required: true
    holds: how the student did it or the reasoning behind it (the mechanism, the trick, the calculation)
  - name: result
    required: true
    holds: what came of it (a number, an outcome, a thing that now works)
  - name: rarity
    required: false
    holds: a fact that makes it rare to a non-specialist (odds, selectivity, a baseline, time)
  - name: tie-back
    required: false
    holds: how it shows in their work, one clause at most, from the sources
---

## What the reader is checking

One new, specific thing the student did, told so the reasoning shows. It need not be technical or tied to the job; a trait, a fun fact or a resume line fails.

- "This kind of generic claim carries no weight. A single, specific example would be much more convincing." and "It doesn't matter if it's not the sort of thing you'd put on a resume." (Paul Graham, A2)
- "if the answer to this question is good enough, it will make me go back and take a second look at an application that otherwise seemed unpromising." (Paul Graham on YC's hack question, A11-A15)
- "Avoid treating this like a trivia prompt or a second resume walkthrough." (Hello Interview rubric, S11)
- "Anyone can tell us 'I set high standards for myself,' ... But it's much more compelling to show us your values, motivation and character through the story you share." (Connecticut College admissions, B8)

## Order

The thing and the act in sentence one, then the method, then the result. Rarity, if the sources hold it, sits beside the act. A13 does all four in four sentences: the broken button, the app, the proximity sensor, "saved me $600". End on the result.

**Exceptional ability as bullets** (when the form asks for bullets or examples): each item is one hard thing made to work, its number and why it was hard, one or two lines each; three at most unless asked.
**Teach us something:** the surprising claim first, the mechanism in plain words with one example, and how the student came to know it (the student built, measured or broke something). No moral.

## Rules

Each is a yes/no check on the draft.

1. **Is the thing named concretely in sentence one?** "My iPhone's lock button was broken..." (A13); "In high school, I received a ticket for not stopping at a stop sign..." (A14).
2. **Is it absent from the resume, even reworded, and from other answers on this form?** A resume line in prose is "a second resume walkthrough" (S11). If every backed fact is already on the resume, the thing slot is asked of the student.
3. **Is it an event someone could check, not a trait?** S11 POOR "I am very competitive" fails; so does "captain of my high school soccer team, and that taught me leadership" (S11 one-liner).
4. **Does the reasoning show?** A11: "Ergo, we could afford to pay 200 college students $100 if it yielded us 1 great full-time engineering hire." A14: "proved to the judge, mathematically". An idle preference with no doing in it fails: the coffee-shop line (S11).
5. **Is a small story allowed?** Yes, when the method shows. A13 and A14 are about a phone button and a ticket, and both are rated strong.
6. **Does it end on the result, with no moral or trait claim?** A14 ends "The ticket was thrown out." A15 ends "I freaking love that stuff" and loses its strong specifics; B9 ends "I always go the extra mile".
7. **Is there no tie back to the job, or only one clause?** The written-form records win without one (A11-A14, B9, B10). Follow them over the interview rubric in S11 that asks for "a quiet professional payoff". A tie-back that claims a trait fails: "I will work longer than other people" (S11 POOR).
8. **Is the tone matter of fact, with no undersell and nothing childish?** "Not impressive but fun" (S12); HN readers marked down "fat little boy" as "childish" (S13).
9. **Is every slot backed?** Write only the slots the plan backs. With no rarity line, let the result carry the size. With no tie-back in the sources, write none.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A14 vs the S11 coffee-shop line: unrelated to work, reasoned vs idle (real applicant, YC accepted; coach-rated bad).**
- Weak: "Honestly, people are usually surprised that I really like trying new coffee shops. I make a list and rate them, so I guess I'm pretty into that."
- Strong: "In high school, I received a ticket for not stopping at a stop sign before the intersection. I took pictures from various distances and proved to the judge, mathematically, that it would have been impossible to stop earlier than I did. The ticket was thrown out."
- Why: neither touches the job. The strong one has an act, a method and a result; the weak one has a preference and nothing the writer did.

**A15: one answer, strong specifics then a weak ending (real applicant, YC accepted).**
- Strong part: "In Belize, I once managed to talk my way onto a plane that departed 12 minutes after I arrived at the airport."
- Weak part: "Traveling light and cheaply is all about hacking systems, finding work-arounds, turning strangers into allies and not giving up no matter how zany things get. I freaking love that stuff."
- Why: the 12-minute plane story would have been enough alone. The ending turns it into a moral and a trait claim.

**A11: rarity and reasoning in numbers (real applicant, YC accepted).**
- "...Recruitment costs per engineer were upwards of $20k, yet $100 is a lot of money to a college student. Ergo, we could afford to pay 200 college students $100 if it yielded us 1 great full-time engineering hire... For a total of $70k, we were able to hire 7 great engineers..."
- Why: the $20k baseline makes the result legible to anyone, and the reader does the math. Compare S11 POOR, a trait whose payoff is a claim: "It is probably one of the main reasons I do well."
