---
type: why-field
summary: "what drew the student, what they have done since, what they want next (also a major, goals)"
company_link: never
length: [70, 120]
match:
  - "\\bmajor\\b|field of study|chosen discipline"
  - "(career|professional|short-term|long-term|educational) (goals?|plans?)"
  - "goals for the next"
  - "plans after"
  - "(hoping|hope|looking|want) to (gain|develop|learn|get)"
  - "skills .*(develop|gain)"
  - "^what motivates you\\??$"
  - "why .*career in"
  - "(interested|interest) in .*(career(?! at)|trading|analytics|data processing|the .* space)"
  - "looking for in your next role|optimizing for"
  - "steepest learning curve"
  - "prepare for a career"
  - "what type of engineering work"
  - "why .*(choose|chose|pick|picked|study|studying|pursue|pursuing|interested in|get into|got into) .*(computer science|\\bcs\\b|software engineering|engineering|programming|coding|this field|your field|tech\\b)"
slots:
  - name: draw
    required: true
    holds: the reason, as an event the sources date or name (the first problem the student solved or got stuck on, a course, a job) or the plain practical reason; for a goals question, what their work so far has not taught them
  - name: since
    required: true
    holds: what the student has done in the field since, with a number or a name (a project, a competition result, an internship)
  - name: next
    required: true
    holds: the specific, near thing the student wants next (a kind of work, a problem, a step already in motion)
  - name: brings
    required: false
    holds: for a goals question, what the student gives in return, as a fact about their work
  - name: problem-size
    required: false
    holds: the size of the problem that drew them, only as a number the sources give
  - name: feeling
    required: false
    holds: how it felt, in their own words; one short clause at most
---

## What the reader is checking

That the interest is real and current, shown by something the student did, not claimed as a trait. For goals, that the next step is concrete and already in motion.

- "Try to tell us why you are passionate about computing now and how you can demonstrate this." (Robert Zimmer, Head of Computing, Goldsmiths, on UCAS, O15)
- Statements are "similar, bland, impersonal and don't stand out – so make it personal, specific, and concrete". (Gavin Lowe, Oxford CS admissions, on UCAS, O15)
- On the goals answers: "It wasn't about if they did what they said they would." (Danielle Strachman, Thiel Fellowship director, O14)
- On the admitted goals answer: "more specific and direct. It includes a reference to external viewing material." (Ryan Treen, on his own two drafts, A32)
- "The best answers are the most matter of fact." (Paul Graham, YC)

## Order

**Why this field or major:** the draw in one or two sentences, then what the student has done since (most of the words), then what the student wants next. Origin story is one clause at most.
**Goals** ("career goals", "what do you hope to gain"): the next thing the student wants, named in the role's terms, first; then the draw (why now: what their work has not yet taught them); then what the student brings; the direction last, in one plain sentence.
**Examples asked for** ("give 1-5 examples"): give that many, each a backed fact.

## Rules

Each is a yes/no check on the draft.

1. **Does the draw point to a dated or named event, not "always" or a childhood?** "Ever since I was five years old I have been interested in computing" is the opener the Goldsmiths head says he reads in "lots of statements" (O15). The strong origin is a scene: "I held my breath and hit RUN" (O16).
2. **If the question says "why", does one sentence answer it with a fact?** The accepted Z Fellows applicant skipped the "Why?" and gave a feature list (O12); the form's model answers it with "after landing 40+ interviews".
3. **Is there at least one thing done since, with a number or a name?** A21 counts each step ("27 convos", "3 out of the 15 people paid us"); Oxford's admissions lead: "Even if it's just a simple programme, talk about it" (O15).
4. **Is the next step a concrete role, problem or step?** A comparison to a famous product fails ("as large as MacBooks and GitHub", O13), and so does a size claim ("a billion dollar marketing and events CRM platform", A23).
5. **Is every trait word ("passion", "strong grasp") followed by the event that shows it?** "I have a strong grasp on cybersecurity" is the weak line; "After being bombarded with cyber attack after cyber attack, I explained to my grandparents" is the strong one (O16).
6. **For goals, is it more than what the student gets?** "I want to be working for a company/organization with a strong culture" was the rejected line (A32); "Only what the applicant gains" is a weak pattern across Penn, Palantir and Lerner (deep-examples Part 3).
7. **If the real reason was practical, is it stated plainly?** Never supply a formative moment the sources lack. A23's "we could work with anything" shows that a missing reason reads as none.
8. **Is every slot backed?** Write only the slots the plan backs. With no problem-size number, leave it out. With no feeling in the sources, write none: A21, A22 and the O12 model win without one. A "this sparked a lifelong passion" line is never backed.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A32: the same writer, rejected then admitted (real applicant, Recurse Center).** "What do you want to be doing in two years?"
- Weak: "I love bringing people together. [...] I want to be working for a company/organization with a strong culture and that values bringing out the best in all their employees."
- Strong: "I want to be building strong, supportive teams. Brian J. Brennan gave a talk at JS conf called 'Being Human' (link) [...] I've worked with organizations like 'Ladies Learning Code' [...]"
- Why: the weak one names a trait and a wish anyone could hold. The strong one names the work, a source the writer can point to, and a group the student has already worked with.

**O12: the same question (program's model vs accepted applicant, Z Fellows).** "What is the project that you are currently working on or would like to pursue? Why?"
- Weak: "I'm building DevKit, a SuperApp for developers. Boosting productivity and growth of developers by giving them tools and curated content. [...] These tools will save weeks of dev effort and allow teams to iterate much faster. [...]"
- Strong: "I'm building relentless, which is a job search service [...] I started this company after landing 40+ interviews and multiple offers during my job search and realizing that most people struggle to land even 1."
- Why: the strong one answers "Why?" with a count from the writer's own life. The weak one skips that part and makes an unmeasured claim.

**A22 vs A23: why this idea (real applicants, YC accepted; A23 weak by PG's rule).**
- Weak: "We saw how enterprise software is slow and bulky and outdated. We selected events and marketing, but we could work with anything related to enterprise software. We believe there is a long term opportunity here to build a billion dollar marketing and events CRM platform."
- Strong: "[...] one I have experienced personally at my last company - SupportBee, a shared inbox product. There, we deliver over a million notifications a month to our users. [...] When our users asked for an in-app notification center and mobile push notifications, we realized that we'd have to do a lot more work [...]"
- Why: the strong draw is work the student did at a named place, with its scale and the moment the problem showed. The weak one admits there is no reason for this choice.
