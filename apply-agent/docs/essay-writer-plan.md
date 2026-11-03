# Essay writer rebuild: plan

Settled with Lisul on 2026-10-22 ("yes to all"). The interview to fill the Story bank gaps comes later; the questions are logged in `bank/questions.md` (outcome `asked`). Vocabulary: [GLOSSARY.md](../GLOSSARY.md). The research behind each decision is in [research/answer-types.md](../../research/answer-types.md) and `research/sources/answer-types/`. Each file is named under the decision it backs.

## Decisions

1. **Question type.** Each essay question gets exactly one Question type. There are 15:
   - why-company
   - what-youd-build (includes "if we didn't exist")
   - values
   - why-role (includes why-you and fit)
   - preference
   - best-project
   - named-area
   - failure (challenge, behavioral, disagreement, initiative)
   - not-on-resume (exceptional, teach us)
   - ai-tools
   - opinion (trend, course)
   - why-field (major, goals)
   - about-me
   - anything-else
   - cover-letter

   A question that fits none gets the general fallback. "Structured history" is not an essay: it's resume facts typed into a shape.
   *Sources:* taxonomy.md, lengths-forms.md.
2. **No Claude Code skill.** Plain guidance files in `apply-agent/answering/` are read by `essays.py`: `README.md` (rules for every answer) and `types/<type>.md`. Each type file opens with front matter that code reads: `company_link` (`same-kind` / `never`), `stock` (true/false), `high_stakes`, `length` (default words, when the form states none) and `match` (phrases that identify the type).
   *Sources:* skill-architecture.md. The skill probe failed: skills don't load under `--disable-slash-commands`, a skill costs 13x the input tokens, and the model ignored the skill's instructions.
3. **Pipeline per form** (changed by decision 15):
   1. **Plan:** one call that picks, per question, its type, its parts, its main story, its company fact and an angle away from the typical answer, and fills the type's slots, each with the Story bank or brief lines that back it, quoted.
   2. **Code checks on the plan:** the stories exist, no story leads two answers, the company fact is a real brief line, every part of the question is covered, and every slot's quote is really in its source. A required slot with no backing holds the question. An optional slot with no backing is left out.
   3. **Write:** one draft per question, from the plan's slots only.
   4. **Edit:** the existing editor pass, whose loop is also flagged what the gates find.
   5. **Gates:** code checks on the edited text; what still fails holds the Application.

   The 1-10 reader review (`writing._review`) is removed: it raised unsupported claims from 8 to 13.
   *Sources:* g-quality.md, deep-general.md.
4. **Stock answers** are kept per type. Only types with `stock: true` qualify:
   - best-project
   - named-area
   - failure
   - not-on-resume
   - ai-tools
   - opinion
   - why-field
   - about-me

   Company-facing types are never stock. Before Lisul approves a type, Claude writes a fresh answer and uses it, and the answer appears in the Answers tab as "Save as stock answer?". Nothing is saved without his click. The four old stock answers become voice and fact material only; they are no longer pasted in as answers.
5. **Company link.**
   - **Company-facing types:** link one company fact to his work only when it is the same kind of problem. Otherwise, give a sincere and specific interest in one fact.
   - **Types about him:** never add a company sentence.
   - The swap test applies: a sentence that still reads true with a competitor's name in it fails.

   *Sources:* research-why.md, deep-company.md.
6. **Preference questions** get a real pick: the area his strongest story supports, backed by that project, and one closing line of flexibility. The old "open to any team" rule is gone.
7. **Optional boxes** are always answered (memory: a blank optional is a bug). The writer must find one new, specific thing to say, and the critic catches generic answers.
8. **The plan is shown at a Hold.** The Tracker's essay cell shows each question's type, story and company fact above the answers.
9. **Proof** (changed by decision 15). Lisul's blind picks decide. A page shows him about 24 unlabelled pairs of old and new answers, and he picks the better of each. After that, a per-type checklist judge is calibrated on his picks. A prompt is never tested on the set it was tuned on. The paired judge (`research/sources/essay-eval/judge.py`) is not trusted: one model plays every reader, it favours length, and it uses no per-type criteria.
10. **Lengths.** These are the defaults when the form states no length:

    | Type | Words |
    |---|---|
    | why-company | 70-120 |
    | what-youd-build | 60-120 |
    | values | 80-140 |
    | why-role | 60-120 |
    | preference | 25-45 after a dropdown, else 60-100 |
    | best-project | 80-120 (two items: 60-90 each) |
    | named-area | 60-100 |
    | failure | 120-160 |
    | not-on-resume | 50-90 |
    | ai-tools | 80-130 (a tools list: 25-60) |
    | opinion | 80-120 |
    | why-field | 70-120 |
    | about-me | 100-160 |
    | anything-else | 20-45 |
    | cover-letter | 200-300, at most 350 |

    When the form does state a limit:
    - **Word limit:** fill 75-95% of it, never over.
    - **Sentence range:** aim for the top of it; "a few" means 3-4.
    - **Character cap:** fill 80-95% of it.
    - **Single-line field:** 1-2 sentences, under 255 characters.

    *Sources:* lengths-forms.md (513 forms), lengths-company.md, lengths-story.md, lengths-other.md.
11. **The story map** (`apply story-map`) replaces regenerated prompts. It tags each Story bank episode once with its question types, problem kinds, follow-ups and never-claims. Lisul reviews the tags, and they regenerate only when he runs the command. The plan's company link must share a problem kind with the story it links.
    *Sources:* g-personalize.md.
12. **Company research rebuild.** Every fact has to earn its place:
    - engineering facts come first;
    - each fact is checked against a quote from its page, falling back to the Worker's browser on a 403;
    - values are copied word for word;
    - extra research runs per question type the form asks;
    - each fact carries problem tags;
    - empty or duplicate team sections are dropped.

    When the research can't find what a question needs, that question is held for Lisul.
    *Sources:* g-company-research.md.
13. **Sameness.** The writer steers away from the typical answer:
    - **Default probe:** what a typical applicant would write, with no facts about him.
    - **Angle selection:** angles that steer away from that answer.
    - **Voice samples:** pieces on different topics.
    - **Sameness check:** run after the edit.
    - **Ledger:** past answers, used for cross-application overlap, and the story each answer led with, so the same story doesn't lead at every company.

    The default probe is advisory (decision 15): it never holds an Application. A fact the Story bank lacks is asked during the fill instead (decision 15). The ledger keeps the story each sent answer led with, and the plan steers off the last 3 of each type at other companies.

    *Sources:* g-sameness.md.
14. **Bugs fixed first:**
    - the question's description, limit, field kind and required flag now reach the essay call (they were dropped);
    - answers given earlier on the same form now reach the essay call;
    - research `sample.py` no longer treats ", UK" as a US state, and now reads SF, NYC and LA as US.

    *Sources:* g-inputs.md.
15. **Evidence first** (decided 2026-10-22, after the eval). In the eval the new writer lost to the old one, 52 of 288 votes, but those judges are unreliable. The objective problem is that the writer invents things: 11 unsupported claims against the old writer's 3. These were invented lessons, feelings and filled-in details, each one asked for by a guide when the Story bank had nothing to back it. So:
    - The infrastructure stays. The writing core is rebuilt around the plan's backed slots (decision 3).
    - The two candidates, the pairwise pick, the 3× checklist critic and its repair loop are dropped. Each one comes back only if a test shows it helps.
    - A required slot with no backing asks Lisul during the fill: the question for the missing fact appears in the dashboard's Needs you tab. His answer is saved to the Story bank, and then the essay is written. This replaces asking him ahead of time with `/resume-interview` (Lisul, 2026-10-25: "prompt me when we are autofilling", which "functions as a test too").
    - The guides are rewritten from real judged examples. Where no real candidate's answer exists, a coach's or employer's model answer may stand in, labelled as such (Lisul, 2026-10-25). Each one gets its slots, yes/no rules with a reason for each, real reader quotes, and 2-3 real weak→strong pairs. The cover letter gets 3-5 real judged letters. The examples are in `research/sources/answer-types/deep-examples.md` and `research/sources/answer-types/examples/`.
    - Later, as data comes in: learn rules from Lisul's edits at Holds, fix clustered failures, and add variants by company kind. No DSPy or GEPA until he has about 100 labels.

    Order: collect examples, rewrite the guides, rebuild the plan and drafting core, remove the dropped paths, build the blind-reading page, then change one thing at a time against a held-out set.

## Working rules for every change

- Atomic commits, one step each. The subject is an imperative summary with no ticket (the branch has none). Commits mention no AI.
- Targeted tests only: `uv run pytest tests/<file> -k <name>`. Never run the full suite.
- Never submit an application. Rehearsals never submit.
- Never kill a process you didn't start.
- `FakeClaude` in `tests/fakes.py` tells calls apart by their schema. Every new Claude call needs a branch there.
