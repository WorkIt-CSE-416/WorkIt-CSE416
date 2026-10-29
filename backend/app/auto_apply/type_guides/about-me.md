---
type: about-me
summary: "a true, specific picture of the student; light questions get light answers"
company_link: never
length: [100, 160]
match:
  - "about yourself|tell us about you\\b|introduce yourself"
  - "(deeply|really) interested in\\?"
  - "obsess(ed|ion)"
  - "hobb(y|ies)|outside of (work|engineering|school)"
  - "just for fun|favorite (food|junk food|book|movie)"
  - "numbers that describe you"
  - "best writing"
  - "first learn(ed)? to code"
  - "who you are"
slots:
  - name: pick
    required: asked
    holds: "light questions only: the thing asked for (the book, the food, the nerdiest thing), as one past act or one concrete preference the student has stated"
  - name: pick-detail
    required: false
    holds: "light questions only: one small detail that makes the pick theirs (a count, a place, why, in their words)"
  - name: now
    required: asked
    holds: "serious questions only: where the student is now, in one plain sentence (what the student studies, the work the student does)"
  - name: shaping-events
    required: asked
    holds: "serious questions only: one or two facts only the student has, told as events with their details"
  - name: next
    required: false
    holds: "serious questions only: what the student is after next, as a kind of work"
---

## What the reader is checking

Two kinds of question, read two ways. A light question ("nerdiest thing about you", "favorite book", "fun fact") checks that the student can answer lightly, briefly and truly. A serious one ("tell us about yourself", "what makes you unique") checks for a true, specific picture of them beyond the resume.

- On applicants who wrote "10 sentences explaining that they like 'Inception' because they're a project manager": "It doesn't feel like the appropriate tone or communication style for a question about your favorite movie [...] if I can tell you used AI, clients can too." (Matt Stauffer, CEO of Tighten, C5)
- "Avoid a history lesson." (Yangshun Tay, ex-Meta Staff Engineer, O19)
- "Avoid restating your resume" / "Hit the highlights". (Scott Lawrence, Capital One engineering manager, O18)
- "If you mention a nasty race condition you chased for a week, a good chunk of them will just ask about it." (techinterview.org, about-me reader quotes)
- "if it's trivial, it's not impressive" (Gleb Arshinov, YC alum, ARSH)

## Order

**Light:** the pick in the first sentence, then at most one detail. One or two sentences in all, even when the form allows more. Nothing after it: no tie to the job, no lesson. The serious slots stay empty.
**Serious:** where the student is now in one sentence, then one or two shaping events with their details (most of the words), then what the student is after next if the sources say. The light slots stay empty.
**Multi-part** ("what makes you unique, and one or two events that shaped you"): answer each part in the order asked; the events fill shaping-events.

## Rules

Each is a yes/no check on the draft.

1. **Light: is it one event or a concrete preference, not a habit?** "I love to reverse-engineer beautiful websites" gives nothing to picture; "I once reverse-engineered a dating app's user data api so I could see the profiles of who liked me without paying :/" is one act (O17).
2. **Light: does it leave out the job, the company and any work skill?** The Inception answers bent a favorite movie into a project-management pitch, and the CEO read them as AI (C5). Dylan Field answered a grand prompt with "Chocolate is repulsive." and stopped there (O9).
3. **Light: is it short and not trivial?** "if it's trivial, it's not impressive" (ARSH). The FamilyLeaf answer carries its own count: "(I am 6 down, and 6 to-go)" (A20).
4. **Serious: is every trait word followed by its event in the same or next sentence?** "I am shameless. I've worn shark costumes on camera" passes; the same essay's last line, "I always go the extra mile", fails (B9). Capital One's model is a mission line and eight principles with no event, so it fails in writing (O18).
5. **Serious: does it avoid reading out the resume in order?** The bad versions "recite the resume in order starting from a degree nobody asked about" (techinterview.org); "Avoid a history lesson" (O19).
6. **Both: is there one detail a reader could ask a follow-up about?** The race condition (techinterview.org); the crocheted bicycle chains that "created enough friction to pull cardboard gears" (B7).
7. **Is every slot backed?** Write only the slots the plan backs. A light pick the sources do not hold (a favorite food, a book) is never guessed: the slot is required, so the question is asked of the student. With no next in the sources, end on the last event.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**O17: the same skill, two ways (program's model vs accepted applicant, Z Fellows).** "What's the nerdiest thing about you?"
- Weak: "I love to reverse-engineer beautiful websites and take notes of design and code details"
- Strong: "I once reverse-engineered a dating app's user data api so I could see the profiles of who liked me without paying :/"
- Why: the weak one is a standing habit with no instance. The strong one is one past act with a funny motive, and no tie to the job.

**B10: something you do for pleasure (admissions analog, MIT; both admitted).**
- Weak: "I am an enthusiastic foodie. I subscribe to my favorite food blogs, anxious for new recipes, and I research exotic fruits and vegetables [...] Though the end result is not always perfect, I enjoy every step of preparing food."
- Strong: "I am a skier. For days before winter storms, I am filled with nervous anticipation, distracted daydreaming, obsessive checking of weather reports [...]"
- Why: anyone could write the weak one. The strong one gives behavior specific and observed enough to be one person's.

**C5 vs O9: a light answer bent to the job, then one left light (real applicants; C5 judged weak by the hiring CEO, O9 accepted).**
- Weak: "I really love Inception," followed by, in Stauffer's summary, "10 sentences explaining that they like 'Inception' because they're a project manager".
- Strong: "Chocolate is repulsive. Even the smell of it makes me want to vomit."
- Why: the strong one is a true personal fact stated flat, and it stops. The weak one turns a movie into a pitch, the move the reader names as the tell.
