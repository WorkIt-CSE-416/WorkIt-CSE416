import pytest

from workit_scraper.catalog import add_boards, load_boards, write_boards
from workit_scraper.providers import Board


def test_shared_catalog_round_trip_and_add_only(tmp_path):
    path = tmp_path / "boards.csv"
    write_boards(path, [Board("lever", "acme", "Acme, Inc.")], preamble="# provenance\n")
    assert load_boards(path) == [Board("lever", "acme", "Acme, Inc.")]
    assert add_boards(path, [Board("lever", "acme", "Wrong"),
                            Board("ashby", "new", "New"),
                            Board("ashby", "new", "Also wrong")]) == 1
    assert load_boards(path) == [Board("lever", "acme", "Acme, Inc."),
                                 Board("ashby", "new", "New")]
    assert path.read_text().startswith("# provenance\n")
    assert b"\r" not in path.read_bytes()
    assert not list(tmp_path.glob("*.tmp"))


def test_failed_atomic_replace_preserves_catalog(tmp_path, monkeypatch):
    from workit_scraper import catalog

    path = tmp_path / "boards.csv"
    write_boards(path, [Board("lever", "acme", "Acme")])
    original = path.read_bytes()
    def fail(*_):
        raise OSError("replace failed")
    monkeypatch.setattr(catalog.os, "replace", fail)
    with pytest.raises(OSError):
        add_boards(path, [Board("ashby", "new", "New")])
    assert path.read_bytes() == original
    assert not list(tmp_path.glob("*.tmp"))



def test_scheduled_builder_keeps_existing_names_and_failed_run_is_unchanged(tmp_path, monkeypatch):
    import build_boards

    path = tmp_path / "boards.csv"
    write_boards(path, [Board("lever", "acme", "Original")])
    monkeypatch.setattr(build_boards, "BOARDS_CSV", path)
    monkeypatch.setattr(build_boards, "EXTRA", [])
    monkeypatch.setattr(build_boards, "harvest", lambda _known: (
        {("lever", "acme"): "Other", ("ashby", "new"): "New"}, []))
    assert build_boards.main([]) == 0
    assert {b.token: b.company for b in load_boards(path)} == {"acme": "Original", "new": "New"}
    original = path.read_bytes()
    def fail(_known):
        raise TimeoutError()
    monkeypatch.setattr(build_boards, "harvest", fail)
    with pytest.raises(TimeoutError):
        build_boards.main([])
    assert path.read_bytes() == original
