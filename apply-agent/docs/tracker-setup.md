# Setting up the Tracker

This is a one-time checklist that takes you from nothing to a working Tracker Sheet in about 15 minutes. Apply writes the Sheet as a Google Cloud *service account*. That is a robot Google identity with no browser login and no token that expires, so the Daily sweep runs unattended. You create the account and its key yourself. No agent ever creates projects or keys.

## 1. Create a Cloud project

- [ ] Open <https://console.cloud.google.com/> signed in to your personal Google account.
- [ ] Use the project picker (top left), then **New project**. Name it `apply-tracker` and click **Create**, then select the project.

## 2. Turn on the two APIs

- [ ] Go to **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**.
- [ ] Do the same for **Google Drive API**.

## 3. Create the service account

- [ ] Go to **APIs & Services → Credentials → Create credentials → Service account**.
- [ ] Name it `apply-tracker` and click **Done**. It needs no roles, so skip the optional steps.
- [ ] Copy its email address, which looks like `apply-tracker@apply-tracker-123456.iam.gserviceaccount.com`. You need it in step 5.

## 4. Download its key, outside the repo

- [ ] Open the service account and go to **Keys → Add key → Create new key → JSON → Create**. A `.json` file downloads.
- [ ] Move it into place and lock it down:

  ```sh
  mkdir -p ~/.config/gspread
  mv ~/Downloads/apply-tracker-*.json ~/.config/gspread/service_account.json
  chmod 600 ~/.config/gspread/service_account.json
  ```

- [ ] Never commit this file, and never put it inside a git checkout. Anyone holding it can edit every Sheet you share with the account.

If Google refuses to create a key ("Service account key creation is disabled"), the project is under an organization policy. Create the project with no organization (the "No organization" location) and try again. If that still fails, stop and raise it, because the fallback is an OAuth login that has to be renewed every 7 days.

## 5. Create the Sheet and share it

- [ ] At <https://sheets.new>, create a blank Sheet in your own Drive and name it `Apply Tracker`.
- [ ] Click **Share**, paste the service account's email from step 3, choose **Editor**, untick **Notify people**, and click **Share**. Without this step Apply fails with `SpreadsheetNotFound`.

## 6. Lay out the Sheet

- [ ] From `apply-agent/` in your checkout, run this with your Sheet's URL:

  ```sh
  uv run python -m apply.sheet setup "https://docs.google.com/spreadsheets/d/<id>/edit"
  ```

  It prints `The Tracker is ready: <url>`. It saves the Sheet's ID to `sheet-id` in the data folder (`$APPLY_HOME`, default `~/.config/apply`), which live runs read. Until it is there, the Tracker is off: rehearsals still work, `apply run` doesn't, and `apply doctor` says so. Running it again is safe, because it only adds what is missing.

- [ ] Open the Sheet and check what setup made:
  - four tabs: **Applications**, **Requests**, **Employer accounts** and **Answers**, each with a frozen, bold header row (a Tracker set up before the Answers tab gets it at the next run);
  - on Applications, a checkbox in **Approve**, a dropdown in **Outcome** (rejected, OA, interview, offer, ghosted) and a dropdown in **Status**;
  - three saved filter views under **Data → Filter views**: **Held**, **Handoff** and **Missing fact**;
  - Apply's machine columns hidden on Applications (Application ID, Job system, Reason, Record, Missing fact options, Confirmation received, Bot signals: unhide them to debug), **Status** colored (submitted green, held yellow, missing fact orange, failed red), each **Posting** a link and column widths set. Rerun setup, or the rank command below, to link the Postings of rows added since.

That's it. The Tracker works.

## Using the Tracker

Apply writes every column except four, which are yours. Apply only reads them and never overwrites them:

| Column | What you do |
|---|---|
| **Approve** | Tick it to release a held Application. The next pass (any `apply run`, including the 5-minute Requests check, or `apply approve-pass`) fills the form again with your essay, checks it and submits it. If the check fails, the row goes back to Held with the reason, starting "Held again after your approval". Apply won't try that approval again until you edit the essay, or untick Approve, let one pass go by and tick it again. |
| **Outcome** | Pick what came of a submitted Application. |
| **Essay** | On a held row, edit the essay before you approve it. Keep each `## <question>` line as it is: Apply finds each essay by its question. |
| **Answer** | On a Missing fact row, answer the question in **Missing fact**. The answer joins your Applicant profile and the Application resumes. |

- Use the saved filter views as your inbox: **Held** to approve, **Handoff** to finish by hand, **Missing fact** to answer.
- Run `apply mail` to read your recent employer mail (read-only). It fills two of Apply's columns: **Confirmation received**, the day a mail showed the Application arrived, and **Suggested outcome** (rejected, OA or interview), what the latest mail says came of it. It never touches **Outcome**: copy the suggestion there when you agree. A Handoff row an employer's mail shows arrived becomes Submitted. A Sheet set up before these columns gets them at the end of its header row on the first write.
- To add a Posting yourself, paste its link into the next empty row of the **Requests** tab. Apply picks it up and removes the link once the Application has its own row.
- **Employer accounts** lists every login Apply created for you. The passwords are in macOS Keychain, never in the Sheet.
- **Answers** lists the Answer bank: every one-off question Claude answered for you (a question no profile fact or rule covers), with the answer every form now gets, the company that first asked and when. Edit **Answer** to change it, or tick **Reviewed** once you agree. The next run copies your change into the data folder's `answer-bank.yaml` (as yours: `source: lisul`), and every form from then on sends it word for word. Leave **Claude's draft** as it is: an Answer that differs from it is how Apply sees your edit. For a select-all-that-apply question, separate the options with `;`.
- Sort and filter inside a filter view. That sorts only your view and never moves rows. **Data → Sort sheet** is also safe between Apply's writes, because rows are found by Application ID, but it reorders the Sheet for everyone.
- **Bot signals** says how the Worker's Chrome ran on a filled form (`headless` or `headed`, set by `worker_headless` in the data folder's `policies.yaml`) and any Bot signal the job system showed, as in `headless: captcha`. `apply signals` counts them per mode and job system. A Sheet set up before this column gets its **Bot signals** header added at the end of the header row the first time Apply writes one.
- To write the ranked tabs (**Top 500**, **Not open yet** and **Quant**) from a research results file, run `uv run python -m apply.rankings <results-file>` (the file's format is `RankedCompany` in `src/apply/rankings.py`). It also tidies Applications as setup does, linking the Postings of rows added since. A rerun replaces each ranked tab's rows and never changes a cell on Applications.
- Don't rename the Tracker's tabs or its header cells. Apply finds its columns by those names. Moving columns or adding your own columns is fine.

## Optional: run the live Tracker tests

The tests run against an in-memory fake. To run the same contract against the real Sheets API as well, create a second, scratch Sheet (never the real Tracker, because the tests delete and recreate its tabs), share it with the service account as in step 5, and run:

```sh
APPLY_TEST_SHEET_ID=<scratch-sheet-id> uv run pytest -q tests/test_tracker_contract.py tests/test_sheet_tracker.py
```
