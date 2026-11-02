# Scripted Fillers, not autofill extensions or a Claude-driven browser

Each job system (Greenhouse, Ashby, Lever, then Workday) gets a fixed Playwright script that fills the form from the Applicant profile. Claude is called only to write free-text answers, in one stripped-down call per Application. Speed and tokens per Application were the deciding priority. Measured on live forms, this fills an Application in 2–15 s and spends zero tokens when the profile answers every question, or about 1–4k with essays. Claude driving the browser step by step would cost an estimated 0.6–1.3M tokens and 45–90 s per Application. Autofill extensions (Simplify Copilot, Jobright) were rejected: they need their own accounts, answer from their own profiles rather than Lisul's, and still leave Claude to find what they missed. Stagehand was rejected because it needs an API key and cannot run on the Max plan.

## Consequences

- A job system without a Filler (Oracle, iCIMS, SmartRecruiters) falls back to a capped Claude-driven fill until a Filler is written.
- When a job system changes its form, its Filler breaks and must be repaired.
- Ashby's Question set comes from an undocumented query. If it breaks, the Ashby Filler reads the questions from the page instead.

Evidence: the filling-engine research (research/filling-engine.md on the research/filling-engine branch of the original private repo).
