# Built resumes render as LaTeX through Tectonic, so templates match Overleaf exactly

Status: accepted; under review 2026-10-27 (`../live_page.md`). The editor
will show an HTML page while the student types, with the PDF still the
only output. Typst is being considered again for editing in place, which
would supersede this ADR.

A built resume's PDF is compiled from the template's own LaTeX by Tectonic inside the FastAPI function. Jake's Resume is copied byte for byte from its MIT-licensed source, so the PDF is the page students already know from Overleaf. The rendered PDF is the only look: the preview shows it, and there is no fallback renderer. Word files share one plain layout for every template.

## Considered Options

- **Typst** (the `typst` Python package): about the same added size (~77 MB against Tectonic's ~71 MB), no network at build time, tagged PDFs, and applicant text passed as data with no escaping. Rejected because each template must be re-implemented, and the result is only close to the Overleaf original. The team wants an exact match to templates already tuned on Overleaf, and wants to copy more of them.
- **WeasyPrint**: needs Pango and other system libraries that the Vercel Python runtime lacks.
- **react-pdf in Next.js**: has ligature text-extraction bugs and moves rendering out of the API.

## Consequences

- The build downloads a pinned Tectonic binary and warms its package cache. If Vercel's build machine cannot reach the hosts, the binary and cache come from a release asset in this repo.
- All applicant text passes through one tested escape function, and Tectonic runs `--untrusted --only-cached`.
- The PDFs are not tagged. The CI text test reads them in plain mode.
- The fonts cover accented Latin only. The student is warned before download when their text uses a character the font lacks.
