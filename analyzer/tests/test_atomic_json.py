from __future__ import annotations

import json
from pathlib import Path

import pytest

import atomic_json
from task_temp import temporary_directory


def test_atomic_json_failure_keeps_existing_file_and_removes_partial(tmp_path: Path, monkeypatch):
    output = tmp_path / "metadata" / "timeline.json"
    output.parent.mkdir()
    output.write_text('{"state":"old"}', encoding="utf-8")

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(atomic_json.os, "replace", fail_replace)
    with pytest.raises(OSError, match="simulated replace failure"):
        atomic_json.write_json_atomic(output, {"state": "new"})

    assert json.loads(output.read_text(encoding="utf-8")) == {"state": "old"}
    assert not list(output.parent.glob(".kiseki-partial-*"))


def test_task_temp_is_unique_child_of_task_root_and_is_cleaned(tmp_path: Path, monkeypatch):
    task_root = tmp_path / "task"
    task_root.mkdir()
    monkeypatch.setenv("KISEKI_LEASE_TASK_ROOT", str(task_root))
    monkeypatch.setenv("TMPDIR", str(tmp_path / "ignored"))

    with temporary_directory(prefix="kiseki-test-") as temporary:
        assert temporary.parent == task_root.resolve()
        assert temporary.is_dir()

    assert not temporary.exists()
