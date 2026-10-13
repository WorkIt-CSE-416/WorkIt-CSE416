# Editing a resume on a phone

Research for the resume builder redesign (map: KAN-181). It asks how the
KAN-195 editor should work on a phone. On a desktop, the KAN-195 editor works
like this:

- The rendered Letter page is the editor. The student clicks a line and types
  in place.
- Line actions (hide, move, Tailor versions) sit in a sticky bar above the
  page.
- Hidden items go to a "Not on This Resume" tray.
- An assistant docks beside the page.

**Read on 2026-10-13**, unless a line says otherwise. Sources are product help
centers, App Store listings (read through Apple's public lookup API), platform
guidelines and browser vendor docs. A claim marked **(secondary)** comes from
a third-party review or a news article. A claim marked **(snippet)** comes from
a search-engine extract of a primary page that blocked direct reading (HTTP
403). "Unknown" means no primary source says. We did not guess. We did not
sign in to any product, so nothing here comes from using an editor by hand.

## The answer in short

- **No surveyed resume product edits on the rendered page on a phone.** The
  products that edit on a phone use a form, with a separate preview of the
  page.
- **The products that edit on the page are general editors, and they struggle
  on a phone.** Google Docs first shipped its phone page view as read-only.
  Canva's phone app edits on the page, through a separate Layers list and
  toolbars. Overleaf says its phone support is incomplete. It names touch
  targets, the keyboard and zoom as known problems.
- **The job-search tools leave resume editing off the phone.** Simplify's
  iOS app says plainly that its Resume Builder is not in the app. Jobright's
  and Rezi's apps cover finding jobs and tailoring, and do not mention a
  resume editor.
- **The numbers rule out "fit the page, then type on it".** A Letter page
  fitted to a 390 px screen draws 10 pt body text at about 6 px. Apple's
  minimum text size is 11 pt. A resume line is then about 7 px tall. Apple
  asks for 44 pt touch targets, and Material asks for 48 dp.
- **iOS zooms the page when a field with text under 16 px gets focus.** No
  iOS browser lets the page resize itself when the keyboard opens. An input
  drawn at page scale will trigger zoom-on-focus, and fixed bars can sit
  under the keyboard.
- **So a phone layout needs a second way in.** The page can stay as a
  preview, a place to pick a line, or both. The typing itself has to happen in
  a field at full phone size.

## Products

| Product | Phone editor? | On the page, or form + preview? | How edit and preview switch | Reorder and hide on touch |
|---|---|---|---|---|
| Kickresume | Yes. Native iOS and Android apps, synced with the web | Form + preview. The app's captions show "editing fields and a live resume preview" | Unknown in detail. The app shows sections, a live preview and design settings | Unknown. Section layouts are chosen under a Design tab |
| Simplify | No. "The Resume Builder and the cover letter generator aren't in the app yet." | Web builder: the resume split into blocks, edited block by block | Not applicable on a phone. The app tailors the resume for you through Autopilot | Web: drag a "six dot handle". Hide a section, or uncheck "Show Experience" for one entry |
| Jobright | No resume editor is listed. The iOS app finds jobs, scores the match, uploads resumes and runs an AI resume analysis | Unknown | Not applicable | Not applicable |
| Rezi | The new iOS app (Rezi LLC, first released 2026-08-02) is a job-swiping app that "helps you tailor" a resume. It does not mention an editor | Unknown | Unknown | Unknown |
| Teal | No first-party app in the App Store. Phone web use is unknown | Unknown on a phone | Unknown | Unknown |
| Resume.io | No first-party app found. One review says the site is "mobile optimized" and shows a mobile editor and a mobile preview (secondary) | Form + preview on the desktop: inputs left, live preview right (secondary) | Separate editor and preview screens on a phone (secondary, screenshots only) | Desktop: drag sections (secondary). Phone: unknown |
| Canva | Yes. A native app that offers resumes | On the page. You select an element, then type into it | The page is always on screen. Toolbars change with the selection | The Layers panel: Position, then Layers, then press, hold and drag a layer in the list (snippet) |
| Overleaf | Phone browser only. "Some functionality may be limited" | Source text plus a PDF, or the Visual Editor | The phone layout is not documented | Not applicable |
| Google Docs | Yes. Native apps | Both. Pageless view reflows text to the screen. Pages view shows real page breaks | A per-document switch: Page setup, then Pageless on or off | Not applicable |

### Kickresume

- A native app for iOS (first released 2021-06-27, version 4.1.0 on
  2026-10-07) and Android. "You can use it exclusively on your iPhone or pick
  up where you left off on desktop." ([App Store listing](https://apps.apple.com/us/app/id1523618695),
  [Kickresume mobile app page](https://www.kickresume.com/en/mobile-app/))
- The official page's screenshot captions describe "work experience editing
  fields and a live resume preview", and "resume sections, a live preview, and
  design settings". That is a form with a preview, not editing on the page.
  ([Kickresume mobile app page](https://www.kickresume.com/en/mobile-app/))
- The latest release notes add "pre-defined layouts" per section, chosen
  "under the Design tab". Layout is picked from a list, not dragged on the
  page. ([App Store listing](https://apps.apple.com/us/app/id1523618695))
- How the student moves between the form and the preview, and how sections are
  reordered or hidden on a phone: unknown.

### Simplify

- The iOS app (Simplify Jobs Inc., first released 2026-08-25) has Home,
  Search, Applications and Profile tabs. Its help center says: "The Resume
  Builder and the cover letter generator aren't in the app yet."
  ([Getting started with the Simplify iOS app](https://help.simplify.jobs/articles/3745882-getting-started-with-the-simplify-ios-app))
- On a phone, Simplify replaces editing with delegation. Autopilot "tailors
  your resume to that role" and applies. The help center gives "Generate a
  tailored resume" in Autopilot settings as the phone workaround.
  ([App Store listing](https://apps.apple.com/us/app/id6781911255), help article above)
- The web builder shows "your resume split into blocks". Reorder: "Hold the
  six dot handle at the top left of a section, drag it to a new position, then
  release." Hide: "Hide [Section]", or uncheck "Show Experience" on one entry.
  "Hidden sections will not appear on the downloaded resume."
  ([Resume Builder Basics](https://help.simplify.jobs/articles/1996171-resume-builder-basics))

### Jobright

- The iOS app (Jobright Inc., first released 2025-01-13) lists a job feed,
  match scores, alerts and an application tracker. Its release notes add
  "Multiple Resume Upload", a "Primary" resume and "Instant Resume Analysis".
  It does not list a resume editor.
  ([App Store listing](https://apps.apple.com/us/app/id6738236788))
- Whether the web resume tailor works in a phone browser: unknown.

### Rezi

- "Rezi - AI Job Search" (Rezi LLC) first shipped on iOS on 2026-08-02 and is
  at version 0.3.7. It is built around swiping through jobs: "Connect your
  resume once. When you save a job, Rezi helps you tailor it." It does not
  describe an editor. ([App Store listing](https://apps.apple.com/us/app/id6792986409))
- Other App Store entries named "Rezi" come from other developers. Rezi's own
  help center did not answer, so phone web editing is unknown.

### Teal

- No Teal app appears in an App Store search. Teal's web pages blocked
  direct reading (HTTP 403). Two reviews say Teal has no iOS or Android app,
  and that the phone experience trails the desktop
  ([tooliverse](https://tooliverse.ai/tools/teal), [Enhancv review](https://enhancv.com/blog/teal-review/), secondary).
- How the Teal resume builder behaves in a phone browser: unknown.

### Resume.io

- No first-party Resume.io app was found. The App Store app named "Resume io"
  (id 6639605844) could not be tied to the company, and Apple's lookup no
  longer returns it.
- One review says there is no app but the site is "mobile optimized". It shows
  screenshots labeled mobile dashboard, mobile editor and mobile resume
  preview. On a desktop, the same review describes a live preview "on the
  right-hand side at all times" and drag-to-reorder sections
  ([Enhancv review of Resume.io](https://enhancv.com/blog/resume-io-review/), secondary).
- Resume.io's help center has no article on phones or apps
  ([help.resume.io](https://help.resume.io/)).

### Canva

- The native app offers resumes: "designing resumes" and a "resume maker &
  CV builder". ([App Store listing](https://apps.apple.com/us/app/id897446215))
- Canva edits on the page on a phone. Reordering does not happen by dragging
  on the page. It happens in a separate list. To reach the Layers panel, "select
  Position on the toolbar above the editor, then select the Layers tab". Then
  press and hold a layer and drag it up or down the list
  ([Finding and arranging layers](https://www.canva.com/help/finding-and-arranging-layers/), snippet).
- Canva's own text help describes a desktop double-click only
  ([Add and edit text](https://www.canva.com/help/add-and-edit-text/), snippet).
  Blogs disagree on whether a tap or a double-tap starts typing on a phone
  (secondary). That gap is the select-versus-type problem that a page editor
  meets on touch.

### Overleaf

- No app. Overleaf works in phone browsers, "although some functionality may
  be limited", and the company is "still working on providing fuller support".
  ([Can I use Overleaf on an iPad or other mobile devices?](https://www.overleaf.com/learn/how-to/Can_I_use_Overleaf_on_an_iPad_or_other_mobile_devices%3F))
- The known issues on that page match this question closely:
  - "The size of touch targets may not be optimal".
  - Keyboard pop-up and zoom behavior "may be unexpected". The page suggests
    collapsing the file pane.
  - Scrolling can be inconsistent.
  - The PDF viewer's behavior may be restricted. The page suggests the
    browser's own PDF viewer.

### Google Docs

- In 2015, Docs added "Print Layout" to its iOS and Android apps "to see a
  fully paginated, read-only version of your document". Editing in that view
  was promised "in the future". ([Google Workspace Updates, Aug 2015](https://workspaceupdates.googleblog.com/2015/08/new-features-in-google-docs-and-sheets.html))
  Later updates added editing in that view. By 2017 it also let users edit
  headers, footers and images there
  ([Android Headlines, 2017](https://www.androidheadlines.com/2017/01/google-docs-on-android-gains-headerfooter-image-editing.html), secondary).
- Today each document has a Pages or Pageless setup, switched in the phone
  app through More, then Page setup. In Pageless, "line breaks for text will
  also adjust to your screen size, and as you zoom in and out."
  ([Pages or pageless, iPhone](https://support.google.com/docs/answer/11528737?hl=en&co=GENIE.Platform%3DiOS),
  [Android](https://support.google.com/docs/answer/11528737?hl=en&co=GENIE.Platform%3DAndroid))
- Docs for Android now opens documents with pages by default, to match the
  web. A reviewer called this "a step backward" on small screens
  ([Android Central](https://www.androidcentral.com/apps-software/google-docs-for-android-defaults-to-paginated-mode), secondary).
- The lesson: even Google first shipped the true page on a phone as read-only,
  and it still offers a reflowed view for typing.

## Platform facts

### How small a Letter page gets on a 390 px screen

This is arithmetic, not a source. CSS sets 1 in = 96 px and 1 pt = 4/3 px.

- A Letter page is 8.5 in wide, which is 816 CSS px.
- A 390 px screen with 16 px gutters leaves 358 px. The fit-to-width scale is
  358 / 816 = **0.44**.
- At that scale:

| On the page | At 100% | Fitted to 358 px |
|---|---|---|
| 10 pt body text | 13.3 px | **5.9 px** |
| 11 pt body text | 14.7 px | **6.4 px** |
| One 11 pt line, line height 1.2 | 17.6 px | **7.7 px** |

- Apple's minimum text size for iOS is **11 pt**, and the default is 17 pt
  ([Apple HIG, Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
  On iOS, 1 pt matches 1 CSS px. Fitted body text is about half that minimum.
- For 10 pt body text to reach 11 px, the page must show at scale 0.83
  or more. That is 676 px wide: about 1.9 screens, so the student pans
  sideways.
- For 10 pt body text to reach 16 px (see zoom-on-focus below), the page
  must show at scale 1.2 or more. That is 979 px wide: about 2.7 screens.

**Consequence:** "minimum readable zoom" for a full Letter page on a 390 px
screen does not fit the screen width. A fitted page works as a thumbnail and
for layout checks. It does not work for reading or editing a line.

### Touch target size

- **Apple:** iOS controls default to **44 x 44 pt**, with a minimum of
  28 x 28 pt ([Apple HIG, Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
- **Android and Material:** "at least 48dp x 48dp. Larger is even better."
  ([Android Developers, Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps))
- **WCAG 2.2, 2.5.8 (AA):** at least **24 x 24 CSS px**. One exception covers
  targets "in a sentence or its size is otherwise constrained by the
  line-height of non-target text".
  ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html))
- A fitted resume line is about 7.7 px tall. That is about a sixth of Apple's
  44 pt, and a third of WCAG's 24 px. Tapping one line on a fitted page will
  often pick the wrong line. The inline exception may cover a line of text,
  but the hide, move and Tailor controls are not text and get no exception.

### Reflow

- WCAG 2.2, 1.4.10 (AA): content must work at a width of 320 CSS px without
  scrolling in two directions, "except for parts of the content which require
  two-dimensional layout for usage or meaning". The exception covers the part
  that needs it, and "other content in the same page must still reflow".
  ([Understanding 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html))
- A page preview can fairly claim the exception. The editing controls, the
  "Not on This Resume" tray and the assistant cannot.

### iOS zoom-on-focus

- iOS Safari zooms in when a text field gets focus and the field's rendered
  text is under 16 px. No spec describes this. The common fix is 16 px input
  text. ([Rick Strahl, 2023](https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing),
  [456 Berea Street, 2012](https://456bereastreet.com/archive/201212/ios_webkit_browsers_and_auto-zooming_form_controls), secondary.
  Apple publishes no page on it.)
- Since iOS 10, Safari ignores `user-scalable`, `minimum-scale` and
  `maximum-scale` for pinch zoom: "Safari on iOS 10 allows the user to pinch
  zoom on every page." ([WebKit blog](https://webkit.org/blog/7367/new-interaction-behaviors-in-ios-10/))
  Developers report that `maximum-scale=1` still stops zoom-on-focus on iPhone
  (Strahl, secondary). Turning off zoom fails WCAG
  (1.4.4 Resize Text), so avoid it.
- **Open question:** does iOS measure the text size before or after a CSS
  `transform: scale()`? No source says. A scaled page with a real input in it
  must be tested on an iPhone. If iOS measures after the transform, every tap
  into a fitted line zooms the whole view.

### The virtual keyboard

- **Android Chrome (108 and later):** by default only the visual viewport
  shrinks when the keyboard opens. "Elements that use `position: fixed` remain
  in place and can be obscured by the OSK." The `interactive-widget` viewport
  key changes this. `resizes-content` brings back the old resize, and
  `overlays-content` resizes nothing.
  ([Chrome for Developers](https://developer.chrome.com/blog/viewport-resize-behavior))
- **iOS (every browser, since all use WebKit):** WebKit has not built
  `interactive-widget`. The bug is still NEW, last changed 2026-09-17: "The
  keyboard simply overlays the webpage with no option for opt-out."
  ([WebKit bug 259770](https://bugs.webkit.org/show_bug.cgi?id=259770))
- **Consequence:** a sticky line bar at the bottom of the screen can sit under
  the keyboard on iOS. A bar at the top stays visible, but iOS may scroll the
  page to show the focused field. Measuring `window.visualViewport` is the
  usual way to place a bar just above the keyboard. It works in both browsers.
- Overleaf lists keyboard pop-up and zoom behavior among its known phone
  issues (see above). This is a known trap, not a guess.

### What the KAN-195 page is made of

- The KAN-195 prototype draws a stand-in page in HTML, sized in container
  units. Its comment says "The real preview is a PDF (KAN-190); nothing here
  is selectable in it" (`frontend/src/app/prototype-editor/paper.tsx` on
  `origin/prototype/KAN-195-resume-editor`).
- KAN-184 recommends a Typst-rendered PDF
  (`docs/research/resume-pdf-rendering.md` on
  `origin/research/resume-pdf-rendering`).
- If the page the student sees is the real PDF, typing "in place" already
  means placing a field over the page. On a phone, that field can be shown at
  16 px or larger, over the page or below it, no matter how small the page is
  drawn. This makes the layouts below cheaper to build.

## Candidate phone layouts for WorkIt

All three keep the desktop model on a desktop. They differ only below a
breakpoint, for example under 768 px.

### A. Page preview, tap a line, edit in a bottom sheet

The fitted page stays the main view. A tap on a line highlights it and opens
a bottom sheet. A bottom sheet is a panel that slides up from the bottom edge.
The sheet holds the line's text in a 16 px field, plus the line actions
(hide, move up, move down, Tailor versions) as 44 pt buttons. The "Not on
This Resume" tray and the assistant open as other sheets or tabs.

- **Consequence:** the page still feels like the editor, and the student sees
  the layout change after each edit. Tapping a 7.7 px line is error-prone, so
  it needs generous hit areas, a "next line" and "previous line" control in
  the sheet, or pinch zoom. The sheet and the keyboard together cover most of
  a 390 x 844 screen.

### B. Outline editor, with a Preview tab

On a phone, the editor becomes a list of the resume's lines, grouped by
section, at phone text size. Each line is a row. A tap edits the row. A long
press or a handle moves it. A swipe or a menu hides it. A Preview tab, or a
button, shows the fitted page as a read-only check. This matches Kickresume
and Google Docs' Pageless view.

- **Consequence:** this layout is the easiest to make accessible and robust
  on touch. It fits WCAG reflow and the target sizes. It needs a second
  component tree for the same model. On a phone, the student no longer edits
  "on the page", which is KAN-195's main idea. Page overflow (a second page)
  shows only in the Preview tab, unless the outline marks it.

### C. Phone is review-only, with light actions

On a phone, the student can read the fitted page, hide and unhide lines, pick
Tailor versions, use the assistant and download the PDF. Typing new text
waits for a larger screen, or goes only through the assistant. This matches
Simplify, whose app tailors through Autopilot and leaves its builder on the
web.

- **Consequence:** this is the least work and carries the least risk on
  phones. Students who only have a phone cannot write or fix a line by hand.
  This hurts if many WorkIt students apply from their phones. The hide and
  version controls still need sheets and 44 pt targets.

## Facts the decision waits on

1. **How many WorkIt students open the resume builder on a phone, and what
   do they do there?** Today there is no data. Analytics, or a quick survey at
   the career center, would settle whether A or B is worth the cost over C.
2. **Does iOS zoom-on-focus count a CSS transform?** Test one real input
   inside a `scale(0.44)` page on an iPhone. If it zooms, layout A must put the
   field in a sheet at full size, not on the page.
3. **Is the phone page the real PDF, or an HTML stand-in?** If the real PDF is
   drawn as an image (KAN-190, KAN-184), A and C need a map from a tap position
   to a line, kept in step with each render.
4. **How long does one render take on a phone connection?** KAN-184 measured
   about 0.1 to 0.5 s on the server. Add the round trip on cellular data. If
   it is slow, the "see the page change" benefit of A is weaker.
5. **How far do Teal, Rezi and Resume.io go on a phone browser?** No primary
   source says. A 15-minute check of each with a test account would close the
   gap. It may change how much "form + preview" looks like the norm.
6. **Can the team afford two editors?** B means a second view of the same
   resume model. The KAN-195 prototype's `model.ts` is about 600 lines. Check
   whether the outline can reuse it unchanged.
