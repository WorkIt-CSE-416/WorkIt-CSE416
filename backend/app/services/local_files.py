"""
Files kept on this computer instead of in Storage (development only).

An uploaded resume's `storage_path` may be `local:<file name>`: a file in the
`LOCAL_FILES_DIR` folder (config.py's `local_files_dir`), never in the shared
bucket. scripts/import_apply_profile.py writes such a resume, so a student's
resume brought from Apply attaches to forms with nothing uploaded. Routes that
would read or remove a Storage object skip a local one: it is never sent to
Storage, and with the folder unset (production) it has no file.
"""

from pathlib import Path

from app.config import get_settings

PREFIX = "local:"


def is_local(storage_path: str | None) -> bool:
    return bool(storage_path) and storage_path.startswith(PREFIX)


def local_path(name: str) -> str:
    """The storage path naming the local file `name` (a bare file name)."""
    if not name or Path(name).name != name:
        raise ValueError(f"Not a bare file name: {name!r}")
    return PREFIX + name


def read(storage_path: str) -> bytes | None:
    """The local file a storage path names, or None: the folder unset, no
    such file, or a name that would leave the folder."""
    folder = get_settings().local_files_dir
    name = storage_path.removeprefix(PREFIX)
    if folder is None or not name or Path(name).name != name:
        return None
    path = folder / name
    return path.read_bytes() if path.is_file() else None
