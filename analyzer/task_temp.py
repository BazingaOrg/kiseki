"""任务私有临时目录。"""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import tempfile
from typing import Iterator


def _environment_temp_root() -> Path | None:
    """返回已验证的任务根；未设置环境变量时保持系统临时目录行为。"""
    for variable in ("TSUZURI_LEASE_TASK_ROOT", "TMPDIR"):
        raw = os.environ.get(variable)
        if not raw:
            continue
        configured = Path(raw)
        try:
            root = configured.resolve(strict=True)
        except OSError as exc:
            raise RuntimeError(f"{variable} 不是可用的任务临时目录: {configured}") from exc
        if not root.is_dir() or configured.is_symlink():
            raise RuntimeError(f"{variable} 不是目录或包含符号链接: {configured}")
        return root
    return None


@contextmanager
def temporary_directory(*, prefix: str) -> Iterator[Path]:
    """创建并 finally 清理一个位于任务根内的唯一子目录。"""
    root = _environment_temp_root()
    kwargs = {"prefix": prefix}
    if root is not None:
        kwargs["dir"] = root
    with tempfile.TemporaryDirectory(**kwargs) as temporary:
        directory = Path(temporary).resolve()
        if root is not None:
            try:
                directory.relative_to(root)
            except ValueError as exc:
                raise RuntimeError("临时目录越出任务根") from exc
        yield directory
