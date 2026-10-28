---
type: cover-letter
summary: "the formal letter, in four short paragraphs"
company_link: same-kind
length: [200, 260]
match:
  - "cover letter"
  - "note to (the )?hiring manager"
  - "letter of (interest|motivation)"
  - "motivation letter"
slots:
  - name: opening-who
    required: true
    holds: "opening, sentence 1: what the student studies and where, their graduation date as the sources give it, and the posting's title said plainly"
  - name: opening-built
    required: true
    holds: "opening, sentence 2: what the student built most recently that fits this role, as what it did for the people who used it"
  - name: opening-company
    required: true
    holds: "opening, sentence 3: one specific thing this company or team builds, from the posting or company brief, and their true same-kind link to it"
  - name: proof-problem
    required: true
    holds: "proof: their strongest experience for the work the role most needs, where the student did it, and the problem in plain words"
  - name: proof-steps
    required: true
    holds: "proof: what the student themselves did, step by step, with a number, scope or link when the sources give one"
  - name: proof-why
    required: false
    holds: "proof: why the student built it that way, or what it showed them, as the sources state it"
  - name: second-proof
    required: false
    holds: "second_proof: a second thing the role needs, from a different experience, with what the student did"
  - name: closing-availability
    required: true
    holds: "closing: their internship term or availability, as the sources state it"
---

## What the reader is checking

In under a minute, and often only the first sentence: who the student is, what proof the student has, and whether this letter was written to this company. The four paragraphs below fix the shape, and their word caps win over anything here. Each slot name above starts with the paragraph it fills (`second-proof` fills `second_proof`). Open with a plain salutation and sign off with the student's name, as the form expects a letter.

- "They're the very first thing we read when people apply. And when they're bad, they're definitely the last thing we read from that applicant. We just stop there." (Jason Fried, 37signals, cover-letters reader quotes)
- "Are they applying for this job or just any job? It's pretty obvious if it's a general purpose mail merge, or a personal letter written to us about their passion for that position." (Fried)
- "Your CV tells your work history and skillset, but doesn't tell anything about why you're applying for this specific position at this specific company." (JohnFen, HN, "from decades of hiring")
- "Reverse the ratio of the first-person and second-person usage here." (Patrick McKenzie, on a junior programmer's letter, L4)
- "When you see 50 cover letters and 40 of them sound like they were written by the same machine, it stops being a useful signal." (David Berwick, Adria Solutions, C7)

## Order

Four paragraphs, in order, 180-260 words in all:

1. **opening** (3 short sentences, at most 65 words): opening-who, opening-built, opening-company. Never the company's mission; never the letter itself.
2. **proof** (3 sentences, at most 85 words): proof-problem, proof-steps, proof-why. Most of the letter's evidence lives here.
3. **second_proof** (2 sentences, at most 50 words): second-proof. Empty when no other experience answers anything the role needs.
4. **closing** (1-2 sentences): closing-availability, that the resume has the rest, a conversation, thanks. Restate nothing.

## Rules

Each is a yes/no check on the draft.

1. **Does every trait word have its event in the same or next sentence?** Green: "Don't just assert that you'd be great at the job [...] demonstrate" (L1). Codegeek on L4: "How about you give me an example".
2. **Does proof carry a number, a scope or a link?** M1's "20 000 lines of C in 6 months", L1-after's "$1.5 million grant", L2's "$35M/year budget". Weak without: L9's bare skill list.
3. **Would opening-company be false with a competitor's name in it?** L3: "I was intrigued to see that you've built your own LMS"; L11: "replicate TTL's own tesser analysis". Weak: L5's `${companyName}`, L7, D6 (Lerner: "nothing here about why this candidate is a good fit").
4. **Is the employer, its product or "you" the subject of a sentence outside the closing?** patio11's I/you count on L4; M1's "If you are considering using Linux either in your phones or in-house".
5. **No technology list longer than three items?** L7 lists six frameworks, L8 eleven techniques; Silverman: "The résumé in prose form" (C2).
6. **No claim larger than their part, and nothing planned stated as done?** Fried: "'Sales increased 30% under my watch.' You didn't do that probably." L5 called a book its writer had not started "in the process of writing".
7. **No superiority or certainty?** "I more than meet the required qualifications" was rejected at once and its writer later called it "arrogant" (L11); "a hundred percent sure" (L8); "one of the top contributors" (L7).
8. **No passion, love or excitement unless the same sentence holds something the student did?** WillyF on L4: "You can write for hours about how much you love programming, but what most hiring managers are really concerned with is your end product."
9. **Does the closing avoid what the job gives them and any moral?** Weak closes: "career opportunities it offers me" (L2), "enhance my career prospects" (L7), "personal and professional development" (L1-before).
10. **Are at least two sentences ones no other applicant could write?** L6's AI letters "lacked personality" with no anecdote; Fried: "there is a flavor that you can taste".
11. **Is every slot backed, and inside its cap?** Write only the slots the plan backs. With no proof-why in the sources, proof ends on the steps; M1 and L12 won with no lesson and almost no feeling. With no second experience, second_proof stays empty. With no true same-kind link for opening-company, the required slot asks the student; never stretch one (Lerner: "maybe skip it", D4).

## Model letters

The words in these belong to other people. Use them to see the shape; never borrow a phrase. Green on every one: "Do not steal this letter or even parts of it."

**M1 (= C3): embedded Linux engineer, full text (real applicant, interviews and offer, HN 2010).** The only SWE model. About 150 words; two points, each a scoped result tied to the employer.
> Thank you for taking time to speak to me on [date]. The [X] project sounds very interesting and I would very much like to discuss how I can help. [...]
> I would like to highlight two points that I believe are particularly relevant to [company-name]:
> - I have previous experience of embedded systems programming: during my year out I developed the software for a precision testing machine (20 000 lines of C in 6 months). I worked closely with a team of electronic and mechanical engineers during the project, which was completed on time and on budget.
> - I am a developer for [Y] Linux, a distribution which is being increasing used for embedded systems. If you are considering using Linux either in your phones or in-house I can offer specific expertise.
> Please do not hesitate to contact me if you need further information, and I look forward to discussing your requirements in more detail in the near future.
- Slots: point 1 is proof (problem, scope, who the writer worked with); point 2 is second_proof stated as an offer to them. One feeling ("sounds very interesting"), no lesson.

**L11 after: research scientist, technical career changer, excerpt (real applicant, reached the final round; Green: "a letter about her").**
> I was thrilled to see the Research Scientist position at the Time Travel Laboratory (TTL). I ran the first few research studies of my PhD on a Portal 560 and always loved how accessible it made time travel [...]
> I wasn't the first person to use the P560 in my graduate school department but I probably was the first to read the entire manual, which made me "the P560 person" from then on: other students would constantly approach me for P560 advice or troubleshooting, and I was often asked to provide demonstrations whenever the department held tours. [...]
> My research experience spans a variety of methods: I've designed, executed, and analyzed 15+ studies using portals, ray guns, and hoverboards [...] my first coding project when I taught myself Python was to replicate TTL's own tesser analysis and see if the results matched up (they did).
- Slots: the opening's company sentence is their own product, which she used. The replication of their analysis is proof and why-them at once, the strongest move in the set. Each feeling ("thrilled") sits on a fact.

**L3: product manager, ed tech, excerpt (real applicant, interview then offer; Green).**
> I believe my biggest strength as a product manager is my ability to build trust with and among my colleagues. [...] I work with an engineer who doesn't want to be involved in every business planning meeting, but the student does like to know how their work is achieving business goals [...] so I make sure to include that information when writing up specs and user stories. [...]
> Leading development of an LTI-compliant application after spending years directly supporting faculty has taught me the ins and outs of various Learning Management Systems [...] I was intrigued to see that you've built your own LMS and that your product hire will be working to improve it [...] I would love to know more about the decision to build an LMS from scratch rather than using one of the major market players.
- Slots: one claimed strength, proved at once by a named-colleague habit no resume holds (proof-steps). The company sentence is one decision of theirs, joined to her same-kind work.

**L2: data analyst, career changer, excerpt (real applicant, interview then offer; Green).**
> [...] In my current role, that manifests as development of a $35M/year budget for a three year plan for stewpot production activities. I review previous expenditures and contract details to build a flexible model that ties spending (and stewpot production) to various levels of forecasted performance. As planned activities are rolled out, I track performance and dig into variances – not just the "what," but also the "why".
> In my previous role, I dug deep into a health plan's claims data set to look for patterns of claim activity for targeted provider and facility audits. To facilitate that review, I worked closely with the clinical external audit staff [...]
- Slots: proof is one kind of work at its scale, told step by step; second_proof is a different job, told the same way. Her stock lines ("flex my analytic muscles") and an industry-level why-them did not sink it; the evidence paragraphs carried it.

## Pairs

**L11: the same writer, rejected at once vs final round (real applicant; Green).**
- Weak: "I have extensive experience conducting hypothesis-driven psychological research and strong quantitative research and analysis skills [...] I believe I more than meet the required qualifications for the role [...]"
- Strong: "my first coding project when I taught myself Python was to replicate TTL's own tesser analysis and see if the results matched up (they did)."
- Why: the weak one summarizes the resume and claims superiority. The strong one is one checkable act on the employer's own work.

**L1: the same writer, before and after (real applicant; Green).**
- Weak: "I offer exceptional attention to detail, highly developed communication skills, and a talent for managing complex projects with a demonstrated ability to prioritize and multitask."
- Strong: "One of my recent projects involved coordinating a 200-page grant proposal: I proofed and edited the narratives provided by the division head, formatted spreadsheets, and generally made sure that every line was letter-perfect [...] (The result? A five-year, $1.5 million grant award.)"
- Why: three trait claims became one episode, with what she did by hand and a measured result.

**L4: the same SWE writer, two drafts (real applicant; HN judges).**
- Weak: "I love to program. It is what I honestly believe I was born to do [...] Give me a problem to solve and I won't give up unitl it kneels before me."
- Better, still weak: "I've written things from a cradle-to-grave web-application in J2EE (http://thegatewayproject.org/) to an x264 encoding script in Python [...]"
- Why: the revision added proof but still said nothing about the employer, and patio11 still marked it down. Proof alone does not fix a letter that is only about its writer.
