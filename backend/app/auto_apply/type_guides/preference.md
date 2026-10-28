---
type: preference
summary: "a real pick of team, track or area, backed by the student's closest project"
company_link: same-kind
length: [60, 100]
match:
  - "which (team|teams|track|tracks|area|areas|product area|office|location|group|org)"
  - "(team|track|area|location|office)s? .*(prefer|preference|interest(s|ed)? you most)"
  - "(your|team|location|office) preferences?"
  - "something specific at"
  - "specific types? of work"
  - "(most|particularly) interested in focusing"
  - "(rank|ranked) .*(team|area|choice)"
  - "second choice"
slots:
  - name: pick
    required: true
    holds: one area, team or track (two at most), by the exact name the form or the company brief uses
  - name: closest-project
    required: true
    holds: their closest real project to that area, with their part and the outcome
  - name: pull
    required: false
    holds: the property of that project's work that makes it their pick (correctness, scale, reach), as the sources state it
  - name: location-reason
    required: false
    holds: for a location pick only, a true, small reason from the sources
---

## What the reader is checking

Whether the student can be placed: a real pick, backed by work, that helps match them to a team. "Open to anything" gives the reader nothing to place.

- "The best answer is rarely 'I am open to anything.'" and "Honest flexibility is useful; performative flexibility is not." (PracHub, interview-prep coach, E18)
- "Claiming enthusiasm for a city, domain, or work arrangement you would immediately reject wastes everyone's time." (PracHub, E17)
- "self-reflect on what makes the most sense based on your your skills, what motivates you, and what you want to accomplish as an intern." (Elizabeth Watts, Palantir recruiting)
- "there's a lot of movement between them, as we value gaining exposure to different problems and perspectives." (Palantir blog, "Dev versus Delta") A pick is not a lifetime commitment, so a backed pick beats a hedge.

## Order

The pick in the first sentence, then the pull, then the closest project (most of the words), then one closing line of flexibility: the student is glad to learn the team's stack or work where the team needs them. The flexibility line holds no fact, so it needs no quote, and it is never more than one sentence.

**After a select or dropdown** on the same form: the text names the option chosen, word for word, and runs 25-45 words.
**Form lists options:** pick from them by their exact names.
**Location:** a plain pick, the location-reason if the sources hold one, then the flexibility line.

## Rules

Each is a yes/no check on the draft.

1. **Does the first sentence make one pick (two at most)?** "I am open to anything." fails (E18). E17 opens "I am especially excited by backend and data-intensive systems."
2. **Is the pick a kind of work, not a brand?** Answering "If not Palantir, which company?" with "Google" read as prestige; the thread suggested "probably saying something about a startup would be better" (A39).
3. **Is the pick backed by their closest real project?** E17: "In my last project I owned the ingestion pipeline, so I would enjoy work where correctness and scale matter." Pick the area where their strongest story lives.
4. **Does it avoid pretending to know the team's projects?** The coach's verdict on E17: "That is specific without pretending you already know the project."
5. **Does it match any select or earlier answer on the form?** A contradiction makes both answers unreadable.
6. **Is the pick one the student would accept?** "performative flexibility is not" useful (E18). Do not pick an area to sound eager.
7. **Is there exactly one flexibility line, at the end?** E17 ends "I am also happy to learn the stack your team uses." More than one line swallows the pick.
8. **Is every slot backed?** The pick uses the form's or brief's own name; the project is quoted from the student's experience. With no pull line in the sources, go straight from pick to project.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase. No real applicant's preference answer with a verdict exists; these are a coach's models and a forum record.

**E17 vs E18: coach model, same coach.**
- Weak: "I am open to anything."
- Strong: "I am especially excited by backend and data-intensive systems. In my last project I owned the ingestion pipeline, so I would enjoy work where correctness and scale matter. I am also happy to learn the stack your team uses."
- Why: the strong one fills pick, closest-project and pull in two sentences, then one honest flexibility line.

**A39 vs E7: real applicant's forum account vs coach model.**
- Weak: "If not Palantir, which company?" answered "Google".
- Strong: "I want to work on ranking because it's one of the few places a single model change moves a number a billion people see,"
- Why: the weak one names a brand. The strong one names an area and the property of its work that makes it the pick.
