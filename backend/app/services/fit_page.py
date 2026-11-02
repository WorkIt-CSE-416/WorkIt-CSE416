'''
Fit to One Page (KAN-218, KAN-320): what it cuts, in what order, and whether
the page fits once those cuts are made. The design and its reasons are
docs/cut_to_one_page.md; this module is its pure half, with no database and
no render:

    fit(view, scores, render)   the loop: the cuts and the last render
    plan(view, scores, page)    every cut Fit may make, in order, as steps
    Page(rendered, view)        one render, measured: fits(cut_ids)
    apply_cuts(view, cuts)      the view with those cuts made, in memory
    skill_levels(view, text)    each skill's level against a posting

`services/built_resumes.fit_to_one_page` reads the resume, calls `fit`, and
saves its cuts.

Everything reads one resume's view and its own render: nothing reads
another resume or the bank's wording behind what this resume shows.
'''

from __future__ import annotations

import statistics
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise
from typing import Literal

from app.services.resume_render import (
    WRAPPED_LINE,
    Box,
    Rendered,
    box_extent,
    box_lines,
    line_count,
)
from app.services.resume_render.fields import skill_lines
from app.services.resume_view import ResumeView, ViewEntry, ViewSection, ViewSkill

# Bullets are cut section by section, the least needed first (stages 1 and
# 2); whole entries in the same order without Awards and Certifications,
# which go by the schedule (stage 3). Education is in neither: it has a
# schedule of its own.
BULLET_ORDER = ("awards", "certifications", "leadership", "projects", "experience")
ENTRY_ORDER = ("leadership", "projects", "experience")

# The schedules: (share of ENTRY_ORDER's entries cut, what opens), in the
# order they run when two open at once.
SCHEDULE = (
    (0.10, "trim_skills"),
    (0.10, "awards_certifications"),
    (0.10, "education_wrapped"),
    (0.50, "skill_line"),
    (0.75, "skill_line"),
    (0.80, "school"),
    (0.85, "skill_line"),
    (0.90, "school"),
    (0.95, "skill_line"),
)

# Used only when a render gives nothing to measure them from (one bullet,
# one entry or one section in all): Jake's spacing, rounded up, so a guess
# errs toward a second cycle rather than a cut the page did not need.
_BULLET_GAP, _ENTRY_GAP, _HEADING = 3.0, 7.0, 20.0


@dataclass(frozen=True)
class Cut:
    '''One thing Fit to One Page hides: a bullet, a whole entry, or a skill
    (`kind` "bullet", "entry" or "skill").'''

    kind: Literal["bullet", "entry", "skill"]
    id: uuid.UUID


# The cuts one check against the page covers: one bullet or entry, or the
# skills a wrapped line loses together, or a whole skill line
Step = tuple[Cut, ...]


@dataclass(frozen=True)
class Scores:
    '''A resume with a job posting: each shown bullet's rank against the
    posting (higher shares more of its words), and each shown skill's level
    (2 in the posting, 1 only in the resume's own bullets or tools, 0 in
    neither). A resume with none has no Scores and is cut by position.'''

    bullets: Mapping[uuid.UUID, float]
    skills: Mapping[uuid.UUID, int]


def skill_levels(view: ResumeView, posting: str) -> dict[uuid.UUID, int]:
    '''Each shown skill's level: 2 when the posting's text names it, 1 when
    only the resume's own bullets do, 0 when neither. A whole-word check
    over every spelling the skills catalog knows (`keywords._shows`), never
    text search, which reads "C++" and "C#" as "c".'''
    from app.services.keywords import _shows
    from app.services.skill_catalog import spellings

    bullets = "\n".join(b.text for s in view.sections for e in s.entries for b in e.bullets)

    def named(text: str, skill: ViewSkill) -> bool:
        return any(_shows(text, name) for name in spellings(skill.name))

    return {s.id: 2 if named(posting, s) else 1 if named(bullets, s) else 0 for s in view.skills}


def apply_cuts(view: ResumeView, cuts: Iterable[Cut]) -> ResumeView:
    '''`view` without the cut entries, bullets and skills; a section left
    with no entry goes, as `build_view` drops an empty one.'''
    gone = {c.id for c in cuts}
    sections = []
    for section in view.sections:
        entries = tuple(
            replace(e, bullets=tuple(b for b in e.bullets if b.id not in gone))
            for e in section.entries if e.id not in gone
        )
        if entries:
            sections.append(ViewSection(section.section, entries))
    return ResumeView(tuple(sections), tuple(s for s in view.skills if s.id not in gone))


# --- Measuring one render ---------------------------------------------------


def _median(values: list[float], default: float) -> float:
    return statistics.median(values) if values else default


class Page:
    '''One render of a view, measured (docs/cut_to_one_page.md, "Measuring
    from the boxes"). Heights are read from the boxes, each with the space
    after it; the text area comes from the render itself.'''

    def __init__(self, rendered: Rendered, view: ResumeView) -> None:
        self.view = view
        self.area = rendered.area
        by_id: dict[str, list[Box]] = {}
        for box in rendered.boxes:
            by_id.setdefault(box.item_id, []).append(box)
        self._boxes = by_id
        self._rows = skill_lines(view.skills)
        self._starts = [p for p in rendered.points if p.name == "skillrow"]

        def gaps(pairs: Iterable[tuple[list[Box], list[Box]]]) -> list[float]:
            found = []
            for above, below in pairs:
                if above and below and above[-1].page == below[0].page:
                    found.append(min(b.y0 for b in below if b.page == below[0].page)
                                 - max(b.y1 for b in above if b.page == above[-1].page))
            return [g for g in found if g >= 0]

        entries = [e for s in view.sections for e in s.entries]
        self.bullet_gap = _median(gaps(
            (self.of(a.id), self.of(b.id)) for e in entries for a, b in pairwise(e.bullets)
        ), _BULLET_GAP)
        self.entry_gap = _median(gaps(
            (self.entry_boxes(a), self.entry_boxes(b))
            for s in view.sections for a, b in pairwise(s.entries)
        ), _ENTRY_GAP)
        blocks = [self.section_boxes(s) for s in view.sections]
        if self._rows:
            blocks.append([b for s in view.skills for b in self.of(s.id)])
        heading = _median(gaps(pairwise(blocks)), _HEADING + self.entry_gap)
        self.heading = max(0.0, heading - self.entry_gap)
        pitches = [
            (b.y - a.y) / max(1, self.row_lines(i))
            for i, (a, b) in enumerate(pairwise(self._starts)) if a.page == b.page
        ]
        self.row_pitch = _median(pitches, WRAPPED_LINE)
        singles = [b for s in view.skills for b in self.of(s.id) if box_lines(b) == 1 and b.text]
        width = sum(b.x1 - b.x0 for b in singles)
        self._char = width / sum(len(b.text) for b in singles) if singles else 5.0
        spaces = [
            b.x0 - a.x1 for a, b in pairwise(singles)
            if a.page == b.page and abs(a.y0 - b.y0) < 1 and b.x0 > a.x1
        ]
        self._space = _median(spaces, self._char)

        # A bullet's or entry's height is the distance from its top to the
        # next one's top when both sit on one page: exact, space after it
        # included, whatever made that space (a tall character can push a
        # line 1.7 pt lower). The last one, or one at a page break, is its
        # boxes' extent and the usual space.
        self._height: dict[uuid.UUID, float] = {}

        def measured(items: Sequence, boxes_of, gap: float) -> None:
            for item, after in zip(items, [*items[1:], None], strict=False):
                here, below = boxes_of(item), boxes_of(after) if after is not None else []
                if not here:
                    continue
                page = here[0].page
                if below and {b.page for b in here} == {page} and below[0].page == page:
                    self._height[item.id] = (min(b.y0 for b in below if b.page == page)
                                             - min(b.y0 for b in here))
                else:
                    self._height[item.id] = box_extent(here) + gap

        for entry in entries:
            measured(entry.bullets, lambda b: self.of(b.id), self.bullet_gap)
        for section in view.sections:
            measured(section.entries, self.entry_boxes, self.entry_gap)

        # How far each item's glue can shrink: the page's shrink from its
        # start marker to the next one (`Rendered.shrinks`). Where the next
        # sits on another page, the usual shrink of an item of that kind.
        marks = rendered.shrinks
        found: list[tuple[str, str, float | None]] = []
        for here, after in zip(marks, [*marks[1:], None], strict=False):
            item_id, kind = here.name.rsplit(".", 1)
            give = None
            if after is not None and after.page == here.page and after.total >= here.total:
                give = max(0.0, after.shrink - here.shrink)
            found.append((item_id, kind, give))
        usual: dict[str, list[float]] = {}
        for _, kind, give in found:
            if give is not None:
                usual.setdefault(kind, []).append(give)
        self._shrink: dict[str, float] = {}
        for item_id, kind, give in found:
            self._shrink[item_id] = self._shrink.get(item_id, 0.0) + (
                give if give is not None else _median(usual.get(kind, []), 0.0))
        self._entry_of = {str(b.id): str(e.id) for e in entries for b in e.bullets}

    # Boxes

    def of(self, item_id: uuid.UUID) -> list[Box]:
        return self._boxes.get(str(item_id), [])

    def entry_boxes(self, entry: ViewEntry) -> list[Box]:
        return sorted([*self.of(entry.id), *(b for x in entry.bullets for b in self.of(x.id))],
                      key=lambda b: (b.page, b.y0))

    def section_boxes(self, section: ViewSection) -> list[Box]:
        return [b for e in section.entries for b in self.entry_boxes(e)]

    # Heights

    def bullet_height(self, bullet_id: uuid.UUID) -> float:
        return self._height.get(bullet_id, 0.0)

    def entry_height(self, entry: ViewEntry) -> float:
        return self._height.get(entry.id, 0.0)

    def wrapped(self, bullet_id: uuid.UUID) -> bool:
        '''The bullet runs onto two or more lines.'''
        return line_count(self.of(bullet_id)) > 1

    def used(self) -> float:
        '''How tall the resume stands as one column, as the sum of the same
        heights a cut saves: the header down to the first entry's top, every
        entry, every other section's heading, and the skill lines with their
        heading. A sum, not a reading of where the last line landed: a block
        moved whole to the next page leaves empty space at the foot of the
        page before it, which is gone once the resume fits.'''
        if self.area is None:
            return 0.0
        entries = [e for s in self.view.sections for e in s.entries]
        first = self.entry_boxes(entries[0]) if entries else []
        if first:
            total = min(b.y0 for b in first if b.page == first[0].page) - self.area.top
            total += (first[0].page - 1) * self.area.height
            total += sum(self.entry_height(e) for e in entries)
            total += self.heading * (len(self.view.sections) - 1)
        else:
            total = max((b.y1 for boxes in self._boxes.values() for b in boxes if b.page == 1),
                        default=self.area.top) - self.area.top
        if self._rows:
            total += self.heading + self.entry_gap
            total += sum(self.row_lines(i) for i in range(len(self._rows))) * self.row_pitch
        return total

    # Skill lines

    def rows(self) -> list[tuple[str, tuple[ViewSkill, ...]]]:
        return self._rows

    def row_lines(self, index: int) -> int:
        return max(1, line_count(b for s in self._rows[index][1] for b in self.of(s.id)))

    def _width(self, skill: ViewSkill) -> float:
        boxes = self.of(skill.id)
        if len(boxes) == 1 and box_lines(boxes[0]) == 1:
            return boxes[0].x1 - boxes[0].x0
        # A skill broken across two lines: its width from its letters
        return (len(skill.name) + 1) * self._char

    def fits_one_line(self, index: int, kept: Sequence[ViewSkill]) -> bool:
        '''Whether line `index`, keeping only `kept` of its skills, fits on
        one line: its label, the skills' widths and the spaces between them
        against the text's right edge.'''
        if not kept or index >= len(self._starts) or self.area is None:
            return not kept
        skills = self._rows[index][1]
        start = self._starts[index].x
        first = self.of(skills[0].id)
        label = (min(b.x0 for b in first) - start) if first else 0.0
        need = label + sum(self._width(s) for s in kept) + self._space * (len(kept) - 1)
        return need <= self.area.right - start

    # The check

    def saved(self, cut: set[uuid.UUID]) -> float:
        '''How many points making `cut` (ids of this view's items) saves.'''
        total = 0.0
        for section in self.view.sections:
            if all(e.id in cut for e in section.entries):
                total += self.heading
            for e in section.entries:
                if e.id in cut:
                    total += self.entry_height(e)
                else:
                    total += sum(self.bullet_height(b.id) for b in e.bullets if b.id in cut)
        emptied = 0
        for i, (_, skills) in enumerate(self._rows):
            kept = [s for s in skills if s.id not in cut]
            lines = self.row_lines(i)
            if not kept:
                emptied += 1
                total += lines * self.row_pitch
            elif len(kept) < len(skills) and lines > 1 and self.fits_one_line(i, kept):
                total += (lines - 1) * self.row_pitch
        if self._rows and emptied == len(self._rows):
            total += self.heading
        return total

    def shrink(self, cut: set[uuid.UUID]) -> float:
        '''How far the glue of what is left once `cut` is made can shrink.'''
        gone = {str(i) for i in cut}
        return sum(give for item_id, give in self._shrink.items()
                   if item_id not in gone and self._entry_of.get(item_id) not in gone)

    def fits(self, cut: set[uuid.UUID]) -> bool:
        '''Whether the resume fits on one page once `cut` is made, by
        subtraction from this render: what is left, squeezed as far as its
        glue allows, against the text area's height. TeX squeezes a page
        that much rather than break it when the break is the document's end.'''
        if self.area is None:
            return False
        return self.used() - self.saved(cut) - self.shrink(cut) <= self.area.height


# --- The plan ---------------------------------------------------------------


def _entry_score(entry: ViewEntry, scores: Scores) -> float:
    '''An entry's rank: its best bullet's, the one still there once the
    entry is down to one bullet. 0 with no bullets.'''
    return max((scores.bullets.get(b.id, 0.0) for b in entry.bullets), default=0.0)


def _weakest_first(entries: Sequence[ViewEntry], scores: Scores | None) -> list[ViewEntry]:
    '''The order whole entries go: the lowest rank first, ties the bottom
    first; by position, the bottom first.'''
    indexed = list(enumerate(entries))
    if scores is None:
        return [e for _, e in reversed(indexed)]
    return [e for _, e in sorted(indexed, key=lambda ie: (_entry_score(ie[1], scores), -ie[0]))]


def _bullets_over(entries: Sequence[ViewEntry], cap: int, gone: set[uuid.UUID],
                  scores: Scores | None) -> list[uuid.UUID]:
    '''The bullets past `cap` in each entry, in the order they go: the
    lowest-ranked first (an entry keeps its best `cap`), ties the bottom
    entry's last bullet first; by position, the bottom entry's last first.'''
    out: list[tuple[tuple, uuid.UUID]] = []
    for k, entry in enumerate(entries):
        left = [(j, b) for j, b in enumerate(entry.bullets) if b.id not in gone]
        if scores is None:
            extra = left[cap:]
        else:
            keep = sorted(left, key=lambda jb: (-scores.bullets.get(jb[1].id, 0.0), jb[0]))[:cap]
            extra = [jb for jb in left if jb not in keep]
        for j, bullet in extra:
            rank = scores.bullets.get(bullet.id, 0.0) if scores else 0.0
            out.append(((rank, -k, -j), bullet.id))
    return [bullet_id for _, bullet_id in sorted(out, key=lambda x: x[0])]


def _skill_order(skills: Sequence[ViewSkill], scores: Scores | None) -> list[ViewSkill]:
    '''The order a line's skills go: the lowest level first, ties the end
    of the line first; by position, the end first.'''
    indexed = list(enumerate(skills))
    if scores is None:
        return [s for _, s in reversed(indexed)]
    return [s for _, s in sorted(indexed, key=lambda iss: (scores.skills.get(iss[1].id, 0), -iss[0]))]


def plan(view: ResumeView, scores: Scores | None, page: Page) -> list[Step]:
    '''Every cut Fit to One Page may make on `view`, in the order it makes
    them (docs/cut_to_one_page.md, "The stages"), as steps it checks against
    the page one at a time. `page` is the first render's measure: which
    lines wrap and how many skills a wrapped line must lose. The last steps
    take the resume down to its header, so the page always fits by the end.'''
    by_section = {s.section: s.entries for s in view.sections}
    steps: list[Step] = []
    gone: set[uuid.UUID] = set()

    def take(*cuts: Cut) -> None:
        if cuts:
            steps.append(tuple(cuts))
            gone.update(c.id for c in cuts)

    # Fit never leaves an entry it emptied: the cut that would take an
    # entry's last bullet takes the whole entry instead, or, where a floor
    # keeps the entry, leaves that bullet. An entry that had no bullets to
    # start with is not emptied by Fit and stays.
    owner = {b.id: e for s in view.sections for e in s.entries for b in e.bullets}

    def take_bullet(bullet_id: uuid.UUID, kept: bool = False) -> None:
        entry = owner[bullet_id]
        if any(b.id not in gone and b.id != bullet_id for b in entry.bullets):
            take(Cut("bullet", bullet_id))
        elif not kept:
            take(Cut("entry", entry.id))

    # Stages 1 and 2: bullets down to two per entry, then to one
    for cap in (2, 1):
        for section in BULLET_ORDER:
            for bullet_id in _bullets_over(by_section.get(section, ()), cap, gone, scores):
                take_bullet(bullet_id)

    rows = [(i, list(skills)) for i, (_, skills) in enumerate(page.rows())]
    schools = list(by_section.get("education", ()))

    def skill_line() -> None:
        live = [(i, skills) for i, skills in rows if skills]
        if not live:
            return
        if scores is None:
            pick = live[-1]
        else:
            pick = min(reversed(live), key=lambda r: sum(scores.skills.get(s.id, 0) for s in r[1]))
        take(*(Cut("skill", s.id) for s in pick[1]))
        pick[1].clear()

    def school() -> None:
        left = [e for e in schools if e.id not in gone]
        if left:
            take(Cut("entry", _weakest_first(left, scores)[0].id))

    def opened(event: str) -> None:
        if event == "trim_skills":
            for i, skills in reversed(rows):
                if len(skills) < 2 or page.row_lines(i) < 2:
                    continue
                kept = list(skills)
                dropped = []
                for skill in _skill_order(skills, scores):
                    if len(kept) == 1 or page.fits_one_line(i, kept):
                        break
                    kept.remove(skill)
                    dropped.append(skill)
                if dropped and page.fits_one_line(i, kept):
                    take(*(Cut("skill", s.id) for s in dropped))
                    skills[:] = kept
        elif event == "awards_certifications":
            for section in ("awards", "certifications"):
                for entry in _weakest_first(by_section.get(section, ()), scores):
                    take(Cut("entry", entry.id))
        elif event == "education_wrapped":
            for entry in reversed(schools):
                for bullet in reversed(entry.bullets):
                    if entry.id not in gone and page.wrapped(bullet.id):
                        # The last school keeps its last bullet: Education keeps one entry
                        last = all(e.id in gone for e in schools if e.id != entry.id)
                        take_bullet(bullet.id, kept=last)
        elif event == "skill_line":
            if sum(1 for _, skills in rows if skills) > 1:
                skill_line()
        elif event == "school" and sum(1 for e in schools if e.id not in gone) > 1:
            school()

    # Stage 3: whole entries, with the schedules opening as they go.
    # Experience keeps its best entry (the top one by position).
    counted = [e for s in ENTRY_ORDER for e in by_section.get(s, ())]
    pending = list(SCHEDULE)
    cut_count = 0
    for section in ENTRY_ORDER:
        order = _weakest_first(by_section.get(section, ()), scores)
        if section == "experience":
            order = order[:-1]
        for entry in order:
            if entry.id in gone:
                continue
            take(Cut("entry", entry.id))
            cut_count += 1
            while pending and cut_count / len(counted) >= pending[0][0]:
                opened(pending.pop(0)[1])

    # Stage 3 ran out first: what is left of the schedules opens anyway, then
    # skill lines and schools go down to one each
    for _, event in pending:
        opened(event)
    while sum(1 for _, skills in rows if skills) > 1:
        skill_line()
    while sum(1 for e in schools if e.id not in gone) > 1:
        school()

    # Stage 4, the last resort: the floors go too
    skill_line()
    for section in ("projects", "experience"):
        for entry in _weakest_first([e for e in by_section.get(section, ()) if e.id not in gone], scores):
            take(Cut("entry", entry.id))
    school()
    return steps


async def fit(
    view: ResumeView, scores: Scores | None, render: Callable[[ResumeView], Awaitable[Rendered]]
) -> tuple[list[Cut], Rendered]:
    '''The loop (docs/cut_to_one_page.md, "The loop"): render; if over one
    page, measure that render and take steps until the page fits by
    subtraction (at least one a cycle); render the view with every cut so
    far to confirm; repeat until a render is one page. The plan ends at the
    header alone, so the last render is one page. Returns the cuts, in the
    order made, and the last render.'''
    rendered = await render(view)
    if rendered.page_count <= 1:
        return [], rendered
    steps = plan(view, scores, Page(rendered, view))
    cuts: list[Cut] = []
    shown = view
    done = 0
    while rendered.page_count > 1 and done < len(steps):
        page = Page(rendered, shown)
        cycle: set[uuid.UUID] = set()
        while done < len(steps):
            cuts.extend(steps[done])
            cycle.update(c.id for c in steps[done])
            done += 1
            if page.fits(cycle):
                break
        shown = apply_cuts(view, cuts)
        rendered = await render(shown)
    return cuts, rendered
