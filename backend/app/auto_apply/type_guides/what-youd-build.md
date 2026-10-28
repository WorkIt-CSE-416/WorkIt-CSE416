---
type: what-youd-build
summary: "a real problem of theirs, why it is hard, a modest approach (includes \"if we didn't exist\")"
company_link: same-kind
length: [60, 120]
match:
  - "didn't exist|did not exist|didn’t exist"
  - "what (would|do) you (want to )?(build|work on)"
  - "\\b(build|building|work on|working on|contribute to|focus on|focusing on|explore|exploring)\\b(?! an? (\\w+ )?career).*\\b(here|with us|at [a-z]|during (your|the|my)|in (your|the|my) (next )?internship|tonight)"
  - "(products?|features?) .*(interested in|excited about|want to) (build|work)"
  - "which .*(projects?|problems?).*(resonates|excit|interest)"
  - "one thing .* (is|are) working on"
  - "research question"
  - "what are you most excited to work on"
  - "particular aspect of"
slots:
  - name: problem
    required: true
    holds: one real problem of theirs or their users, quoted from the company brief or the posting; a problem, not a feature label
  - name: obstacle
    required: true
    holds: what makes it hard, from the brief or from the same kind of problem in their own work
  - name: first-step
    required: true
    holds: one modest first step and what the student would measure, built from a method the sources show the student has used
  - name: progress
    required: false
    holds: their own work on the same kind of problem, with what exists now (a link, a prototype, a result)
---

## What the reader is checking

That the student understands their problem and what makes it hard. A deliverable with no problem, or an edge of "better execution", reads as no insight.

- "we want to see that you're aware of the obstacles, and have at least a theory about how to overcome them." (Paul Graham, YC)
- Of "I will write a tree class": "not a good proposal, and will be ranked with the lowest possible score." "A proposal is not just a statement of intent." (Boost reviewers, who rank GSoC proposals, E26)
- "If you begin with the product, you've already started on the wrong foot." (Chris Lee, product-design recruiter, E27)
- "The most important thing that we look for in proposals is that you understand the project. You can show this by describing how you would approach the implementation." (Haskell.org committee, E29)

## Order

The problem first, then the obstacle, then their first step, then their progress if the plan backs it. Problem and obstacle together take about half the words.

**Form lists projects or products:** pick from the list, say which, then the same order.
**"If [company] didn't exist":** name a kind of problem, not a company; the driver from the sources; their progress on it. A brand fails: "Google" for "If not Palantir" read as prestige (A39).
**Multi-part ask** ("what you're proud of and what you'd build next"): answer both. D1 was rejected partly because the applicant "conveniently skipped" this part.

## Rules

Each is a yes/no check on the draft.

1. **Does the first sentence name a problem, not a deliverable?** "I will write a tree class" got the lowest score (E26). X-for-Y labels like "Github for CAD" name no problem (E28).
2. **Is the problem traceable to the brief or the posting?** Never claim knowledge of their internals.
3. **Does it name what makes the problem hard?** D9: "obtaining a 'large quantity of suitable data' would be the most challenging". PG: "if we can see obstacles to your idea that you don't seem to have considered, that's a bad sign."
4. **Is the edge more than execution?** "well-designed and easy to use" is "not an insight. You're just claiming you're going to execute well." (PG, A3) "make it easier to use" fails the same way (E27).
5. **Is the first step modest enough for an intern's summer?** PG's strong form is a toehold: "We know that sounds impossible, but we think we can get a toehold initially by..." (A1).
6. **Is any of it already started?** Prefer yes. A31's same project was rejected as an idea and admitted as a live tool.
7. **Is their progress the same kind of problem?** Bolted-on work reads as a stretch. With no same-kind work, leave progress out.
8. **Is every slot backed?** The problem is quoted from the company brief or posting; the obstacle and first step rest on a quoted line from the brief or the student's experience. With no progress in the sources, end on the first step.

## Pairs

The words in these belong to other people. Use them to see the shape; never borrow a phrase.

**A1: the judge's own models (Paul Graham, YC).**
- Weak: "We are going to transform the relationship between individuals and information."
- Strong: "A new search engine to compete with Google." followed by "We know that sounds impossible, but we think we can get a toehold initially by..."
- Why: PG on the weak one: "It could be a description of any technology company." The strong one names the obstacle itself and offers a first step.

**A31: real applicant, rejected then admitted (Recurse Center), same project.**
- Weak: "I'm dying to build an easy way to self-publish ebooks. I constantly find myself with 50 open tabs [...] I want to devote proper time to make it a real tool."
- Strong: "I'm currently working on a project called EpubPress. It's a Chrome Extension that let's you turn your tabs into custom ebooks (https://epub.press). I want to build more extensions, integrate it into more platforms. It has also gotten me really interested in content extraction algorithms for webpages."
- Why: the applicant: "The first time I applied, it was just an idea. [...] The second time it was a fairly mature project. I also had specific improvements."

**E26 vs D9: reviewers' bad pattern vs real fellowship applicant (outcome not stated).**
- Weak: "I will write a tree class"
- Strong: "A product that doesn't yet exist, but should (and I am working towards realizing it) is a 2-way sign language translator for the deaf [...]", then deaf students as a first segment for "consistent and repetitive data", and the risk that "obtaining a 'large quantity of suitable data' would be the most challenging".
- Why: the strong one fills problem, obstacle, first-step and progress; the weak one is a deliverable alone.
