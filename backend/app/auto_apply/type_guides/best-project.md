---
type: best-project
summary: "the student's strongest project: the hard part, their decisions, the result"
company_link: never
length: [80, 120]
match:
  - "project"
  - "(proud|proudest)"
  - "accomplish(ed|ment|ments)"
  - "achieve(d|ment)"
  - "(something|thing|one thing|what) (you('ve| have)?|did you) (built|build|shipped|made|put into the world|led|owned|worked on)"
  - "(built|shipped|owned|led) .*end[- ]to[- ]end"
  - "you('ve| have)? (personally )?(built|shipped|completed|delivered|owned)"
  - "impressive|phd research"
  - "most (impressive|technically|complex|ambitious|significant|exciting|interesting)"
  - "highlight reel|technical artifact|best represents your work"
  - "your favorite (thing|work|personal)"
slots:
  - name: project
    required: true
    holds: what the student built, for whom, and what it does, in plain words
  - name: own-part
    required: true
    holds: the parts that were theirs alone (what the student wrote, owned or decided), or that the student built it alone
  - name: hard-part
    required: true
    holds: the specific obstacle the student hit (a bug, a hardware or timing limit, a data fact), not the size of the work
  - name: decision
    required: true
    holds: one engineering choice the student made, with the option the student rejected or the reason
  - name: effect
    required: true
    holds: what changed because of it (a number with its baseline, a named user effect, a result, or a link)
  - name: limit
    required: false
    holds: an honest limit on the result (what it did not do, what is still unproven)
  - name: why
    required: asked
    holds: the real reason the student picked or cares about it, in the sources; used only when the question asks why
---

## What the reader is checking

What the student personally drove, what made it hard, the choice the student made, and what changed. Size alone earns nothing.

- "Pride without outcomes is weak signal. Explain what was hard, what you personally drove, and what changed because of the work." (Hello Interview rubric, S1)
- "You do not get much credit for simply naming a project with impressive scale." and "Many candidates over-focus on the build and under-explain the decisions." (Hello Interview rubric, S2 and S1)
- "good story selection. However, see if you can add some technical aspects to your story more" (interviewing.io interviewer, candidate not advanced, S3)
- "I have rejected candidates because when they talked about their previous project, they couldn't explain it in terms that a normal person could understand." (Joel Spolsky, story-facing.md reader quotes)
- "It's not the type of achievement that matters so much as the magnitude" (Paul Graham, A2)

## Order

Project and its effect in sentence one, then their part in one clause, the hard part, the decision, and the effect in full. A limit, if the sources hold one, sits beside the effect. The project sentence is plain and matter of fact: "CanadaKaz designed Canada's Startup Visa." (A5).

**Two items** ("top two", "two strongest"): two compact stories, each led by its strongest fact, the stronger one first, showing different strengths. S13 put a junior-high olympiad in front of a "from 10 hours to 1 hour" result and buried it.
**Favorite ... and why:** the why is its own sentence, from the why slot. With no backing, it is asked of the student.

## Rules

Each is a yes/no check on the draft.

1. **Does sentence one name the project and what it did?** "The best answers are the most matter of fact" (PG, quoted in S12). A5 and S13 Gordon ("I built new ranking system") lead with the thing.
2. **Is the hard part a found obstacle, not volume, speed or scale?** S2 GREAT: "the data from one service was delayed and made the page misleading". S2 POOR fails: "there were a lot of fields, and I had to move pretty quickly".
3. **Is there a sentence that says which parts were theirs?** S1 GREAT: "My lead helped me narrow the scope, and I owned the investigation, the code change in one service, and the testing plan". Spolsky's test for team work is "So what did you do?"
4. **Is at least one engineering decision shown with its reason?** S2 GREAT "added a clearer freshness indicator rather than pretending the numbers were real-time" passes. A scoping talk with a manager does not count as the decision (S3, not advanced).
5. **Is the effect a number with a baseline, a named user effect, or a link?** S13 Gordon "from 10 hours to 1 hour"; S1 "support tickets on that issue dropped". "Shipped on time", "successful" and "people were happy" fail (S1 rubric's bad lines; A8). No number is needed if the change is named: "You do not need perfect metrics, but you should explain what improved and who benefited" (S1).
6. **Does it end on a fact, not a trait or a feeling?** S2 POOR ends "I think it showed I can handle pressure and deliver"; A8 opens "I am passionate about". S1 GREAT's closing "It felt like..." adds nothing; the answer stands without it.
7. **Is it free of framing that tells the reader how to feel?** "Not impressive but fun" (S12) undersells; "doubly impressive" (A9) oversells.
8. **Could a reader outside the field follow every sentence?** Spolsky rejected candidates who could not. Explain a term in a clause or cut it.
9. **Is every slot backed?** Write only the slots the plan backs. A limit only when the sources state one ("it was about break-even", A7). No lesson sentence: A5, A6, A7 and S13 Gordon have none and are the strongest.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**S2: the same prompt, the same judge (coach model).** "Tell me about your most challenging project."
- Weak: "My most challenging project was adding a reporting page to our application. It was challenging because there were a lot of fields, and I had to move pretty quickly to get it done that sprint. I mostly followed the existing patterns in the codebase and asked my teammate whenever something was unclear, so it ended up working out fine. The page shipped on time, and I think it showed I can handle pressure and deliver."
- Strong: "...I started by meeting with one support teammate, writing down the exact questions they needed the dashboard to answer, and then I built a very small first version so I could confirm I was solving the right problem. Partway through, I realized the data from one service was delayed and made the page misleading, so I paused, traced where that lag was coming from, and added a clearer freshness indicator rather than pretending the numbers were real-time. We shipped the tool and the support team started using it daily..."
- Why: the weak one's hard part is volume, its decisions belong to others, and it ends on a trait. The strong one has a found obstacle, a decision with the option it rejected, and a user effect.

**S1: effect on users vs tidy code (coach model).** "What project are you most proud of?"
- Weak: "...I refactored it to be much easier to read and broke some of the functions into smaller pieces. It didn't really change the product, but the code looked a lot better afterward and I enjoy that kind of work. My manager was happy that I took initiative and handled it on my own."
- Strong: "...New users were sometimes getting stuck after email verification, and support had a manual workaround, but no one had isolated the bug yet. My lead helped me narrow the scope, and I owned the investigation, the code change in one service, and the testing plan for the edge cases I found... after we shipped it, support tickets on that issue dropped and the team stopped revisiting the same problem every release."
- Why: the weak one's proof is a feeling and a manager's mood. The strong one fences the writer's part and names a change someone could check.

**A6 and S13: the compact real-applicant form (real applicants; YC accepted, YC rejected).**
- A6: "owned IndexedDB (the emerging w3c standard for storing data in a browser) within Chrome; edited the spec, worked closely with Mozilla and Microsoft on the design, and wrote most of the initial implementation in Chrome/WebKit..."
- S13 Gordon: "While at IMDB, I built new ranking system where I reduced the rank generation time from 10 hours to 1 hour using Hadoop and Amazon Elastic Map Reduce."
- Why: each is one project, the writer's own verbs, and a checkable size, with no adjective about the writer.
