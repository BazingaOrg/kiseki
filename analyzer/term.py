"""与 Node CLI 对齐的终端状态语义。

web 工作台把 CLI 进程的 fd 3 当作结构化进度出口(NDJSON,契约见 cli/term.mjs)。
分析进程经 CLI 三代继承同一 fd 3:这里在 TSUZURI_JSON_PROGRESS=1 时把消息
镜像成同一份事件形状,web 面板才能看到分析阶段的细节与下载进度。
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Callable, TextIO

JSON_PROGRESS_FD = 3

_COLORS = {
    "info": "39",
    "start": "38;2;217;119;87",
    "success": "32",
    "warn": "33",
    "error": "31",
}


def _enabled(stream: TextIO) -> bool:
    return (
        stream.isatty()
        and "NO_COLOR" not in os.environ
        and os.environ.get("TERM", "").lower() != "dumb"
    )


def _lines(message: object) -> list[str]:
    return str(message).replace("\r\n", "\n").split("\n")


def json_progress_enabled() -> bool:
    """结构化进度出口开关:必须显式设为 '1',其余取值(含未设置)一律关闭,终端行为零变化."""
    return os.environ.get("TSUZURI_JSON_PROGRESS") == "1"


def _default_json_write(event: dict[str, Any]) -> None:
    """默认 JSON 写入器:落到 fd 3.fd 3 未打开时 write 抛 OSError,吞掉——结构化出口是尽力而为,绝不能带崩分析进程."""
    try:
        os.write(JSON_PROGRESS_FD, f"{json.dumps(event, ensure_ascii=False)}\n".encode("utf-8"))
    except OSError:
        # fd 3 未打开或写入失败:静默丢弃.
        pass


# 测试注入点:默认写 fd 3,单测 monkeypatch 成内存列表即可断言事件流.
_json_write: Callable[[dict[str, Any]], None] = _default_json_write


def _emit_json(kind: str, message: object) -> None:
    if not json_progress_enabled():
        return
    for line in _lines(message):
        _json_write({"kind": kind, "text": line})


def progress(label: str, percent: float) -> None:
    """结构化进度事件(web 工作台面板用).终端文本不变——终端的进度条由调用方自己的机制负责."""
    if not json_progress_enabled():
        return
    _json_write({"kind": "progress", "label": label, "percent": percent})


def _emit(kind: str, message: object, stream: TextIO) -> None:
    _emit_json(kind, message)
    dot = f"\x1b[{_COLORS[kind]}m●\x1b[0m" if _enabled(stream) else "●"
    for line in _lines(message):
        print(f"{dot} {line}", file=stream, flush=True)


def info(message: object) -> None:
    _emit("info", message, sys.stdout)


def start(message: object) -> None:
    _emit("start", message, sys.stdout)


def success(message: object) -> None:
    _emit("success", message, sys.stdout)


def warn(message: object) -> None:
    _emit("warn", message, sys.stderr)


def error(message: object) -> None:
    _emit("error", message, sys.stderr)


def detail(message: object) -> None:
    _emit_json("detail", message)
    for line in _lines(message):
        output = f"└ {line}"
        if _enabled(sys.stdout):
            output = f"\x1b[2m{output}\x1b[0m"
        print(output, file=sys.stdout, flush=True)
