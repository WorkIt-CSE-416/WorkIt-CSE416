# Motion

How everything in the app moves: curves, durations, presses, arrivals, view
transitions, shallow routing, reduced motion, the pointer cursor. Read it
before adding or changing an animation, transition, hover or press state, or a
`<ViewTransition>`.

Everything that moves speaks one language, defined in `globals.css` (the
Motion block in `@theme`, and the view-transition rules after it) and shown
moving at `/design-kit/motion`. The rules:

- **Three curves, picked by role.** `--ease-glide` for what travels and
  settles (a thumb, a highlight, a card lifting, a page arriving),
  `--ease-spring` for what pops into place (a chip's cross, a badge, never
  anything that travels far), `--ease-exit` for what leaves. Durations go by
  role too: 150ms for a press or a colour, 200ms for a hover fill or a nudge,
  about 250ms for content arriving, 300 to 320ms for a glide. An exit is
  always shorter than the entrance after it, so the old thing is gone before
  the new one asks to be looked at.
- **Every control answers the pointer.** A button presses to 98%, an icon
  button or a calendar arrow to 90%, a segment to 96%, and a card that is one
  whole target lifts 2px onto `--shadow-lift` and settles on the press. The
  presses live in `ui/button.tsx`, `ui/icon-button.tsx` and
  `ui/segmented-control.tsx`, so a new control gets one by using them. A
  colour change eases rather than snaps, an underline fades in
  (`decoration-transparent` to `decoration-current`) rather than appearing,
  and an arrow leans 2px the way its link goes while the link is hovered.
- **Content arrives, staggered and capped.** A list rises in
  (`animate-rise`; a table row takes `animate-fade`, since browsers do not
  reliably paint a row's transform) with an `animation-delay` per item,
  capped at the sixth to tenth item so a long list never keeps anyone
  waiting. Only arrival animates. A figure that changes in place counts to
  its new value (`ui/animated-number.tsx`, which never counts up on load),
  and a line of words fades in again, keyed on what it says.
- **The left panel's highlights glide.** Each menu in
  `components/app-sidebar.tsx` draws one hover fill and one current fill
  behind its rows and moves them by row index, with nothing measured, so
  pointing down the panel slides one fill instead of blinking a fill per row.
  GlideMenu there has the details.
- **Pages and views change through React's `<ViewTransition>`**, which Next
  16 runs on every navigation with no config. `(seeker)/template.tsx` and
  `company/template.tsx` wrap each section's page. A template remounts when
  the section changes but not when only the query does, so moving between
  sections is an exit and an enter (`page-exit`, `page-enter`) while a filter
  or `?app=` is not. Inside a page, the Applications results are keyed on
  their shape (the view, the board's columns, or nothing matching) and swap
  (`swap-enter`, `swap-exit`); within one shape each card or row is keyed by
  its application (`applications/reflow.tsx`) and glides to its new place
  when the list is sorted or filtered (`reflow`). The Calendar keys its
  title and view on the span, and its arrows and Today tag their moves
  `nav-back` or `nav-forward` (`<ShallowLink transitionType>`, which does what
  `<Link transitionTypes>` does for a real navigation), so the span slides
  the way time went (`step-back`, `step-forward`). Every `<ViewTransition>` here sets
  `default="none"`, so it animates only for the change it names.
- **A choice the page can already draw never waits on the server.** The
  Dashboard's range, the Applications layout and the Calendar's view and
  span move the query in place (`components/shallow-routing.tsx`): the
  content holds every option and reads the query itself, so it redraws in
  the next frame, where a link to the server made it trail the segmented
  control's thumb by a round trip. The shown query is held in
  `<ShallowRouting>`'s state and set inside a transition, and the address
  bar follows once that has drawn. It cannot be read straight from
  `useSearchParams` after a bare `history.pushState`: Next applies that URL
  in a microtask after the caller's transition has ended (its router
  reducer is async), so the redraw is an ordinary update and no
  `<ViewTransition>` runs. Anything that depends on the server (a filter,
  the list's sort, `?app=`) stays a real link.
- **The root's own crossfade is off** (`::view-transition-old(root)` is
  hidden). Everything outside a `<ViewTransition>` then updates live, which
  is what lets the sidebar's fill glide beside a changing page instead of
  ghosting at both rows. The overlay lets clicks through.
- **The detail panel slides out before it navigates.** Closing shuts the
  sheet locally and drops `?app=` in `onOpenChangeComplete`, since the
  navigation unmounts it; `applications/detail-panel.tsx` says why it
  remembers the object it closed on rather than the id.
- **Reduced motion is one rule**, at the foot of the motion CSS: every
  animation, transition and view transition completes at once (1ms, not 0,
  so Base UI's dialogs still hear an animation end). Do not add
  `motion-reduce:` per component; the rule already covers it.
- **Chrome skips a view transition in a hidden tab**, and the browser pane
  times one out while the pane is not on screen ("Transition was aborted
  because of timeout in DOM update"). Neither is a bug. Check one in a
  visible window, or watch the `view-transition-class` React sets.
- **Scout's panel slides in; the page does not get squeezed.** It stays
  mounted, inert while closed. Opening makes its 396px of room (460px while a
  page such as the Experience Bank holds it) in one step, so
  the page lays itself out once and then settles into place (a 32px glide and
  fade, `scout-page-in` in `globals.css`), while the panel slides in from the
  window's edge on transform alone (360ms). Closing gives the room back at
  once, and the panel slides out over the page's edge (200ms) as the page
  settles wider; holding the room until it had gone read as lag. Animating the panel's width instead made
  the page re-lay itself out every frame, rewrapping text and dropping a
  column partway through. Below md it rises over the window instead. Its
  messages rise in, its thinking is three looping dots (`--animate-typing`),
  the bank row its panel is filling shimmers (`--animate-shimmer`, the only
  other loop: both mean "still working"),
  and its Send stays hoverable (aria-disabled) so its tooltip can say why it
  won't send. `components/scout/scout-panel.tsx` has the details.
- **Clickable means the hand.** Tailwind v4 dropped the pointer from
  buttons, so `globals.css` restores it in one place: buttons,
  `role="button"`, tabs, switches, checkboxes, selects and the native parts
  of a field (a search field's clear cross, a date field's picker, a file
  input's button) in the base layer, and menu, select and combobox rows in
  the utilities layer, where it outranks the vendored `cursor-default`. A
  new clickable element gets the hand from that rule or by being a link;
  write `cursor-pointer` only on something that is neither, like a `<label>`
  that toggles a switch.
