"""
The writing half of the Apply import (scripts/import_apply_profile.py, steps
6-7), from Apply's story-bank.md and voice.md:

6. writing samples (KAN-384): only the student's own words, which Apply keeps
   under the Story bank's "## <name>'s own essays" and "## <name>'s own
   answers" headings (Apply's writing.samples reads the same two): each essay's
   quoted (">") text and each answer under its bold question, never a
   heading, a question or a note. They are packed in file order into at most
   MAX_SAMPLES samples of SAMPLE_MAX characters; a piece too long for one is
   cut at its last paragraph that fits. The samples are replaced only when
   they differ, since any change to them deletes the style card;
7. the style card: voice.md as Apply wrote it (its leading HTML comment left
   out), saved after the samples it was measured from, when it is under
   CARD_MAX.
"""

import re
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.queries import writing
from app.schemas.writing import CARD_MAX, MAX_SAMPLES, SAMPLE_MAX

STORY_BANK, VOICE = "story-bank.md", "voice.md"
_OWN = re.compile(r"^## [^\n]+'s own (essays|answers)[^\n]*\n(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL)
_QUESTION = re.compile(r"^\*\*.+\*\*\s*$", re.MULTILINE)


# --- 6. writing samples ---

def own_pieces(story: str) -> list[str]:
    """The student's own essays and answers in a Story bank, word for word, in file order."""
    pieces: list[str] = []
    for kind, body in _OWN.findall(story):
        if kind == "essays":
            for block in re.findall(r"(?:^>[^\n]*(?:\n|$))+", body, re.MULTILINE):
                pieces.append("\n".join(re.sub(r"^> ?", "", line) for line in block.splitlines()).strip())
        else:
            pieces += [a.strip() for a in _QUESTION.split(body)[1:]]
    return [p for p in pieces if p]


def _cut(text: str, room: int) -> str:
    """`text`'s first paragraphs that fit in `room` characters, or, when the
    first doesn't fit, its first sentences that do."""
    def fit(parts: list[str], sep: str) -> str:
        kept = ""
        for part in parts:
            if len(joined := f"{kept}{sep}{part}" if kept else part) > room:
                break
            kept = joined
        return kept
    return fit(text.split("\n\n"), "\n\n") or fit(re.split(r"(?<=[.!?]) ", text), " ")


def pack(pieces: list[str]) -> list[str]:
    """`pieces` in at most MAX_SAMPLES samples of SAMPLE_MAX characters each, first fit."""
    samples: list[str] = []
    for piece in pieces:
        piece = piece if len(piece) <= SAMPLE_MAX else _cut(piece, SAMPLE_MAX)
        if not piece:
            continue
        at = next((i for i, s in enumerate(samples) if len(s) + 2 + len(piece) <= SAMPLE_MAX), None)
        if at is not None:
            samples[at] += "\n\n" + piece
        elif len(samples) < MAX_SAMPLES:
            samples.append(piece)
    return samples


async def set_samples(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path) -> int:
    """Steps 6 and the samples' count; 0 (and the student's samples kept) with no own words."""
    path = apply_dir / STORY_BANK
    samples = pack(own_pieces(path.read_text())) if path.is_file() else []
    if not samples:
        return 0
    if sorted(await writing.sample_texts(session, applicant_id)) != sorted(samples):
        for old in await writing.fetch_samples(session, applicant_id):
            await writing.remove_sample(session, applicant_id, old.id)
        for text in samples:
            await writing.add_sample(session, applicant_id, text)
    return len(samples)


def style_card(voice: str) -> str:
    return re.sub(r"^\s*<!--.*?-->", "", voice, count=1, flags=re.DOTALL).strip()


async def set_style_card(session: AsyncSession, applicant_id: uuid.UUID, apply_dir: Path) -> str | None:
    """Step 7: None when saved, else why it was left out."""
    path = apply_dir / VOICE
    card = style_card(path.read_text()) if path.is_file() else ""
    if not card:
        return None if not path.is_file() else "style card left out: voice.md is empty"
    if len(card) > CARD_MAX:
        return f"style card left out: voice.md is over {CARD_MAX} characters"
    if not await writing.sample_texts(session, applicant_id):
        return "style card left out: no writing samples to go with it"
    await writing.save_style_card(session, applicant_id, card)
    return None


