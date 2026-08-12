"""同目录原子 JSON 写入，避免中断时暴露截断的项目元数据。"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_json_atomic(path: Path, value: Any) -> None:
    """将 JSON 完整落盘后，以同目录 replace 提交。

    partial 和正式文件位于同一目录，确保 ``os.replace`` 不会退化成跨卷复制。
    在写入、flush 或 replace 失败（含取消）时，只移除本次 unique partial；已有
    正式文件从未被打开或截断。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    partial: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".kiseki-partial-{path.name}-",
            suffix=".json",
            delete=False,
        ) as handle:
            partial = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(partial, path)
        partial = None
    finally:
        if partial is not None:
            try:
                partial.unlink()
            except FileNotFoundError:
                pass
