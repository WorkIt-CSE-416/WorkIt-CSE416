# Custom sections (KAN-498)

Status: **built 2026-11-05**, the design the user approved that day. Apply
migration `c9e4a1d7b498` before the deploy (`backend/CLAUDE.md`,
Deployment).

A student can add a section the bank has no fixed place for: Volunteering,
Languages, Interests, Publications or a Summary. Before this, the bank and
every built resume had seven fixed sections, and import dropped the text
under any other heading the parser found.

## The decisions

| Question | Decision | Why |
|---|---|---|
| What a section holds | The student picks **Entries** or **Lines** when they add it; it never changes | Entries fit Volunteering and Publications; Lines fit a Summary, Languages and Interests |
| How many | **5 per owner** (an upload, or the student's own) | Keeps the section nav and the editor's Sections panel short |
| Import | Each heading the bank has no section for becomes a **Lines** section of that name, owned by the upload; **References** is skipped | It was found and thrown away; References says nothing about the student |
| Where it prints | **Last**, after Technical Skills; a section whose name holds Summary, Objective, Profile or About Me prints **first**; the student drags any section in the Sections panel | Most extra sections close a resume; a summary opens it |
| Fit to One Page | **Cut first**: bullets before Awards' bullets, whole entries before Leadership's | The student's own sections are the least needed; Fit must be able to cut them, since its last step leaves the header alone |
| Tailor | Reads them as any shown entry, with no code of its own | Tailor reads the built resume view, which already holds them |
| A Summary | Offered as a suggested name in Add a Section (a Lines section) | KAN-289 (add a summary to the experience bank and resume parsing) was set aside for its cost; this costs no code of its own |

## The model

- `bank_section` gains `custom`. A custom entry is a `bank_entries` row with
  section `custom` and `custom_section_id` set; the CHECK
  `bank_entries_custom_section_check` keeps the two together.
- `bank_custom_sections` holds each section: `name`, `layout` (`entries` or
  `lines`), and `resume_id`, its owner, the same rule as an entry's (ADR
  0005): an import's sections belong to the upload, go with it and are
  replaced by Import Again; one the student adds belongs to the picked
  upload, or to the student (no owner) under All Experiences or a built
  resume. One name per owner, ignoring case (`bank_custom_sections_owner_name_key`,
  `NULLS NOT DISTINCT`). RLS on, no policies.
- A custom section never takes a fixed section's printed name (Education,
  Leadership & Activities, Technical Skills...): the page would print two
  headings of that name (422).
- **A Lines section's lines are bullets.** The section holds one entry,
  titled with the section's name, and its bullets are the lines. So bold
  and italic, Add Bullet, hiding a line, Tailor's rewording and Fit's
  bullet cuts all work on them with no code of their own. The title never
  prints.

## On a built resume

- **The view groups custom sections by name** (`resume_view.custom_key`,
  "custom:<name>", case and spacing ignored): two uploads that each hold a
  Languages section print one Languages heading. The first section's name
  and layout win.
- **Entries print as a project does**: title | organization on the left,
  dates on the right, then bullets. There is no location. **Lines print
  with no heading and no dot**, each line a `\resumeItem` in the list
  the skills sit in, and each line is a bullet box to the editor.
- **The order is `PageSettings.section_order`**, which now takes custom
  keys after the seven fixed sections (each once, at most 30, 80 characters
  each). A custom section the order does not name prints by
  `resume_render.printed_order` (summary first, else last); the editor's
  Sections panel lists the same order (`model.ts`'s `printedOrder`) and a
  drag writes the custom keys into the order. A rename changes the key, so
  a renamed section goes back to its default place.
- **A sent resume's hash is unchanged for a resume with no custom
  section**: a fixed section's empty `label` and `layout` stay out of
  `content_hash`, as an empty `marked` does.

## The screens

- **Experiences view**: a card per custom section after the fixed ones,
  with the section mark every custom section wears. Add a Section sits at
  the end of the quiet line under the cards; its card takes a name (with
  Summary, Volunteering, Languages, Interests and Publications offered) and
  the layout, then opens the new section to fill. A section's pencil holds
  Rename, Delete Section (with its entries) and, for Entries, Clear All.
  Under All Experiences, two sections of one name each add their owner's
  name.
- **Resume editor**: the Experiences picker and Cut From Resume group
  custom entries under their section's name; the Sections panel lists them
  where they print.
- **Onboarding's parse preview** lists each Lines section the reading
  found under its heading.

## Still open

- Scout's facts (`workit_scout.facts`) and the autofiller read the six
  fixed sections only, so a custom section's text never reaches Scout.
- Read It With AI reads the six fixed sections; its import keeps the
  parser's custom sections (`bank_import.other_drafts`), so the model never
  reads them.
- An entry's layout cannot change: a student who picked the wrong one
  deletes the section and adds it again.
- Intake (Fill With Scout) asks about the fixed sections only.
