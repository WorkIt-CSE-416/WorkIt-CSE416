# One TypeScript Fill engine shared with the WorkIt extension

Apply's Fillers and answer rules move out of Python into one TypeScript Fill engine, which Apply loads into the form's page through Playwright and the WorkIt extension loads as a content script, so a fix to filling lands once for both. The extension can only run JavaScript in the page, so a shared engine has to be JavaScript; the rules move too (rather than staying in Python behind the WorkIt backend) so the engine is one language and the extension needs no server round trip to fill. The extension's own fill code is dropped rather than merged: it failed on most forms, while Apply's Fillers are proven on live forms and recorded fixtures.

The engine is its own private repo in the workitjobs org, not a folder of the WorkIt repo, which is public: the team does not want the fill code shared.

## Consequences

- Python Fillers are no longer developed; each one is deleted in the change that moves its job system to the engine. So is reading a job from its link: which job system it is, its Question set, names and text are fetched through the host's own fetch and read by the engine, so both hosts ask the same URLs. Apply's Python keeps only what a page can't do: sign-in, Employer accounts and mail codes, deciding to Hold an Application, the Pre-submit check's Claude review, the submit guard and submitting, Claude fill, Rescue, the Tracker, scheduling and Repairs.
- Hold detection is the engine's: its plan marks High-stakes essays, company-specific questions, AI traps and bans and videos (src/holds.ts), so both hosts flag the same questions. Deciding to Hold an Application on those flags stays in Apply; the extension leaves the flagged questions to the student.
- Written answers sit behind one port: Claude in Apply, Scout's essay route in the extension.
- Repairs to filling merge into the engine branch the submodule tracks, under ADR 0002's gate: the engine's main. In the WorkIt repo, Apply loads the extension's submodule (`autofiller_extension/fill-engine`), so Apply and the extension share one pointer. A Repair moves that pointer only on the branch Apply runs from; it reaches main, and so the students, only through a reviewed pull request.
- On a job system with no Filler, the extension fills nothing for now; Apply keeps Claude fill there.
