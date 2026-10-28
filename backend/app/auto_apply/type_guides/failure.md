---
type: failure
summary: "a real setback, the student's part in it, the fix, what they do differently now (also a challenge, a disagreement, initiative)"
company_link: never
length: [120, 160]
match:
  - "\\bfail(ed|ure)?\\b"
  - "mistake"
  - "challenging (bug|problem|situation)|(a|biggest|hardest|toughest) challenge|overc[oa]me"
  - "\\bbug\\b"
  - "(didn't|did not|didn’t) work"
  - "setback|obstacle|struggle"
  - "disagree|conflict"
  - "changed your mind"
  - "lessons? (learned|you learned)"
  - "a time (when )?you"
  - "initiative|perseverance|resilien"
  - "lead a team|led a team"
  - "complete this sentence"
slots:
  - name: miss
    required: true
    holds: what went wrong, with its size (a number, a date, a deadline) when the sources give one
  - name: cost
    required: true
    holds: who or what it hurt (a teammate's testing, a release date, a demo, a score)
  - name: own-cause
    required: true
    holds: the specific thing the student did or didn't do that caused it
  - name: response
    required: true
    holds: what the student did once the student found it (who the student told, how the student fixed or contained it)
  - name: habit
    required: true
    holds: what the student does differently since, stated as an action the student takes
  - name: habit-held
    required: false
    holds: a later time the student used that habit, and what happened
  - name: feeling
    required: false
    holds: how it felt, in their own words; one short clause at most
---

## What the reader is checking

That the student can name a real miss, their own part in it, and what the student changed. A disguised strength or a story where someone else is at fault ends the read.

- "If the story is too polished or the 'failure' is obviously a disguised success, it usually reads as low self-awareness." (Hello Interview rubric, S5)
- "Successful failure stories own a specific thing you did or didn't do, even if the larger context was complicated." (techinterview.org, S7)
- "You have to have failure, otherwise you don't have humility, right?" and, in the written notes, "dont sugar coat". (interviewing.io interviewer, S9)
- "Numerous people with over a decade claim perfect records, frequently blaming all those around them as having failed. It's been a real easy way to eliminate candidates." (ismarc, describing his team's interview loop on HN)

## Order

The miss comes first, in one or two sentences, then the cost, the cause the student owns, their response and the habit. Setup is one clause. An interviewer marked down a real candidate for the run-up before the mistake: "Cut first part, focus on unique problems" (S15).

**Hardest bug:** the symptom and why it was hard to see; what the student tried and how each was ruled out; the root cause in one plain sentence; the fix and how the student checked it. The own-cause slot can be the assumption the student made that hid the bug.
**Disagreement:** the two positions, stated fairly; how the student raised it; what settled it (data, a test, a prototype); what happened.
**Sentence stem** ("complete this sentence..."): start with the exact stem.

## Rules

Each is a yes/no check on the draft.

1. **Is the miss in the first two sentences?** Readers decide early, and the judge in S15 asked for exactly this.
2. **Is a real consequence named?** "I don't think it caused a major issue" (S5, POOR) reads as no failure at all.
3. **Does one sentence own a specific act or omission?** "I gave an aggressive estimate and didn't ask many questions about edge cases" (S5, GREAT) passes. Blaming requirements, a manager or "the team" fails: "there wasn't enough clarity at the beginning" (S6, POOR); "There was nothing I could do" (Spolsky's example of a bad answer).
4. **Is it free of any phrase that sounds like covering themselves?** An interviewer flagged "leaving a paper trail" because it suggests "gathering information where you can assign blame to somebody else" (S15).
5. **Does it avoid defending the original call?** "I still think the implementation itself was solid" (S6, POOR) undoes the ownership.
6. **Is the habit an action, not a slogan?** "Writing down assumptions before I began coding and checking them with whoever would use the work" (S5, GREAT) passes. "Communicate more", "be more careful", "test better" and "projects are unpredictable" all fail (S5, S6, S7).
7. **Is it a real failure?** Working too hard, caring too much, and a typo in a PR all fail (S7).
8. **Does it end on an event, not a moral?** S5's GREAT answer ends on "over the next few tasks I had fewer late surprises" and has no lesson sentence at all. A lesson sentence is allowed only right after the habit-held slot that proves it (S7).
9. **Is every slot backed?** Write only the slots the plan backs. With no habit-held line in the sources, end on the habit. With no feeling in the sources, write none: the strong examples win without one.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**S5: the same prompt, the same judge.** "Tell me about a time you failed."
- Weak: "One time I failed because a task took longer than expected. The requirements changed a bit during the week, so I just kept working through it until it was done. I don't think it caused a major issue because we still shipped, and it showed me that sometimes projects are unpredictable. Since then I've tried to work faster when things like that happen."
- Strong: "In my first few months, I was asked to add a small reporting feature that another teammate needed for testing. I thought it was straightforward, so I gave an aggressive estimate and didn't ask many questions about edge cases. A day before handoff, I realized I had missed an important data condition and the output was wrong, which delayed their testing. I told my lead right away, walked through what I had misunderstood, and got help narrowing the fix so we could deliver the core case first and follow with the edge case the next day. After that, I started writing down assumptions before I began coding and checking them with whoever would use the work. That made my estimates more realistic, and over the next few tasks I had fewer late surprises."
- Why: the weak one blames the requirements, denies a cost, and its change ("work faster") isn't one. The strong one fills every slot (miss, cost "delayed their testing", own cause, response, habit, habit held) and has no feeling or lesson sentence.

**S6: a school project vs an internship project, the same judge.**
- Weak: "...The requirements changed a few times, so the final version came in later than planned and didn't match exactly what the reviewer wanted. I still think the implementation itself was solid, but there wasn't enough clarity at the beginning. In situations like that, I usually just keep moving and adjust as new information comes in."
- Strong: "...I assumed the data formats matched closely enough and built most of the feature before asking anyone to review the approach. During testing, we found that one source handled missing values very differently, and my code produced misleading results, which delayed the release by a few days. I told my mentor right away, helped narrow the issue, and rebuilt that part with a simpler mapping and a few targeted tests around the cases I had missed..."
- Why: the strong one's cause is technical and checkable ("one source handled missing values very differently"). The weak one defends itself and changes nothing.

**S7: one author's list of failing lines, against his strong story.** Failing lines: "I worked too hard once and got burned out." "My manager assigned me an impossible task." "I learned to communicate more." The strong story states the miss as two numbers ("I'd estimated 8 weeks; it took 14"), names the cost to others ("two downstream teams to push their work back"), owns the cause in one sentence ("I didn't surface the risk early"), and proves the habit with a later project where the same trigger got the new response.
