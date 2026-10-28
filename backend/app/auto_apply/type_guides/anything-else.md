---
type: anything-else
summary: "one new fact not used elsewhere on the form"
company_link: never
length: [20, 45]
match:
  - "anything (else|additional|to share|you'd like us to know|you would like us to know|you want)"
  - "additional (information|info|comments?|message|note)"
  - "^comments\\b|^extra$|comments or additional"
  - "clarify any answers"
  - "would like us to consider"
  - "anything to share re"
  - "is there anything"
slots:
  - name: new-fact
    required: true
    holds: one fact not used anywhere else on this form, of the kind the box's label asks for (a project or result, a link to their work, availability, a course in progress, a clarification)
  - name: meaning
    required: false
    holds: one clause on what the fact means for the reader or what they can do with it (a link to open, a date to plan around)
---

## What the reader is checking

That the box holds one new, useful fact and nothing else. Read the label first: it decides what counts as new. A bare "anything else?" follows the admissions rules below. A label that names a topic changes them: OpenAI's box asks for "your motivation to apply", and Anthropic's asks for "notable accomplishments", both things admissions offices keep out.

- "Most applicants do not need to use this section at all, and we will not think less of you if you leave it blank." (Tuck admissions, B11)
- "This section is not the place to introduce new accomplishments, additional leadership examples, or further explanation of why you want to come to Tuck." (Tuck admissions, B11)
- Does not belong: "Another personal statement or short answer". (Audrey Burba, USC admissions, O21)
- "feel free to leave this blank" (Jane Street's form text)
- Only 3 of 32 accepted YC applications used the box at all (A41).

## Order

The new fact in the first sentence, then the meaning in one clause if the sources give it. One or two sentences.

**Bare label** ("anything else?", "additional comments"): a practical or clarifying fact first (availability, a course in progress, a link to work), since admissions readers exclude a second pitch.
**Topic label** ("your motivation to apply", "notable accomplishments", "interest in X"): the new fact must be on that topic. An accomplishment or a reason to apply is allowed here, as long as no other answer on the form used it.
**Clarify label** ("clarify any answers"): clarify only what needs it.

Always answer, even when the box is optional: a blank box is a bug in this system. When no new fact exists, the required slot asks the student.

## Rules

Each is a yes/no check on the draft.

1. **Is it at most two sentences, unless the label asks for more?** The good YC answers are 23 and 31 words; the weak one is three paragraphs (A41).
2. **Does every sentence carry a fact not already on the form?** Read every other answer first. The accepted Z Fellows applicant re-pitched traction he had given elsewhere (O20); USC lists "Another personal statement or short answer" as what does not belong (O21).
3. **Does it answer what the label asks?** For a bare label, it holds no "why I want to join" and no restated accomplishment (Tuck, B11). For OpenAI's or Anthropic's label, motivation or an accomplishment is the point (O21 note).
4. **Is it free of definitions and lessons?** "Other examples of certified B Corps include Patagonia, The Honest Company and Plum Organics" is the weak answer's line (A41 Flex).
5. **Is it free of thanks, enthusiasm and sign-offs?** None of the good answers (A41, the O20 model) has one; a line with no fact fails rule 2.
6. **Is the fact checkable?** A name, a link or a date beats a statement about themselves: Goodly names the lawyer who reviewed its documents (A41).
7. **Is every slot backed?** Write only the slots the plan backs. With no meaning line in the sources, the fact stands alone: both good A41 answers are mostly fact.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A41: the same question (real applicants, YC accepted; Flex weak by the published rules).** "Is there anything else we should know about your company?"
- Weak (The Flex Company): three paragraphs on donating profits and B Corp certification, including "Other examples of certified B Corps include Patagonia, The Honest Company and Plum Organics".
- Strong (Goodly): "We formed the company using Gust Launch. Goodly's incorporation documents were reviewed by Mike Sullivan (a partner and head of the Corporate Group at Orrick serving as a mentor to Greg)."
- Strong (80,000 Hours): "We're fiscally sponsored by the Centre for Effective Altruism. It provides our 501(c)(3) status and incorporation, as well as some of our operations."
- Why: each strong one is two sentences of new, checkable fact that answers a question the reader would otherwise ask. The weak one is a second pitch plus a lesson.

**O20: the same optional box (program's model vs accepted applicant, Z Fellows).** "Optional: What's 1 thing you need help with?"
- Weak: "Have done some user research and have a couple of paid users which are giving consistent feedback. A pre-seed fund and mentorship at this stage will help me to build a world-class product much faster."
- Strong: "I'm struggling to meet a technical cofounder. I'd love email introductions to smart technical people."
- Why: the strong one answers the label with one plain fact and one thing the reader can do. The weak one repeats traction from elsewhere and asks for what everyone wants.
