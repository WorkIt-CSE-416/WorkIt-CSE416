# The editor's live page

Status: step 1 partly built (KAN-391, 2026-10-29): each edit renders
from the editor's copy with no database read while its save writes
beside it, every box carries its printed text, and the
typed line reflows the page below it on its page (option A below). The
whole page as HTML (option B) is not built. Step 2, editing in place on a
page that Typst draws, is under consideration only. Read this before changing how
the editor shows an edit, and before choosing a new renderer.

## The problem

Each save in the editor costs one full LaTeX compile (`resume_render`,
ADR 0002). TeX lays out the whole document in one pass, so one changed
bullet can move every line below it and the page break. No LaTeX setup
can compile one line on its own. Overleaf also compiles the whole
document again on each change.

The round trip is the save, the network, the database read, Tectonic
(about 0.3 to 0.5 s warm on a Mac, more on a cold instance) and the
pdf.js draw. The editor's bar showed it after each save until the user found it noise; a phone still does ("Saved, 412 ms").
Today the typed line shows at once, because the field over it is HTML
set in Latin Modern. The rest of the page (the lines below, the page
break, the page count) waits for the compile.

The dark flash after each render was a different cause: the shown canvas
was sized, and so blanked, before pdf.js drew the new page. It is fixed
by drawing on a hidden canvas first (KAN-391, `PageCanvas` in
`frontend/src/app/(seeker)/resumes/[resumeId]/pdf-pages.tsx`). It needs
no change to the renderer.

## Step 1: an HTML page over the LaTeX PDF

While the student types, the editor shows the whole page as HTML in
Jake's layout, reflowing as they type. The compile runs behind it after
each pause, as it does now. When the latest request's PDF has drawn, the
PDF takes the HTML page's place.

- **The PDF stays the only output.** Download, sent resumes, Fit to One
  Page, the page count and the missing-character warning all read the
  compiled PDF. The HTML page is only what the student watches while
  typing. ADR 0002 stays, except its line that the preview always shows
  the PDF.
- **It cuts the wait the student sees, not the compiles.** Saves still
  wait for `SAVE_AFTER_MS` with no typing, and each one still compiles
  once. Compiling less often is a separate choice, and it can be made
  without the HTML page.
- **One view, one wording.** The HTML page draws the same view the PDF
  does (`build_view`, `backend/app/services/resume_view.py`), with each
  field's text as `fields.py` prints it, sent by the API. It must never
  build its own order or wording: `model.ts` mirrors the order rule only
  to number siblings for a move.
- **Its measures are Jake's, set by the page's settings** (KAN-435): the
  field reads its size, wrapped line and right edge from the render's
  `page_settings` and `wrapped_line`. The page copies `jakes.tex`'s margins,
  sizes, spacing and two-column headings, checked against the PDF's own
  boxes, which give each line's real position. Its fonts are the editor's
  Latin Modern files; the small capitals of the name and the section
  headings need their own file.
- **When the two disagree, the page jumps to the PDF.** A bullet that
  fit one line in HTML can wrap to two in the PDF and push everything
  below it down; a section can move to page 2. A small jump reads as a
  twitch; a moved page break is a large one. The closer the HTML copies
  Jake's measures, the rarer the jumps. Each new template adds an HTML
  layout to keep in step with it.

Built so far (option A, the typed line only):

- **A line goes when the student leaves it:** a click away, Enter,
  Escape or another line sends it, only when its text changed. Nothing
  goes while they type. The rules for typed text (a GPA is a number, a
  label typed back is dropped) are the API's (`services/resume_lines.py`);
  the browser has none.
- **Each box carries its printed text** (`Box.text`), noted by the
  template as it writes each line, so the HTML never needs `fields.py`.
- **The page below the typed line moves as the student types:** the
  editor's canvas clears the line and moves the rest of its page by the
  lines the field gained or lost, click targets too. The page break and
  the page count still wait for the PDF.
- **Leaving a line keeps its typed text on the page** until the PDF that
  prints it has painted. The first build dropped it on leaving, and the
  old line showed for the whole save and compile.
- **Each edit is a render and a save, side by side:** `POST .../render`
  compiles the edit from the editor's copy of the bank, choices, printed
  header, template and file name, reading no database (its token is
  checked by signature alone), and `PUT .../lines` (or `PATCH
  .../choices`) saves it. Neither waits for the other. Renders go one at
  a time, so each copy holds the edits before it.
- **A save is one write, no read:** one statement per kind of line, and
  one for a move, hide, show, toggle or wording switch on items already
  on the resume, each with the ownership check in its WHERE. An item put
  back from the tray that never had a row still reads first.
- **A failed save puts the saved resume back:** the editor reads the bank
  and choices again, renders from the database and says the change was
  not saved. A save refused with 422 needs no reload, since its render
  refuses it too; a 404 reloads, since the render reads the editor's copy
  and an item deleted in another tab is still in it. A render that fails
  for any reason but a refusal (404, 422)
  is sent once more; if it fails again it does the same, since its save
  may have gone through.
- **Moves show at once:** two neighbours' strips of the page trade places
  until the PDF lands. **A hide shows at once too** (KAN-584): each hidden
  entry's or bullet's band of the page closes up, with the space under it
  when the next line is close, and the lines below rise (`gapsOn` in the
  editor, `Gap` in `pdf-pages.tsx`). A hidden skill leaves its line
  instead (`skillCut`): from its start to the next skill's, since each
  skill's box holds its comma, and the rest of the line moves left; the
  line's last skill takes the comma before it. So a Tailor revert of an
  added skill shows at once, as a reworded line's old words and a reorder
  already did. A section emptied by a hide keeps its heading, and a line a
  skill leaves does not pull the next line's skills up, until the PDF
  lands. Show and wording switches show nothing until then.
- **Fit to One Page is an edit like the others** (KAN-584): the editor
  sends its copy and the measure of the PDF it shows (each render answers
  its points, text area and shrinks beside the boxes) to `POST
  .../fit/plan`, which compiles nothing and answers the cuts that fit by
  prediction. The editor renders and saves them as any hide, so they close
  up on the page about one round trip after the click; while the new PDF
  is still over one page, it asks for the next cycle, without painting that
  PDF: only the final one paints, so a prediction a line short shows one
  render, not two. Before, Fit compiled
  the page the editor already showed, read the resume from the database,
  compiled again to confirm, wrote, and read the choices back, all before
  the page changed: two compiles and about ten reads. Measured on a laptop
  (2026-11-03): the cuts left the page 0.42 s after the click, and a
  two-cycle fit ended at about 2.2 s. While it runs, the button reads
  "Fitting…" and the bar "Fitting to One Page…", and Undo, Redo and
  opening a line wait for the last cycle: the page stays in view rather
  than under a modal, since its cuts closing up are the progress.
- **A page setting's compile is skipped when a newer one is next in the
  queue** (each is a full replacement), so five quick clicks on a size
  compile twice, not five times. Every click still saves. A skipped step
  keeps no PDF, nor does the step after it on its before side, so Undo
  renders those, and any step while a page's render is queued renders too,
  or that render would print over it. Typed lines and choice changes are not skipped: a render
  is what refuses a bad one, and each carries only its own edit.
- **Undo and Redo work like any edit:** each step keeps the state and
  PDF on both sides, so going back or forward shows at once and only the
  save goes; an older step, past the newest 7 that keep their PDFs,
  renders like a new edit. 25 steps, in the tab's memory (both numbers
  are first guesses, to tune in `history.ts`).
- **Another tab's edit reaches this one:** each save is announced to the
  other editor tabs in the browser, which read the resume again once
  shown and idle; a tab back after 5 minutes away asks when the resume
  last changed and reads it again only if it changed meanwhile.
- **Measured from a laptop against the shared database:** one round trip
  about 66 ms, loading a resume's view 560 to 730 ms, a compile 410 to
  500 ms (2026-10-28). A line went from about 2.7 to 3.5 s (save, then
  render) to about 2.3 s (one request, compile beside the write), then to
  about 1.8 s (render and save apart), then to about 0.7 s (the render
  reading no database, 2026-10-29). Before that last step the render's
  request waited 1.7 s on the server, most of it the sign-in check's and
  the resume's rows, each read over a new connection, since the local API
  keeps none open (`DB_POOL_SIZE` 0); now it waits 0.55 to 0.66 s, most of
  it the compile.

Still open for step 1:

- Option B: the whole page as HTML in Jake's measures, built from the
  boxes' text. Worth it only if option A's jumps prove common.
- How to measure the jumps (the field's line count against the box's
  once the PDF lands), to see whether the browser wraps close enough to
  TeX.
- A line split across a page break moves only its first page.
- A line the student is still on when the tab closes is not saved.
- Show and a wording switch show nothing until the PDF lands; a section
  a hide empties keeps its heading, and a skill line keeps its wrap, until
  then.
- The time of one compile alone on the deployed API. A compile is nearly
  all CPU, 0.41 CPU seconds in a laptop's 0.42 s of waiting (KAN-524,
  2026-11-02), and the Container has 1/4 vCPU
  (`backend/cloudflare/wrangler.jsonc`). Measured on the live site that
  day, signed in, in the browser: the editor's page, whose load holds one
  compile, took 5.2 to 6.7 s in 9 of 11 loads and 13 and 19 s in the other
  two; the Resumes page, with no compile, took 0.4 to 0.8 s. So a compile
  there is likely several seconds, and every edit that renders waits for
  it: a revert, an Undo past the kept PDFs, and Fit to One Page twice or
  more. Undo and Redo with kept PDFs still wait for any render ahead of
  them in the queue. `/health/db?timing=true` showed three bands the same
  day, about 12, 47 and 75 ms, against the 8 to 30 ms expected from ENAM, so
  the three Containers may not be alike.

## Step 2, under consideration: edit in place on a page Typst draws

The jumps go away only when one engine draws both the screen and the
PDF. Typst does that: its compiler runs in the browser through
WebAssembly, compiles in milliseconds because it reuses the last
compile's work, and the server compiles with the same compiler. The
student would type on the real page, and the download would match it
exactly.

What changes and what stays:

- **Stays:** the bank, the choices, `build_view`, the boxes and every
  feature that reads the view.
- **Changes:** the template layer. `jakes.py`, `jakes.tex` and the
  `\wimark` markers become a Typst template. Typst reports where each
  element sits, so the boxes need no markers.
- **Gains:** the resume goes in as data, with no escaping, so `escape()`
  and the risk it guards (`\input{/etc/passwd}`) go away; clearer errors;
  tagged PDFs, which record headings and reading order.
- **Loses:** the exact Overleaf look, which ADR 0002 chose Typst out for;
  Download LaTeX, since Overleaf does not run Typst; Overleaf's thousands
  of tested templates; LaTeX's age and stability (Typst came out in 2023).

Choosing it reverses ADR 0002 and needs a new ADR. Before that: a
prototype of Jake's Resume in Typst, compiled in the browser, to see
whether it looks close enough.

## Options ruled out

- **Editing the PDF itself (PyMuPDF and similar).** A PDF holds
  characters placed at fixed points, with no paragraphs. A library can
  erase text and write new text at a point, but nothing wraps a longer
  line, pushes the lines below, breaks the page, or draws a letter the
  file's font subset lacks. That would mean writing a layout engine.
- **react-pdf.** It draws in the browser too, but ADR 0002 found
  ligature text-extraction bugs ("fi" read back wrong), and a hiring
  system reads the text out of the PDF. Its text layout is also simpler
  than TeX's or Typst's, and it moves rendering out of the API.
- **HTML as the resume, printed by a server browser** (Chromium,
  Cloudflare Browser Rendering). The screen and the PDF match, but page
  breaks in print CSS are harder to control, and the Overleaf look is
  lost. Kept as the second choice if Typst falls short.
- **Storing PDFs for speed.** A stored PDF helps a repeat view (Undo, a
  second open) skip a compile. A new edit always needs a new PDF, so it
  does not make typing smoother.
