---
type: why-role
summary: "what this role needs and where the student has done it (includes why you, and fit)"
company_link: same-kind
length: [60, 120]
match:
  - "good fit|great fit|a fit|your fit|right fit"
  - "why (are you|you are|you're) (a|the) (good|great|best|right)"
  - "best (person|candidate)"
  - "what (will|would|can) you bring"
  - "what makes (you|someone)"
  - "make an impact at"
  - "your strengths"
  - "why (this|the) role"
  - "interest(ed|s)? .*(in|about) (this|the) (role|position|opportunity|internship)"
  - "about this role"
slots:
  - name: role-need
    required: true
    holds: one to three duties or stack items this role needs, quoted from the posting or the company brief
  - name: proof
    required: true
    holds: for each need, one episode from their own work where the student did it, with what the student did and a size or result
  - name: why-this-role
    required: false
    holds: a true, small reason for this role over others, or a plain answer to the reader's likely worry about them
  - name: other-part
    required: asked
    holds: the answer to any extra part the question asks (a weakness, work the student is not interested in), taken from the sources
---

## What the reader is checking

Whether the student can do this role's work, shown by things the student has done. Fit is judged on skills, so trait claims and values talk do not count.

- "Every letter says 'I would be a good fit for your company and my skills match your job description'. That is obvious" (agotterer, hiring on HN)
- A letter should say "why you want this particular job and not just any job"; "you can tell if someone's just blasting them out and there's nothing specific about the role". (Jason Fried, 37signals CEO)
- A great letter "doesn't waste space by repeating what's on her resume but instead adds something entirely new to her application overall." (Alison Green, Ask a Manager, E14)
- Oxide added "Why this role at Oxide?" because the why-company answer did not show role fit: "And that's been really, really important." (Bryan Cantrill, E16)
- Recruiters judge person-job fit mostly from "knowledge, skills, and abilities". (Kristof-Brown 2000, Personnel Psychology)

## Order

The role's needs in one sentence, then one proof per need, then why-this-role if the plan backs it. Proof takes most of the words.

**Short trailing ask** ("in 1-2 sentences, what makes you a fit"): one need and one proof.
**"What makes a great X":** rank one quality first, then prove it. C3 picks "two points that I believe are particularly relevant"; Silverman praised the same move: "the candidate offered up an opinion as to which experiences I should focus on" (C2).
**Extra part** (a weakness, what the student is not interested in): answer it plainly from the sources, after the proof.

## Rules

Each is a yes/no check on the draft.

1. **Does the first sentence name what the role does, not just its title?** E12 ("Your posting on LinkedIn for a Sales and Marketing Coordinator recently caught my eye") names only the title.
2. **Does each fit claim have an episode in the same or the next sentence?** E12's "exceptional attention to detail" is a bare trait; E13 follows its trait with "a 200-page grant proposal" and "(The result? A five-year, $1.5 million grant award.)"
3. **Are the needs this posting's, not generic engineering traits?** jkingsbery's method: "going through each item in the job description and saying something very brief about how that's a thing I've done before." (E15)
4. **Is any need the student cannot prove left out?** Do not claim it. Steve Tuck on early-career materials: "it is hard to describe robust experiences if you haven't had them." (E16) Fewer needs, each proven, beats more.
5. **Is it about what the student can do, not what the student will gain?** E12's only motive is "personal and professional development". C3's author: "If you're starting too many sentences with 'I like...' or 'I want...' then you're doing it wrong."
6. **Does it answer the role, not the company?** A why-company answer here misses the question (E16).
7. **Is every sentence from this application?** "... and that's why I want to work in finance" sent to an advertising team ends the read (E15).
8. **Is every part of the question answered?** An unanswered weakness part is a skipped part.
9. **Is every slot backed?** Each need is quoted from the posting or the brief; each proof from the student's experience. With no why-this-role line in the sources, end on the last proof.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**E12 -> E13: real applicant, same writer, before and after, judged by Green (non-tech).**
- Weak: "I am now seeking a position that will make the most of my administrative experience while offering additional opportunities for personal and professional development. In exchange, I offer exceptional attention to detail, highly developed communication skills, and a talent for managing complex projects..."
- Strong: "One of my recent projects involved coordinating a 200-page grant proposal: I proofed and edited the narratives provided by the division head, formatted spreadsheets, and generally made sure every line was letter-perfect... (The result? A five-year, $1.5 million grant award.)"
- Why: Green on the weak one: "It reads like 95% of the cover letters out there." The strong one proves one need with one episode, a size and a result.

**E15 vs C3: hiring manager's pattern vs real SWE letter that got interviews and offers.**
- Weak: a letter ending "... and that's why I want to work in finance", sent to an advertising team.
- Strong: "I have previous experience of embedded systems programming: during my year out I developed the software for a precision testing machine (20 000 lines of C in 6 months). ... If you are considering using Linux either in your phones or in-house I can offer specific expertise."
- Why: the strong one picks the needs this employer has and proves each with a size; its contribution line is conditional and modest.
