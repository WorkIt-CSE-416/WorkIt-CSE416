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
pdf.js draw. The editor's bar shows it after each save ("Saved, 412 ms").
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
- **Its measures are Jake's.** The page copies `jakes.tex`'s margins,
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
  not saved.
- **Moves show at once:** two neighbours' strips of the page trade places
  until the PDF lands. Hide, show and wording switches show nothing until
  then.
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
- Hide, show and a wording switch show nothing until the PDF lands.
- The time on the deployed API, where a round trip is 8 to 30 ms and
  connections stay open: not measured yet.

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
