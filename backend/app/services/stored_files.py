"""
A student's uploaded files: resumes, sent resumes and documents.

All live in the `Resume` Storage bucket under the student's folder, or, in
development, as `local:<file name>` in LOCAL_FILES_DIR (services/local_files.py),
which is never sent to or removed from Storage. `read` and `remove` take
either, so a route never checks for a local file itself. They take the
route's `get_supabase` (called only for a Storage path), so a test patches
Storage where the route looks it up.
"""

import asyncio
import logging
from collections.abc import Callable
from pathlib import PurePosixPath

from app.services import local_files

logger = logging.getLogger(__name__)

BUCKET = "Resume"

MIME_TYPES = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


async def read(get_supabase: Callable, storage_path: str) -> bytes | None:
    """The file's bytes. None for a local file that isn't there; a Storage
    failure raises."""
    if local_files.is_local(storage_path):
        return local_files.read(storage_path)
    return await asyncio.to_thread(get_supabase().storage.from_(BUCKET).download, storage_path)


async def remove(get_supabase: Callable, storage_path: str, message: str) -> None:
    """Best effort: a file left behind is orphaned, but no data is lost. A
    failure is logged with `message`."""
    if local_files.is_local(storage_path):
        return
    try:
        await asyncio.to_thread(get_supabase().storage.from_(BUCKET).remove, [storage_path])
    except Exception:
        logger.exception(message, extra={"storage_path": storage_path})


def media_type(storage_path: str) -> str:
    return MIME_TYPES.get(PurePosixPath(storage_path).suffix.lower(), "application/octet-stream")

