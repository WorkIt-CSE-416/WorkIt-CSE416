---
type: named-area
summary: "the student's experience in the area the question names, with every listed detail"
company_link: never
length: [60, 100]
match:
  - "(your|any) (experience|background|familiarity|knowledge)"
  - "experience (with|in|using|creating|building)"
  - "(have you|do you have) .*(experience|worked|done|built|contributed|knowledge)"
  - "what tools have you used"
  - "describe (a|one|your) .*(model|web application|application|database|pipeline|system you)"
  - "most advanced"
  - "(tools|frameworks|languages) .*(worked with|used)"
  - "^skills$"
  - "foundational knowledge"
slots:
  - name: direct-answer
    required: asked
    holds: the plain yes or no, when the question asks one; unused otherwise
  - name: project
    required: true
    holds: one project of theirs in the area the question names, and what it did
  - name: own-part
    required: true
    holds: what the student wrote or decided in it, fenced off from the team's part
  - name: area-fact
    required: true
    holds: a step or finding particular to the area that only someone who did the work would name (a data problem, a protocol detail, a bug in it)
  - name: listed-details
    required: asked
    holds: one line per detail the question lists (stack, team, challenges, validation, tools), in its order; unused when it lists none
  - name: result
    required: true
    holds: how the student knew it worked (a number with its baseline, a test, a user effect)
  - name: scope
    required: false
    holds: how long and in what the student has used it
  - name: limit
    required: false
    holds: what is still unproven or where their experience stops
---

## What the reader is checking

Real depth in the area named: one project walked through, their part, and a detail only a practitioner would give. A list of tools or an inflated level fails.

- "Don't give a catalog of models or tools. Pick one or two representative projects and walk through the problem, your role, why specific choices were made, and what happened as a result." (Hello Interview rubric, S10)
- "Resume bullets often sound team-shaped; in the interview, separate what you owned directly from what others owned or advised on." (Hello Interview rubric, S10)
- "Don’t claim to know something really well if you don’t." (Recurse Center, "What we look for", named-area reader quotes)
- "Application #2: 'Yes.' Translation: 'You probably have a million of these to read, so I'll keep it brief.'" (Harold Treen on his admitted RC answer, A33)

## Order

The direct answer if asked, then the project and their part, the area fact, each listed detail in the question's order, and the result. Scope fits in one clause up front if the sources give it. A limit sits beside the result.

**Yes/no or "have you worked with X":** "Yes." or "No." first, then one line per use, each as duration + what + where, as in A33's admitted bullets.
**Little or no experience:** say so in one plain sentence, then the nearest true work. When the area was new to them on the job, show the fact the student learned and what the student changed because of it (S14).
**Tools or skills list:** each tool with the one thing the student did with it; no bare list (S10 rubric).

## Rules

Each is a yes/no check on the draft.

1. **Is the project in the area the question names?** A more impressive project from another area does not answer it.
2. **Is every yes/no part and listed detail answered, in order?** A33's admitted answer matches the asked format exactly; the rejected "Yes!" gave enthusiasm in place of facts.
3. **Does it name a step or finding particular to the area, beyond the tool name?** S10 GREAT "I found the labels were inconsistent across teams"; S14 GREAT "the same event could be delivered more than once". S10 POOR fails with "a neural network" and "a more modern approach".
4. **Is their part separated from the team's?** S10 GREAT: "my specific responsibility was building the training dataset and evaluating a couple of baseline models". S10 POOR: "I helped with the pipeline and some of the training".
5. **Is the result stated with its baseline or check, not an adverb?** "definitely better" fails (S10 POOR). S14 GREAT names the fix and "added a test for that case".
6. **Is the level claimed matched by the detail given?** No "expert in" (RC: "Don’t claim to know something really well if you don’t."). A stated limit reads as credible: "the production impact was still unproven because rollout was limited" (S10 rubric's good line).
7. **Does it show the knowledge applied, not just acquired?** "You should not frame the story as 'I didn't know something, then I read about it.'" (S14 rubric). S14 POOR: "copying patterns from nearby code until I got the endpoint working".
8. **Is every slot backed?** Write only the slots the plan backs. A listed detail with no backing asks the student for the fact; never skip it silently. No closing lesson or feeling: S10's lesson repeats its label finding, and S14's "I felt much more confident" adds nothing.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**S10: the same prompt, the same judge (coach model).** "Tell me about your machine learning projects."
- Weak: "I worked on a recommendation project where we used a neural network to improve what users saw. It was a team effort, and I helped with the pipeline and some of the training, and the results were definitely better than before. We used a more modern approach, which was important because the previous system was pretty basic. Overall it was successful and gave me good exposure to machine learning in production."
- Strong: "...the ML project I'd highlight is a support-ticket classifier I worked on during my internship. The overall goal was to identify urgent tickets faster, and my specific responsibility was building the training dataset and evaluating a couple of baseline models under the guidance of my mentor. I started with a simple model first so I could understand whether data preparation or model choice was the bigger issue, and that turned out to be helpful because I found the labels were inconsistent across teams. After cleaning that subset and re-running the comparison, recall improved enough that the team used the model in a limited internal workflow..."
- Why: the weak one's area content is buzzwords and its proof an adverb. The strong one fences the writer's part, names a finding only someone who did the work would know, and says what the result was used for.

**A33: one writer, rejected then admitted (real applicant, Recurse Center).** "Have you worked professionally as a programmer?"
- Weak: "Yes!"
- Strong: "Yes." then "- 4 month internship testing mobile apps (Xtreme Labs). - 3 month internship testing the Microsoft Word Web App (Microsoft). - 12 month internship doing web development - Rails/Javascript (Pivotal Labs) [...]"
- Why: the plain answer plus duration, what and where for each use. The writer called the first "extra enthusiasm in lieu of reasons".

**S14: an area new to the writer on the job (coach model).**
- Weak: "I had to work on an API I hadn't used before... I spent some time searching online and copying patterns from nearby code until I got the endpoint working. I didn't want to slow anyone down with too many questions, so I mostly figured it out myself. The feature shipped..."
- Strong: "...I realized I didn't actually understand how our event processing and retries worked, and guessing there felt risky... That helped me see that the same event could be delivered more than once, so I changed the code to handle duplicates safely and added a test for that case..."
- Why: the weak one never says what the API was or what the writer learned. The strong one names the area's fact and the fix it led to.
