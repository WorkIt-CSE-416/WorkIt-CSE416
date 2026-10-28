---
type: values
summary: "one of their values, shown by one episode where the student acted on it"
company_link: same-kind
length: [80, 140]
match:
  - "\\bvalues?\\b"
  - "\\bmission\\b"
  - "principles?"
  - "work (environment|culture)"
  - "what motivates you to do what you do"
slots:
  - name: value
    required: true
    holds: exactly one of the company's values (or the mission), quoted from the company brief in their words, picked for the strongest true story
  - name: act
    required: true
    holds: one episode where the student acted on that value, told as their own acts, with a named tool, count or duration when the sources give one
  - name: result
    required: true
    holds: what came of it, or what others did with what the student made
  - name: tension
    required: false
    holds: what acting on it cost them or pulled against (a deadline, pressure to move on, a metric that said it was fine)
  - name: habit
    required: false
    holds: what the student does now because of it, stated as an action
  - name: lesson
    required: false
    holds: what the student took from it, specific to this episode; one clause at most
---

## What the reader is checking

That the student lives the value, shown by one thing the student did. Agreeing with the value, praising it or reciting it back reads as no answer.

- "simply inquiring as to someone's values is insufficient" (Oxide RFD 3, the company's own hiring process)
- Of "Honesty, and integrity, and decency" as a reason to join: "We think that any company should have that. [...] That is nowhere near enough." (Bryan Cantrill, Oxide CTO, E3)
- "What we want is story time. We want to hear about like when things didn't go great, did you run towards it or run away from it?" (Steve Tuck, Oxide CEO)
- "Anyone can tell us 'I set high standards for myself' [...] it's much more compelling to show us your values, motivation and character through the story you share." (Connecticut College admissions, B8)
- "focus on 'I' instead of 'we'" (Amazon, on its Leadership Principle answers, E21)

## Order

Name the value once, plainly, in the company's words, then the act (most of the words), the tension inside it if the plan backs one, then the result. A habit may follow the result. The strong models E21 and E22 never use the value's word at all, because the prompt names it; when the form asks them to pick one, name it in one plain clause and move on.

**Mission question** ("why does our mission resonate"): the mission is the reason behind their act, never the content. One concrete act from the sources that serves the same end, then its result.
**Tension question** ("a time two values pulled against each other"): name both values, the act that chose between them, and what happened (E25).
**Violation question** ("a time the value was violated"): what happened, what the student did about it, and the result (E25).

## Rules

Each is a yes/no check on the draft.

1. **Is exactly one value named, in the company's own words?** Pick the value with the strongest true story, not the headline one.
2. **Is it free of agreement and praise?** "your values of respecting the user [...] are values I place high emphasis on" (E11) and "Company's mission of 'insert mission statement' resonates with me" (E9) fail.
3. **Is the value one the company owns, not one "any company should have"?** Honesty and integrity offered as the reason fail (E3).
4. **Is the act theirs, in "I"?** A32's rejected draft wanted "a company/organization with a strong culture"; its admitted draft names a group its writer worked with.
5. **Does the story show this value, not a different one?** A technical win stretched to fit a value it does not show fails.
6. **Is every act concrete?** E22 names its acts ("established weekly cross-team syncs", "a shared dashboard"); E23's "a modern programming language and frameworks" names nothing.
7. **Does it end on the result, not a moral?** E22 ends on "the collaboration framework I established became the standard for future cross-team projects" and has no lesson. E23 ends on "the importance of continuous learning in our field", a line a stranger could write.
8. **Is every slot backed?** The value is quoted from the company brief; the act and result from the student's experience. With no tension in the sources, write none. If no story shows any listed value, the plan asks the student for the fact rather than stretching one.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase. No real tech applicant's values answer with a verdict exists; Amazon's are the employer's own models.

**E23 vs E22: employer's model, same Amazon page.**
- Weak: "I took initiative to learn a modern programming language and frameworks in my spare time. ... resulting in 30% faster development and the ability to add innovative features. The experience highlighted the importance of continuous learning in our field."
- Strong: "When our team's critical project fell behind schedule, I didn't wait for someone else to fix it. I mapped out the bottlenecks, identified that we were missing key input from another department, and took the initiative to establish weekly cross-team syncs. ... Not only did we get back on schedule within three weeks, but the collaboration framework I established became the standard for future cross-team projects."
- Why: the strong one opens on the value as an act, names each act, and stops at the result. The weak one names nothing and ends on a moral.

**A32: real applicant, rejected then admitted (Recurse Center).**
- Weak: "I want to be working for a company/organization with a strong culture and that values bringing out the best in all their employees."
- Strong: "I want to be building strong, supportive teams. Brian J. Brennan gave a talk at JS conf called 'Being Human' (link) [...] I've worked with organizations like 'Ladies Learning Code'"
- Why: the weak one claims the value; the strong one names it plainly and then shows where the writer acted on it.

**E11 vs E21: career-center model vs employer's model.**
- Weak: "I really feel that your values of respecting the user, the opportunity, and each other back up your mission statement" / "and those are values I place high emphasis on in both my personal and professional life."
- Strong: "While our technical metrics showed the feature was functioning correctly, I spent two days shadowing our customer service team and personally reviewed 100 customer feedback submissions. Despite pressure to move on to new projects, I advocated for and led a redesign of the feature. This resulted in a 40% reduction in related customer service tickets..."
- Why: the weak one recites the values back. The strong one shows one through a tension ("Despite pressure to move on"), counted effort and a counted result.
