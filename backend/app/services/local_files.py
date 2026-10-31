"""
Files kept on this computer instead of in Storage (development only).

An uploaded resume's (or student document's) `storage_path` may be
`local:<applicant_id>/<file name>`: a file in the student's own folder in
`LOCAL_FILES_DIR` (config.py's `local_files_dir`), never in the shared
bucket, so two students' files of the same name never overwrite each other.
An older `local:<file name>` (the folder itself) still reads. scripts/import_apply_profile.py writes such a resume, so a student's
resume brought from Apply attaches to forms with nothing uploaded. Routes that
would read or remove a Storage object skip a local one: it is never sent to
Storage, and with the folder unset (production) it has no file.
"""

import uuid
from pathlib import Path

from app.config import get_settings

PREFIX = "local:"


def is_local(storage_path: str | None) -> bool:
    return bool(storage_path) and storage_path.startswith(PREFIX)


def local_path(applicant_id: uuid.UUID, name: str) -> str:
    """The storage path naming the student's local file `name` (a bare file name)."""
    if not name or Path(name).name != name or name in (".", ".."):
        raise ValueError(f"Not a bare file name: {name!r}")
    return f"{PREFIX}{applicant_id}/{name}"


def file_for(storage_path: str) -> Path | None:
    """Where in LOCAL_FILES_DIR a storage path's file goes, or None: the
    folder unset, or a path that would leave it (only `<uuid>/<name>` or a
    bare `<name>`)."""
    folder = get_settings().local_files_dir
    parts = storage_path.removeprefix(PREFIX).split("/")
    if folder is None or not all(parts) or any(p in (".", "..") or "\\" in p for p in parts):
        return None
    if len(parts) == 2:
        try:
            uuid.UUID(parts[0])
        except ValueError:
            return None
    elif len(parts) != 1:
        return None
    return folder.joinpath(*parts)


def read(storage_path: str) -> bytes | None:
    """The local file a storage path names, or None: the folder unset, no
    such file, or a name that would leave the folder."""
    path = file_for(storage_path)
    return path.read_bytes() if path is not None and path.is_file() else None
