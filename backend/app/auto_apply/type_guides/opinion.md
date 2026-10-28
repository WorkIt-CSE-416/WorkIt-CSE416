---
type: opinion
summary: "a narrow view the student earned by doing, with its limit (also a trend, a course)"
company_link: never
length: [80, 120]
match:
  - "\\btrends?\\b|advancements?\\b|recent advances?\\b"
  - "(paper|blog post|documentation) you('ve| have)? read"
  - "(favorite|top|best) .*courses?|courses? (taken|you took)"
  - "in your opinion|your take"
  - "(technology|tool|project) .*caught your attention|most interesting topic"
  - "favorite (software )?(product|paper)"
  - "what would you change"
  - "feedback to change"
  - "how would you (approach|measure)"
  - "\\$1 million|1 million"
  - "code sample"
  - "^why should we"
  - "problem would you happily"
  - "may not accurately reflect"
slots:
  - name: claim
    required: true
    holds: a narrow, specific view about a technology, technique, course or product, naming the concrete thing
  - name: reason
    required: true
    holds: why the student holds it, from something the student built, measured, broke or saw in their own work
  - name: did
    required: false
    holds: what the student did because of it (built, migrated, measured, chose); used when the question asks
  - name: limit
    required: false
    holds: where the view stops being true, or what it costs, from their own work
  - name: read
    required: false
    holds: what the student read that shaped the view, when it came from reading
---

## What the reader is checking

A view the student earned by doing, stated as a claim someone could disagree with. A consensus line, a survey or a lesson about themselves fails.

- "The first and the second statements might be true, but many people already agree with them. The third statement simply takes one side in a familiar debate." and "A good answer takes the following form: 'Most people believe in x, but the truth is the opposite of x.'" (Peter Thiel, O8)
- "Why? What have you done to learn about it? Please be specific." (Aubrey Lear, Viget, writing the rubric into an internship question, opinion reader quotes)
- "Don't answer the 'fascinating thing' question with something you learned about yourself. This doesn't demonstrate intellectual curiosity, which is what this question is there to measure." (Recurse Center, A34)
- "If they don't have opinions they probably haven't actually used the language they put on their resume" (Blind, Lenovo-tagged engineer, opinion reader quotes)

## Order

The claim in sentence one, flat. Then the reason from their work, then what the student did with it, then the limit if the sources hold one. A16 opens "Competing products work at the wrong layer of abstraction" and spends the rest on the mechanism.

**Something surprising the student found:** the fact, then proof the student acted on it. FamilyLeaf's Gmail-dots trick ends "(I am 6 down, and 6 to-go)" (A20).
**Favorite course:** the course, the one idea it gave them, where the student used it outside class. Only courses in the sources.
**A product the student would change:** the product, the one change, the user problem behind it, and what it would cost.
**"What makes a great X":** one trait ranked first, why from the role's hard part, one moment the student did it.

## Rules

Each is a yes/no check on the draft.

1. **Would a reader disagree with sentence one, or at least not already agree?** "Software is built by teams, not individuals." (O10) and "Our educational system is broken and urgently needs to be fixed." (O8) fail: most people already agree. A side of a familiar debate fails too (O8).
2. **Is the claim narrow and the thing named?** A16 names the abstraction ("The 'online disk drive' abstraction sucks, because you can't work offline"). "no one knows the best button color" (A20 Apptimize) gives no claim to test.
3. **Is there at least one fact the student observed or did, not read?** A20 FamilyLeaf has a mechanism and proof its writer used it. A20 Mixpanel fails: "Users have the tendency to defy your expectations all the time. If you don't listen, you won't survive."
4. **Is it about the world or a technology, not about themselves?** RC's rule (A34); both of Treen's "fascinating thing" answers broke it.
5. **Is the claim a mechanism, not a size?** "we think this is a pretty big opportunity" (A19) is a market claim with no insight behind it.
6. **If the question asks why and what the student has done, is each answered?** Viget asks both. Thiel's fellowship prompt adds "If this belief shapes the way you live, tell us how" (O9).
7. **If the view came from reading, does it say what the student read and what the student tried next?** Never fake hands-on use; the read slot holds the source.
8. **Is a limit, when there is one, tested against their own claim?** A20 smallpox: "Even if we assume that all foreign aid was completely wasted ..., it would still have saved a life for every $40,000 spent." A18: "In an ideal world ... However, today, most companies have already invested". A list of pros and cons with no pick is not a limit.
9. **Is every slot backed?** Write only the slots the plan backs. With no limit in the sources, end on what the student did. A light, true personal claim can carry a grand prompt: "Chocolate is repulsive." (O9, accepted).

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A20: the same YC prompt, "something surprising you discovered" (real applicants, all accepted).**
- Weak: "Users have the tendency to defy your expectations all the time. If you don't listen, you won't survive." / "People think it's red, but no one knows the best button color."
- Strong: "The eradication of smallpox in 1973 has saved five times more lives than world peace since that time would have done. Even if we assume that all foreign aid was completely wasted except insofar as it caused the eradication of smallpox, it would still have saved a life for every $40,000 spent."
- Why: the weak ones are a platitude and a shrug. The strong one is a checkable claim that stress-tests itself under the harshest assumption.

**A16 vs O10: the same YC question, both accepted (real applicants).** "What do you understand about your business that other companies in it just don't get?"
- Weak: "Software is built by teams, not individuals."
- Strong: "Competing products work at the wrong layer of abstraction and/or force the user to constantly think and do things. The 'online disk drive' abstraction sucks, because you can't work offline and the OS support is extremely brittle. Anything that depends on manual emailing/uploading (i.e. anything web-based) is a non-starter, because it's basically doing version control in your head..."
- Why: short is fine; consensus with no reason is not. The strong one names the mechanism and why each rival fails.

**O8: the asker's bad answers vs his form (Thiel's own model).**
- Weak: "America is exceptional." / "There is no God."
- Strong form: "most people think the future of the world will be defined by globalization, but the truth is that technology matters more."
- Why: the weak ones are consensus or one side of a known debate. Thiel grades the form; his own line still needs the reason slot to stand.
